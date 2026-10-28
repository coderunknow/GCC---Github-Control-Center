// Middleware tests: the deny-by-default contract, and the explicit
// AUTH_DISABLED escape hatch that must never turn itself on.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { SESSION_COOKIE, authDisabled } from '@/lib/auth';

const SECRET = 'test-session-secret-value-48-chars-long';

function request(path: string, cookie?: string): NextRequest {
  const req = new NextRequest(`http://localhost:3100${path}`);
  if (cookie) req.cookies.set(SESSION_COOKIE, cookie);
  return req;
}

/** A redirect is identified by its status; a pass-through carries no location. */
function outcome(response: Response): 'pass' | 'redirect' | 'unauthorized' {
  if (response.status === 401) return 'unauthorized';
  if (response.status >= 300 && response.status < 400) return 'redirect';
  return 'pass';
}

beforeEach(() => {
  process.env.APP_PASSWORD = 'demo-password';
  process.env.SESSION_SECRET = SECRET;
  delete process.env.AUTH_DISABLED;
});

afterEach(() => {
  delete process.env.AUTH_DISABLED;
});

describe('mặc định: từ chối mọi truy cập chưa đăng nhập', () => {
  it('chặn trang và chuyển về /login', async () => {
    for (const path of ['/', '/repos', '/pulls', '/reports', '/health']) {
      const response = await middleware(request(path));
      expect(outcome(response)).toBe('redirect');
      expect(response.headers.get('location')).toContain('/login');
    }
  });

  it('trả 401 cho API, không chuyển hướng', async () => {
    const response = await middleware(request('/api/export/repos'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('cho phép đúng ba đường dẫn công khai', async () => {
    for (const path of ['/login', '/api/login', '/api/health']) {
      expect(outcome(await middleware(request(path)))).toBe('pass');
    }
  });

  it('từ chối cookie rỗng hoặc giả mạo', async () => {
    expect(outcome(await middleware(request('/', 'not-a-token')))).toBe('redirect');
    expect(outcome(await middleware(request('/', '')))).toBe('redirect');
  });
});

describe('AUTH_DISABLED — chỉ bật khi được đặt tường minh', () => {
  it('mặc định là tắt', () => {
    expect(authDisabled()).toBe(false);
  });

  it('chỉ giá trị "1" mới bật', () => {
    for (const value of ['0', 'true', 'yes', '', 'TRUE']) {
      process.env.AUTH_DISABLED = value;
      expect(authDisabled()).toBe(false);
    }
    process.env.AUTH_DISABLED = '1';
    expect(authDisabled()).toBe(true);
  });

  it('khi bật, mọi trang và API đều đi qua', async () => {
    process.env.AUTH_DISABLED = '1';
    for (const path of ['/', '/repos', '/api/export/repos', '/pulls/coderunknow/Testing/1']) {
      expect(outcome(await middleware(request(path)))).toBe('pass');
    }
  });

  it('khi bật, không cần APP_PASSWORD hay SESSION_SECRET', async () => {
    process.env.AUTH_DISABLED = '1';
    delete process.env.APP_PASSWORD;
    delete process.env.SESSION_SECRET;
    expect(outcome(await middleware(request('/')))).toBe('pass');
  });
});
