// Integration tests for the Arena host: real HTTP against an ephemeral port,
// real durable state on disk in a temp directory.
//
// These cover the host/API half of the required test matrix. The Agent Mode
// recovery half cannot be automated here — see docs/ARENA_AGENT_CONNECTIVITY.md
// for what was and was not executed.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHost } from '../host/app.mjs';
import { Store } from '../host/store.mjs';
import { loadConfig } from '../host/auth.mjs';
import type { Server } from 'node:http';

const PASSWORD = 'test-password-123';
const SECRET = 'test-session-secret-value-48-chars-long';
const AGENT_TOKEN = 'test-agent-token-value-16plus';

let dir: string;
let server: Server;
let base: string;
let store: InstanceType<typeof Store>;
let dataFile: string;
let logLines: string[];

async function startHost(leaseTtlMs = 5 * 60 * 1000) {
  const config = loadConfig({ APP_PASSWORD: PASSWORD, SESSION_SECRET: SECRET, AGENT_TOKEN });
  store = new Store(dataFile, { leaseTtlMs });
  logLines = [];
  const app = createHost({ store, config, log: (line: string) => logLines.push(line) });
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', () => resolve()));
  const address = app.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
  server = app;
}

async function stopHost() {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function login(): Promise<string> {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie');
  expect(cookie).toBeTruthy();
  return cookie!.split(';')[0];
}

const human = (cookie: string) => ({ cookie, 'Content-Type': 'application/json' });
const worker = { 'x-agent-token': AGENT_TOKEN, 'Content-Type': 'application/json' };

async function submit(cookie: string, prompt: string) {
  return fetch(`${base}/api/requests`, {
    method: 'POST',
    headers: human(cookie),
    body: JSON.stringify({ prompt }),
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arena-host-test-'));
  dataFile = join(dir, 'state.json');
});

afterEach(async () => {
  if (server?.listening) await stopHost();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
describe('authentication fails closed', () => {
  it('refuses to load config without credentials', () => {
    expect(() => loadConfig({})).toThrow(/fail closed/);
    expect(() => loadConfig({ APP_PASSWORD: 'short' })).toThrow();
    expect(() => loadConfig({ APP_PASSWORD: PASSWORD, SESSION_SECRET: SECRET })).toThrow();
  });

  it('rejects unauthenticated read, write, and worker calls', async () => {
    await startHost();
    expect((await fetch(`${base}/api/requests`)).status).toBe(401);
    expect(
      (await fetch(`${base}/api/requests`, { method: 'POST', body: JSON.stringify({ prompt: 'hello' }) })).status,
    ).toBe(401);
    expect((await fetch(`${base}/api/worker/recover`)).status).toBe(401);
    expect(
      (await fetch(`${base}/api/worker/answer`, { method: 'POST', body: JSON.stringify({ id: 'x', answer: 'y' }) }))
        .status,
    ).toBe(401);
  });

  it('rejects a wrong worker token and a wrong password', async () => {
    await startHost();
    const badToken = await fetch(`${base}/api/worker/state`, { headers: { 'x-agent-token': 'nope' } });
    expect(badToken.status).toBe(401);

    const badLogin = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    expect(badLogin.status).toBe(401);
  });

  it('rejects a forged session cookie', async () => {
    await startHost();
    const res = await fetch(`${base}/api/requests`, {
      headers: { cookie: 'arena_host_session=eyJzdWIiOiJvd25lciJ9.forgedsignature' },
    });
    expect(res.status).toBe(401);
  });

  it('throttles repeated failed logins', async () => {
    await startHost();
    const attempt = () =>
      fetch(`${base}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong' }),
      });
    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) statuses.push((await attempt()).status);
    expect(statuses).toContain(429);
  });
});

// ---------------------------------------------------------------------------
describe('request lifecycle', () => {
  it('accepts, claims, answers, and retrieves a request', async () => {
    await startHost();
    const cookie = await login();

    const created = await submit(cookie, 'Xin chào, đây là yêu cầu thử');
    expect(created.status).toBe(201);
    const { request } = await created.json();
    expect(request.seq).toBe(1);
    expect(request.status).toBe('pending');

    const claimed = await fetch(`${base}/api/worker/claim`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ id: request.id, workerId: 'w1' }),
    });
    expect(claimed.status).toBe(200);
    expect((await claimed.json()).request.status).toBe('claimed');

    const answered = await fetch(`${base}/api/worker/answer`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ id: request.id, answer: 'Câu trả lời thật', workerId: 'w1' }),
    });
    expect(answered.status).toBe(200);
    const final = (await answered.json()).request;
    expect(final.status).toBe('completed');
    expect(final.answer).toBe('Câu trả lời thật');
    expect(final.answeredBy).toBe('w1');

    const fetched = await fetch(`${base}/api/requests/${request.id}`, { headers: { cookie } });
    expect(fetched.status).toBe(200);
    expect((await fetched.json()).request.status).toBe('completed');
  });

  it('rejects invalid prompts and malformed payloads with 4xx', async () => {
    await startHost();
    const cookie = await login();

    expect((await submit(cookie, 'ab')).status).toBe(400);
    expect((await submit(cookie, 'x'.repeat(8001))).status).toBe(400);

    const malformed = await fetch(`${base}/api/requests`, {
      method: 'POST',
      headers: human(cookie),
      body: 'not-json',
    });
    expect(malformed.status).toBe(400);

    const empty = await fetch(`${base}/api/requests`, { method: 'POST', headers: human(cookie) });
    expect(empty.status).toBe(400);

    expect((await submit(cookie, 'valid prompt here')).status).toBe(201);
  });

  it('rejects oversized bodies with 413', async () => {
    await startHost();
    const cookie = await login();
    const huge = JSON.stringify({ prompt: 'x'.repeat(40 * 1024) });
    const res = await fetch(`${base}/api/requests`, { method: 'POST', headers: human(cookie), body: huge });
    expect(res.status).toBe(413);
  });

  it('returns 404 for unknown ids and unknown routes', async () => {
    await startHost();
    const cookie = await login();
    expect(
      (await fetch(`${base}/api/requests/00000000-0000-0000-0000-000000000000`, { headers: { cookie } })).status,
    ).toBe(404);
    expect((await fetch(`${base}/nope`, { headers: { cookie } })).status).toBe(404);
  });

  it('rejects answering a request that was never claimed', async () => {
    await startHost();
    const cookie = await login();
    const { request } = await (await submit(cookie, 'chưa claim')).json();

    const res = await fetch(`${base}/api/worker/answer`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ id: request.id, answer: 'vượt rào', workerId: 'w1' }),
    });
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
describe('idempotency and ownership', () => {
  it('treats an identical duplicate answer as idempotent', async () => {
    await startHost();
    const cookie = await login();
    const { request } = await (await submit(cookie, 'yêu cầu idempotent')).json();

    await fetch(`${base}/api/worker/claim`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ id: request.id, workerId: 'w1' }),
    });
    const first = await fetch(`${base}/api/worker/answer`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ id: request.id, answer: 'cùng nội dung', workerId: 'w1' }),
    });
    expect(first.status).toBe(200);
    expect((await first.json()).idempotent).toBe(false);

    const replay = await fetch(`${base}/api/worker/answer`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ id: request.id, answer: 'cùng nội dung', workerId: 'w1' }),
    });
    expect(replay.status).toBe(200);
    expect((await replay.json()).idempotent).toBe(true);
  });

  it('rejects a different answer for an already completed request', async () => {
    await startHost();
    const cookie = await login();
    const { request } = await (await submit(cookie, 'không được ghi đè')).json();

    await fetch(`${base}/api/worker/claim`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ id: request.id, workerId: 'w1' }),
    });
    await fetch(`${base}/api/worker/answer`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ id: request.id, answer: 'bản gốc', workerId: 'w1' }),
    });

    const overwrite = await fetch(`${base}/api/worker/answer`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ id: request.id, answer: 'bản khác', workerId: 'w2' }),
    });
    expect(overwrite.status).toBe(409);
  });

  it('prevents two workers claiming the same live request', async () => {
    await startHost();
    const cookie = await login();
    const { request } = await (await submit(cookie, 'tranh chấp lease')).json();

    const a = await fetch(`${base}/api/worker/claim`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ id: request.id, workerId: 'worker-a' }),
    });
    expect(a.status).toBe(200);

    const b = await fetch(`${base}/api/worker/claim`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ id: request.id, workerId: 'worker-b' }),
    });
    expect(b.status).toBe(409);
  });

  it('reclaims expired leases so a replacement worker can continue', async () => {
    await startHost(50); // 50ms lease
    const cookie = await login();
    const { request } = await (await submit(cookie, 'worker chết giữa chừng')).json();

    await fetch(`${base}/api/worker/claim`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ id: request.id, workerId: 'worker-a' }),
    });

    await new Promise((r) => setTimeout(r, 80));

    const recover = await fetch(`${base}/api/worker/recover`, { headers: worker });
    const checkpoint = await recover.json();
    expect(checkpoint.waiting.map((r: { id: string }) => r.id)).toContain(request.id);

    const claimedByB = await fetch(`${base}/api/worker/claim`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ id: request.id, workerId: 'worker-b' }),
    });
    expect(claimedByB.status).toBe(200);
    expect((await claimedByB.json()).request.attempts).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe('durability across host restart', () => {
  it('preserves pending requests when the process restarts', async () => {
    await startHost();
    const cookie = await login();
    const { request } = await (await submit(cookie, 'phải sống sót qua restart')).json();
    await stopHost();

    // Fresh process: new Store instance reading the same file, new listener.
    await startHost();
    const cookie2 = await login();
    const res = await fetch(`${base}/api/requests/${request.id}`, { headers: { cookie: cookie2 } });
    expect(res.status).toBe(200);
    const revived = (await res.json()).request;
    expect(revived.id).toBe(request.id);
    expect(revived.status).toBe('pending');
    expect(revived.prompt).toBe('phải sống sót qua restart');
  });

  it('keeps sequence numbers monotonic across restarts', async () => {
    await startHost();
    let cookie = await login();
    const a = await (await submit(cookie, 'yêu cầu một')).json();
    const b = await (await submit(cookie, 'yêu cầu hai')).json();
    expect([a.request.seq, b.request.seq]).toEqual([1, 2]);
    await stopHost();

    await startHost();
    cookie = await login();
    const c = await (await submit(cookie, 'yêu cầu ba')).json();
    expect(c.request.seq).toBe(3);
    // History is retained, not truncated by the restart.
    const all = await (await fetch(`${base}/api/requests`, { headers: { cookie } })).json();
    expect(all.requests).toHaveLength(3);
  });

  it('leaves a valid JSON document on disk after graceful shutdown', async () => {
    await startHost();
    const cookie = await login();
    await submit(cookie, 'kiểm tra file trạng thái');
    await stopHost();

    const raw = JSON.parse(readFileSync(dataFile, 'utf8'));
    expect(raw.version).toBe(1);
    expect(raw.requests).toHaveLength(1);
    expect(raw.lastSeq).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('worker health and control', () => {
  it('reports recover_required when work waits with no live worker', async () => {
    await startHost();
    const cookie = await login();
    await submit(cookie, 'cần worker');

    const state = await (await fetch(`${base}/api/worker/state`, { headers: { cookie } })).json();
    expect(state.state).toBe('recover_required');
    expect(state.waiting).toBe(1);
  });

  it('reports active while heartbeats are fresh', async () => {
    await startHost();
    const beat = await fetch(`${base}/api/worker/heartbeat`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ workerId: 'w1' }),
    });
    expect(beat.status).toBe(200);
    expect((await beat.json()).state).toBe('active');
  });

  it('exposes worker state to the worker token as well as the human session', async () => {
    // Regression: this route was once registered twice, and the human-only copy
    // shadowed the worker copy, so a worker token received 401.
    await startHost();
    const asWorker = await fetch(`${base}/api/worker/state`, { headers: { 'x-agent-token': AGENT_TOKEN } });
    expect(asWorker.status).toBe(200);
    expect((await asWorker.json()).state).toBeDefined();

    const cookie = await login();
    const asHuman = await fetch(`${base}/api/worker/state`, { headers: { cookie } });
    expect(asHuman.status).toBe(200);

    const anonymous = await fetch(`${base}/api/worker/state`);
    expect(anonymous.status).toBe(401);
  });

  it('honours a STOP control request', async () => {
    await startHost();
    const cookie = await login();

    const stopRes = await fetch(`${base}/api/control/stop`, { method: 'POST', headers: { cookie } });
    expect(stopRes.status).toBe(201);
    const { request } = await stopRes.json();
    expect(request.control).toBe(true);

    await fetch(`${base}/api/worker/claim`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ id: request.id, workerId: 'w1' }),
    });
    await fetch(`${base}/api/worker/answer`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ id: request.id, answer: 'đã dừng', workerId: 'w1' }),
    });

    const state = await (await fetch(`${base}/api/worker/state`, { headers: { cookie } })).json();
    expect(state.stopRequested).toBe(true);
  });

  it('exposes a recovery checkpoint for a newly activated worker', async () => {
    await startHost();
    const cookie = await login();
    await submit(cookie, 'việc còn dang dở');

    const checkpoint = await (await fetch(`${base}/api/worker/recover`, { headers: worker })).json();
    expect(checkpoint.waiting).toHaveLength(1);
    expect(checkpoint.waiting[0].prompt).toBe('việc còn dang dở');
    expect(checkpoint.lastSeq).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('no secrets leak', () => {
  it('never returns credentials in any API response', async () => {
    await startHost();
    const cookie = await login();
    await submit(cookie, 'kiểm tra rò rỉ bí mật');

    const bodies = await Promise.all([
      fetch(`${base}/api/requests`, { headers: { cookie } }).then((r) => r.text()),
      fetch(`${base}/api/worker/state`, { headers: { cookie } }).then((r) => r.text()),
      fetch(`${base}/api/worker/recover`, { headers: worker }).then((r) => r.text()),
      fetch(`${base}/api/health`).then((r) => r.text()),
    ]);

    for (const body of bodies) {
      expect(body).not.toContain(PASSWORD);
      expect(body).not.toContain(SECRET);
      expect(body).not.toContain(AGENT_TOKEN);
    }
  });

  it('keeps secrets out of the structured log lines', async () => {
    await startHost();
    const cookie = await login();
    const { request } = await (await submit(cookie, 'kiểm tra log')).json();
    await fetch(`${base}/api/worker/claim`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ id: request.id, workerId: 'w1' }),
    });
    await fetch(`${base}/api/worker/answer`, {
      method: 'POST',
      headers: worker,
      body: JSON.stringify({ id: request.id, answer: 'ok', workerId: 'w1' }),
    });

    const joined = logLines.join('\n');
    expect(joined).toContain('NEW_REQUEST');
    expect(joined).toContain('ANSWER_RECEIVED');
    expect(joined).not.toContain(AGENT_TOKEN);
    expect(joined).not.toContain(PASSWORD);
    expect(joined).not.toContain(SECRET);
  });

  it('health endpoint discloses no configuration values', async () => {
    await startHost();
    const health = await (await fetch(`${base}/api/health`)).json();
    expect(Object.keys(health).sort()).toEqual(['completed', 'host', 'ok', 'total', 'waiting', 'workerState']);
  });
});
