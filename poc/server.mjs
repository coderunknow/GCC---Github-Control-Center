// Arena Session Bridge — proof of concept
//
// Purpose: verify, end to end, whether a durable request queue written by a
// website can be consumed by the *exact existing* Arena Agent Mode session
// using only supported mechanisms (no model API, no browser automation, no
// undocumented endpoints).
//
// Architecture:
//   browser  ->  this server  ->  GitHub Issues (durable queue)
//   Arena Agent Mode session  ->  reads the queue  ->  comments result  ->  closes issue
//
// GitHub Issues is chosen deliberately. It is the only durable store reachable
// from BOTH sides: the sandbox this session runs in can reach api.github.com
// (verified), and a deployed website can reach it with its own token.
//
// Zero runtime dependencies: Node's standard library only.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

// Token is read from the environment only. It is never sent to the browser and
// never committed. In production this must be a fine-grained token owned by the
// deploying user, scoped to Issues: read/write on one repository.
const TOKEN = process.env.GITHUB_TOKEN || '';
const QUEUE_REPO = process.env.QUEUE_REPO || 'coderunknow/Testing';
// Answers are committed under RESULT_DIR. Chosen because the sandbox credential
// can push commits but cannot comment on issues (verified: 403 Resource not
// accessible by integration). A user-supplied PAT with issues:write can do both.
const QUEUE_BRANCH = process.env.QUEUE_BRANCH || 'main';
const RESULT_DIR = 'queue/results';

const BRIDGE_PREFIX = '[arena-bridge]';
const API = 'https://api.github.com';

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function gh(path, { method = 'GET', body } = {}) {
  if (!TOKEN) throw new GitHubError('GITHUB_TOKEN is not configured on the server', 503);

  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'arena-session-bridge-poc',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text.slice(0, 300);
    try {
      detail = JSON.parse(text)?.message ?? detail;
    } catch { /* keep raw text */ }
    throw new GitHubError(`GitHub ${method} ${path} failed (${res.status}): ${detail}`, res.status);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

function parseRequestBody(raw) {
  if (!raw) return {};
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    return {};
  }
}

const RESULT_MARKER = '<!-- arena-bridge:result -->';

function toRequest(issue) {
  const payload = parseRequestBody(issue.body || '');
  const comments = issue.comments > 0 ? null : [];
  return {
    id: payload.request_id || `issue-${issue.number}`,
    issueNumber: issue.number,
    title: issue.title,
    prompt: payload.prompt || '(prompt not recorded in issue body)',
    submittedAt: payload.submitted_at || issue.created_at,
    source: payload.source || 'unknown',
    status: issue.state === 'closed' ? 'answered' : 'pending',
    url: issue.html_url,
    comments,
  };
}

async function listResults() {
  let entries;
  try {
    entries = await gh(`/repos/${QUEUE_REPO}/contents/${RESULT_DIR}?ref=${QUEUE_BRANCH}`);
  } catch (err) {
    if (err.status === 404) return new Map(); // no results recorded yet
    throw err;
  }
  if (!Array.isArray(entries)) return new Map();

  const byId = new Map();
  for (const entry of entries) {
    if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue;
    try {
      const file = await gh(
        `/repos/${QUEUE_REPO}/contents/${entry.path}?ref=${QUEUE_BRANCH}`
      );
      const json = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
      if (json.request_id) byId.set(json.request_id, json);
    } catch { /* ignore an unreadable result file */ }
  }
  return byId;
}

async function listRequests() {
  const issues = await gh(
    `/repos/${QUEUE_REPO}/issues?state=all&per_page=30&sort=created&direction=desc`
  );

  const bridge = issues.filter(
    (i) => !i.pull_request && typeof i.title === 'string' && i.title.startsWith(BRIDGE_PREFIX)
  );

  const results = await listResults();

  return bridge.slice(0, 15).map((issue) => {
    const req = toRequest(issue);
    const result = results.get(req.id);
    if (result) {
      req.status = 'answered';
      req.answer = result.answer;
      req.answeredAt = result.answered_at;
      req.answeredBy = result.answered_by || 'arena session';
    } else if (req.status === 'answered') {
      req.note = 'Issue is closed but no result file was found in the queue repository.';
    }
    return req;
  });
}

