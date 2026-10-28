#!/usr/bin/env node
// Session-side consumer for the Arena Session Bridge.
//
// This script only TRANSPORTS queue items. It contains no model and makes no
// decisions: the Arena Agent Mode session supplies the answer text, then calls
// `answer` to persist it. That separation is deliberate — it is what makes the
// proof of concept prove that *the session* did the work, rather than a script
// pretending to.
//
// Answer channel: a JSON record committed under queue/results/. This is used
// instead of issue comments because the credential available inside the Arena
// sandbox is a GitHub App installation token that can create and read issues but
// returns 403 "Resource not accessible by integration" for comments and for
// closing issues (verified 2026-10-28). Committing works. A user-supplied PAT
// scoped to issues:write can use either channel; comments are attempted
// best-effort and their failure is reported, never treated as success.
//
// Usage:
//   node poc/drain.mjs list
//   node poc/drain.mjs answer <issueNumber> <path-to-answer-file> [--no-push]

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.QUEUE_REPO || 'coderunknow/Testing';
const PREFIX = '[arena-bridge]';
const RESULT_DIR = 'queue/results';
const MARKER = '<!-- arena-bridge:result -->';

if (!TOKEN) {
  console.error('GITHUB_TOKEN is required.');
  process.exit(1);
}

async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'arena-session-bridge-drain',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`GitHub ${method} ${path} -> ${res.status} ${detail.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

function parsePayload(body = '') {
  const fenced = body.match(/```json\s*([\s\S]*?)```/i);
  try {
    return JSON.parse((fenced ? fenced[1] : body).trim());
  } catch {
    return {};
  }
}

async function list() {
  const issues = await gh(`/repos/${REPO}/issues?state=open&per_page=50&sort=created&direction=asc`);
  const pending = issues.filter(
    (i) => !i.pull_request && typeof i.title === 'string' && i.title.startsWith(PREFIX)
  );

  if (!pending.length) {
    console.log('No pending requests.');
    return;
  }

  console.log(JSON.stringify(
    pending.map((issue) => {
      const payload = parsePayload(issue.body || '');
      return {
        issueNumber: issue.number,
        requestId: payload.request_id,
        submittedAt: payload.submitted_at,
        prompt: payload.prompt,
        url: issue.html_url,
      };
    }),
    null,
    2
  ));
}

async function answer(issueNumber, answerPath, { push = true } = {}) {
  const text = (await readFile(answerPath, 'utf8')).trim();
  if (!text) throw new Error('Answer file is empty.');

  const issue = await gh(`/repos/${REPO}/issues/${issueNumber}`);
  const payload = parsePayload(issue.body || '');
  const requestId = payload.request_id || `issue-${issueNumber}`;

  const record = {
    request_id: requestId,
    issue_number: issueNumber,
    submitted_at: payload.submitted_at ?? null,
    answered_at: new Date().toISOString(),
    answered_by: 'arena-agent-mode-session',
    answer: text,
  };

  const dir = join(process.cwd(), RESULT_DIR);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${requestId}.json`);
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${RESULT_DIR}/${requestId}.json`);

  if (push) {
    try {
      execFileSync('git', ['add', file], { stdio: 'pipe' });
      execFileSync(
        'git',
        ['commit', '-m', `queue: answer request ${requestId} (issue #${issueNumber})`],
        { stdio: 'pipe' }
      );
      execFileSync('git', ['push', 'origin', 'HEAD'], { stdio: 'pipe' });
      console.log('Committed and pushed the answer record.');
    } catch (err) {
      console.error(`Could not commit/push the answer: ${err.message}`);
      process.exitCode = 1;
    }
  }

  // Best-effort only. Failure here is expected with an App installation token.
  try {
    await gh(`/repos/${REPO}/issues/${issueNumber}/comments`, {
      method: 'POST',
      body: { body: `${MARKER}\n${text}` },
    });
    console.log('Also posted the answer as an issue comment.');
  } catch (err) {
    console.log(`Issue comment not permitted by this credential (${err.status || 'error'}) — the committed result file is authoritative.`);
  }

  try {
    await gh(`/repos/${REPO}/issues/${issueNumber}`, {
      method: 'PATCH',
      body: { state: 'closed' },
    });
    console.log(`Closed issue #${issueNumber}.`);
  } catch (err) {
    console.log(`Could not close issue #${issueNumber} (${err.status || 'error'}) — leaving it open; the result file still answers it.`);
  }
}

const argv = process.argv.slice(2);
const push = !argv.includes('--no-push');
const [command, ...rest] = argv.filter((a) => a !== '--no-push');

try {
  if (command === 'list') {
    await list();
  } else if (command === 'answer' && rest.length === 2) {
    await answer(Number(rest[0]), rest[1], { push });
  } else {
    console.error('Usage: node poc/drain.mjs list | node poc/drain.mjs answer <issueNumber> <answerFile> [--no-push]');
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
