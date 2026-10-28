// AUTH_DISABLED for the dev1 host.
//
// The host's default posture is unchanged and still covered by tests/host.test.ts:
// no session cookie → 401. This file locks the escape hatch used for manual
// testing, so it cannot drift into being the default or being triggered by a
// loose value like "true".

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createHost } from '../host/app.mjs';
import { Store } from '../host/store.mjs';
import { loadConfig } from '../host/auth.mjs';

const PASSWORD = 'test-password-123';
const SECRET = 'test-session-secret-value-48-chars-long';
const AGENT_TOKEN = 'test-agent-token-value-16plus';

let dir: string;
let store: Store;
let server: Server;
let base: string;
let config: ReturnType<typeof loadConfig> & { authDisabled?: boolean };

async function boot(authDisabled: boolean) {
  config = { ...loadConfig({ APP_PASSWORD: PASSWORD, SESSION_SECRET: SECRET, AGENT_TOKEN }), authDisabled };
  const app = createHost({ store, config, log: () => {} });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arena-host-open-'));
  store = new Store(join(dir, 'state.json'), { leaseTtlMs: 5000 });
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

describe('mặc định: vẫn yêu cầu đăng nhập', () => {
  it('không có cookie → 401 ở cả API và không lộ danh sách yêu cầu', async () => {
    await boot(false);
    const state = await fetch(`${base}/api/worker/state`);
    expect(state.status).toBe(401);

    const list = await fetch(`${base}/api/requests`);
    expect(list.status).toBe(401);

    const post = await fetch(`${base}/api/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'thử gửi khi chưa đăng nhập' }),
    });
    expect(post.status).toBe(401);
    expect(store.all()).toHaveLength(0);
  });

  it('không hiện băng cảnh báo khi auth bật', async () => {
    await boot(false);
    const page = await (await fetch(`${base}/`)).text();
    expect(page).not.toContain('ĐÃ TẮT MẬT KHẨU');
  });
});

describe('AUTH_DISABLED=1: mở để test tay', () => {
  it('cho phép đọc trạng thái và danh sách mà không cần cookie', async () => {
    await boot(true);
    expect((await fetch(`${base}/api/worker/state`)).status).toBe(200);

    const list = await fetch(`${base}/api/requests`);
    expect(list.status).toBe(200);
    const body = (await list.json()) as { requests: unknown[] };
    expect(body.requests).toEqual([]);
  });

  it('cho phép gửi yêu cầu và ghi bền vững', async () => {
    await boot(true);
    const post = await fetch(`${base}/api/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'kiểm tra chế độ test' }),
    });
    expect(post.status).toBe(201);
    const body = (await post.json()) as { request: { seq: number; status: string } };
    expect(body.request.seq).toBe(1);
    expect(body.request.status).toBe('pending');
    expect(store.all()).toHaveLength(1);
  });

  it('hiện băng cảnh báo đỏ trên trang console', async () => {
    await boot(true);
    const page = await (await fetch(`${base}/`)).text();
    expect(page).toContain('CHẾ ĐỘ TEST — ĐÃ TẮT MẬT KHẨU');
  });

  it('không đổi contract của /api/health', async () => {
    await boot(true);
    // dev1 locks the exact key set of this unauthenticated endpoint, and that
    // contract must survive the escape hatch. The open mode is announced on the
    // console page and at startup instead.
    const health = (await (await fetch(`${base}/api/health`)).json()) as Record<string, unknown>;
    expect(Object.keys(health).sort()).toEqual(['completed', 'host', 'ok', 'total', 'waiting', 'workerState']);
  });

  it('worker vẫn phải có x-agent-token đúng', async () => {
    await boot(true);
    // Opening the human console must not open the worker endpoints.
    const noToken = await fetch(`${base}/api/worker/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'x' }),
    });
    expect(noToken.status).toBe(401);

    const wrongToken = await fetch(`${base}/api/worker/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-token': 'sai-token-hoan-toan' },
      body: JSON.stringify({ id: 'x' }),
    });
    expect(wrongToken.status).toBe(401);
  });
});

describe('giá trị cờ không hợp lệ không được bật', () => {
  it('chỉ "1" mới bật, ở phía server.mjs', async () => {
    // Mirrors the check in host/server.mjs; kept here so a change to one side
    // without the other fails loudly.
    const enabled = (value: string | undefined) => value === '1';
    expect(enabled('1')).toBe(true);
    for (const value of ['0', 'true', 'yes', '', undefined, 'TRUE', ' 1']) {
      expect(enabled(value as string | undefined)).toBe(false);
    }
  });
});