async function createRequest(prompt) {
  const requestId = randomUUID();
  const submittedAt = new Date().toISOString();
  const short = prompt.replace(/\s+/g, ' ').slice(0, 60);

  const body = [
    'Submission from the Arena Session Bridge proof of concept.',
    '',
    '```json',
    JSON.stringify({ request_id: requestId, submitted_at: submittedAt, source: 'web', prompt }, null, 2),
    '```',
    '',
    `Consumed by draining open \`${BRIDGE_PREFIX}\` issues with \`node poc/drain.mjs\`.`,
  ].join('\n');

  const issue = await gh(`/repos/${QUEUE_REPO}/issues`, {
    method: 'POST',
    body: { title: `${BRIDGE_PREFIX} ${short}`, body },
  });

  return toRequest(issue);
}

// ---------------------------------------------------------------------------
// Dashboard data (independent of the bridge)
// ---------------------------------------------------------------------------

async function dashboard() {
  const me = await gh('/user');
  const [repos, prs, issues] = await Promise.all([
    gh('/user/repos?sort=updated&per_page=8&affiliation=owner,collaborator'),
    gh(`/search/issues?q=${encodeURIComponent(`is:pr is:open involves:${me.login}`)}&per_page=8&sort=updated`),
    gh(`/search/issues?q=${encodeURIComponent(`is:issue is:open involves:${me.login}`)}&per_page=8&sort=updated`),
  ]);

  let commits = [];
  try {
    commits = await gh(`/repos/${QUEUE_REPO}/commits?per_page=8`);
  } catch { /* empty repo or no access; dashboard still renders */ }

  return {
    user: { login: me.login, name: me.name, avatar: me.avatar_url, url: me.html_url },
    repos: repos.map((r) => ({
      name: r.full_name,
      description: r.description,
      url: r.html_url,
      private: r.private,
      language: r.language,
      updatedAt: r.updated_at,
      stars: r.stargazers_count,
      openIssues: r.open_issues_count,
    })),
    pulls: prs.items.map((p) => ({
      number: p.number,
      title: p.title,
      url: p.html_url,
      repo: p.repository_url.split('/repos/')[1],
      updatedAt: p.updated_at,
      draft: p.draft === true,
    })),
    issues: issues.items.map((i) => ({
      number: i.number,
      title: i.title,
      url: i.html_url,
      repo: i.repository_url.split('/repos/')[1],
      updatedAt: i.updated_at,
      comments: i.comments,
    })),
    commits: commits.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: (c.commit.message || '').split('\n')[0],
      author: c.commit.author?.name || c.author?.login || 'unknown',
      date: c.commit.author?.date,
      url: c.html_url,
    })),
    queueRepo: QUEUE_REPO,
  };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = rel.slice(rel.lastIndexOf('.'));
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        tokenConfigured: Boolean(TOKEN),
        queueRepo: QUEUE_REPO,
        queueBranch: QUEUE_BRANCH,
        resultDir: RESULT_DIR,
        bridgePrefix: BRIDGE_PREFIX,
      });
    }

    if (pathname === '/api/dashboard' && req.method === 'GET') {
      return sendJson(res, 200, await dashboard());
    }

    if (pathname === '/api/requests' && req.method === 'GET') {
      return sendJson(res, 200, { queueRepo: QUEUE_REPO, requests: await listRequests() });
    }

    if (pathname === '/api/requests' && req.method === 'POST') {
      const { prompt } = await readJsonBody(req);
      if (typeof prompt !== 'string' || prompt.trim().length < 3) {
        return sendJson(res, 400, { error: 'prompt must be at least 3 characters' });
      }
      if (prompt.length > 8000) {
        return sendJson(res, 400, { error: 'prompt must be 8000 characters or fewer' });
      }
      return sendJson(res, 201, { request: await createRequest(prompt.trim()) });
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'Unknown API route' });
    }

    return await serveStatic(res, pathname);
  } catch (err) {
    const status = err instanceof GitHubError ? err.status : 500;
    sendJson(res, status >= 400 ? status : 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Arena Session Bridge listening on http://${HOST}:${PORT}`);
  console.log(`Queue repository: ${QUEUE_REPO}`);
  console.log(`GITHUB_TOKEN configured: ${TOKEN ? 'yes' : 'NO — writes and reads will fail'}`);
});
