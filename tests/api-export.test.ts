// Route-level tests for the export endpoint.
//
// These call the real handler with a real (in-process PostgreSQL) store, so the
// contract between route, store and audit trail is exercised — not just the
// pure builders.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { GET } from '@/app/api/export/[kind]/route';
import { NextRequest } from 'next/server';
import { SqlStore, UnavailableStore, type SqlExecutor } from '@/lib/db/store';
import { __setStoreForTests } from '@/lib/db';

const SCHEMA = readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf8');

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

const repoPayload = [
  {
    id: 1,
    full_name: 'o/r',
    name: 'r',
    owner: { login: 'o' },
    private: false,
    archived: false,
    description: null,
    language: 'TypeScript',
    stargazers_count: 0,
    forks_count: 0,
    open_issues_count: 1,
    default_branch: 'main',
    pushed_at: '2026-01-01T00:00:00Z',
    html_url: 'https://github.com/o/r',
  },
];

async function call(kind: string, query = '') {
  // The handler reads `nextUrl.searchParams`, which only NextRequest provides.
  const request = new NextRequest(`http://localhost:3100/api/export/${kind}${query}`);
  return GET(request, { params: Promise.resolve({ kind }) });
}

let db: PGlite;
let store: SqlStore;

beforeEach(async () => {
  process.env.GITHUB_TOKEN = 'ghp_' + 'D'.repeat(36);
  vi.stubGlobal('fetch', vi.fn(async () => json(repoPayload)));

  db = new PGlite();
  await db.exec(SCHEMA);
  const executor: SqlExecutor = {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return (await db.query<T>(sql, params)).rows;
    },
    async exec(sql: string): Promise<void> {
      await db.exec(sql);
    },
  };
  store = new SqlStore(executor, 'PGlite in-process');
  __setStoreForTests(store);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.GITHUB_TOKEN;
  __setStoreForTests(null);
  await db.close();
});

describe('xuất CSV qua route', () => {
  it('trả đúng header, BOM và số dòng', async () => {
    const response = await call('repos', '?format=csv');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="gpcc-repos-.*\.csv"$/);
    expect(response.headers.get('x-export-rows')).toBe('1');

    // Assert on the wire bytes: `Response.text()` decodes UTF-8 and silently
    // strips a leading BOM, so a text-based assertion would pass even if the
    // BOM were missing from the download.
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

    const body = new TextDecoder().decode(bytes);
    expect(body).toContain('fullName');
    expect(body).toContain('o/r');
    expect(body).toContain('\r\n');
  });

  it('ghi lịch sử báo cáo và một dòng kiểm toán', async () => {
    const response = await call('repos', '?format=csv');
    await response.text();

    expect(response.headers.get('x-export-recording')).toBe('recorded');

    const reports = await store.listReports(10);
    expect(reports).toHaveLength(1);
    expect(reports[0].kind).toBe('repos');
    expect(reports[0].format).toBe('csv');
    expect(reports[0].rowCount).toBe(1);

    const audit = await store.listAudit(10);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('export.repos');
    expect(audit[0].outcome).toBe('ok');
    expect(audit[0].detail).toMatchObject({ format: 'csv', rowCount: 1 });
  });

  it('SHA-256 lưu lại khớp nội dung thực tế đã tải', async () => {
    const response = await call('repos', '?format=csv');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256').update(bytes).digest('hex');

    const [summary] = await store.listReports(1);
    const stored = await store.getReportContent(summary.id);
    // The recorded hash must match the bytes the user actually receives.
    expect(stored?.record.sha256).toBe(expected);
    expect(stored?.content).toBe(new TextDecoder().decode(bytes));
  });
});

describe('xuất JSON qua route', () => {
  it('giữ metadata phạm vi trong tệp', async () => {
    const response = await call('repos', '?format=json');
    expect(response.status).toBe(200);
    const parsed = JSON.parse(await response.text()) as {
      meta: { kind: string; rowCount: number; generatedAt: string; incomplete: string[] };
      rows: unknown[];
    };
    expect(parsed.meta.kind).toBe('repos');
    expect(parsed.meta.rowCount).toBe(1);
    expect(parsed.meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.rows).toHaveLength(1);
  });
});

describe('đầu vào không hợp lệ', () => {
  it('404 cho loại xuất lạ', async () => {
    const response = await call('secrets');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('không hợp lệ') });
  });

  it('400 cho định dạng lạ', async () => {
    const response = await call('repos', '?format=exe');
    expect(response.status).toBe(400);
  });

  it('không ghi lịch sử khi yêu cầu không hợp lệ', async () => {
    await call('repos', '?format=exe');
    expect(await store.listReports(10)).toHaveLength(0);
  });
});

describe('khi thiếu cơ sở dữ liệu', () => {
  it('vẫn tải được tệp và báo rõ là không ghi lịch sử', async () => {
    __setStoreForTests(new UnavailableStore());
    const response = await call('repos', '?format=csv');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-export-recording')).toBe('skipped:no-database');
    expect((await response.text()).length).toBeGreaterThan(0);
  });
});

describe('khi GitHub lỗi', () => {
  it('ánh xạ lỗi quyền thành 403, không trả tệp rỗng', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const response = await call('repos', '?format=csv');
    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('quyền');
  });

  it('không ghi lịch sử khi xuất thất bại', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'boom' }), { status: 500 })),
    );
    await call('repos', '?format=csv');
    expect(await store.listReports(10)).toHaveLength(0);
  });
});
