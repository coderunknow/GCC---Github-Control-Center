// Database tests against a real PostgreSQL engine (PGlite, in-process).
//
// These run the exact SQL used in production, including the canonical
// db/schema.sql, so a schema drift or a wrong column name fails here rather
// than in a deployment.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { SqlStore, UnavailableStore, type SqlExecutor } from '@/lib/db/store';
import { __setStoreForTests, describeDatabaseUrl, getStore } from '@/lib/db';
import { listReportHistory } from '@/lib/db/history';

const SCHEMA = readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf8');

function executorFor(db: PGlite): SqlExecutor {
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await db.query<T>(sql, params);
      return result.rows;
    },
    async exec(sql: string): Promise<void> {
      await db.exec(sql);
    },
  };
}

let db: PGlite;
let store: SqlStore;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  store = new SqlStore(executorFor(db), 'PGlite in-process');
});

afterEach(async () => {
  await db.close();
  __setStoreForTests(null);
  delete process.env.DATABASE_URL;
});

describe('schema', () => {
  it('chạy được hai lần liên tiếp (idempotent)', async () => {
    // Re-running must not throw: deployments apply the file on every migrate.
    await expect(db.exec(SCHEMA)).resolves.toBeDefined();
  });

  it('có cột kind để phân biệt loại báo cáo', async () => {
    const result = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'reports'`,
    );
    expect(result.rows.map((row) => row.column_name)).toContain('kind');
  });

  it('tạo đủ các bảng mà ứng dụng dùng', async () => {
    const result = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = result.rows.map((row) => row.table_name);
    expect(names).toEqual(
      expect.arrayContaining(['audit_log', 'reports', 'github_events', 'notifications', 'repositories']),
    );
  });

  it('từ chối delivery_state không nằm trong danh sách cho phép', async () => {
    // There is no 'delivered' state, because Arena offers no inbound trigger.
    await expect(
      db.query(
        `insert into arena_requests (requested_by, title, body, delivery_state) values ('u', 't', 'b', 'delivered')`,
      ),
    ).rejects.toThrow();
  });

  it('chống trùng sự kiện đã poll qua unique index', async () => {
    const insert = (hash: string) =>
      db.query(
        `insert into github_events (event_type, source, payload_sha256) values ('push', 'poll', $1)`,
        [hash],
      );
    await insert('abc');
    await expect(insert('abc')).rejects.toThrow();
  });
});

describe('nhật ký kiểm toán', () => {
  it('ghi và đọc lại, mới nhất trước', async () => {
    await store.recordAudit({
      occurredAt: '2026-01-01T00:00:00.000Z',
      actor: 'session',
      action: 'export.repos',
      target: 'repos',
      outcome: 'ok',
      detail: { rows: 3 },
    });
    await store.recordAudit({
      occurredAt: '2026-01-02T00:00:00.000Z',
      actor: 'session',
      action: 'export.issues',
      target: 'issues',
      outcome: 'denied',
      detail: { reason: 'quyền' },
    });

    const entries = await store.listAudit(10);
    expect(entries).toHaveLength(2);
    expect(entries[0].action).toBe('export.issues');
    expect(entries[0].outcome).toBe('denied');
    expect(entries[0].detail).toEqual({ reason: 'quyền' });
    expect(entries[1].occurredAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('giới hạn limit và không trả về quá số yêu cầu', async () => {
    for (let i = 0; i < 5; i += 1) {
      await store.recordAudit({
        occurredAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
        actor: 'session',
        action: `action-${i}`,
        target: null,
        outcome: 'ok',
        detail: {},
      });
    }
    expect(await store.listAudit(2)).toHaveLength(2);
    expect(await store.listAudit(999)).toHaveLength(5);
  });

  it('từ chối outcome ngoài enum thay vì ghi dữ liệu rác', async () => {
    await expect(
      store.recordAudit({
        occurredAt: new Date().toISOString(),
        actor: 'session',
        action: 'x',
        target: null,
        outcome: 'weird' as never,
        detail: {},
      }),
    ).rejects.toThrow();
  });
});

describe('báo cáo', () => {
  const base = {
    createdBy: 'session',
    format: 'csv' as const,
    kind: 'issues',
    rangeFrom: null,
    rangeTo: null,
    repositories: ['o/r'],
    rowCount: 2,
    sha256: 'f'.repeat(64),
    incomplete: ['Chỉ trang đầu.'],
  };

  it('lưu kèm nội dung và đọc lại đúng từng ký tự', async () => {
    const content = 'a,"b,c"\r\n1,2\r\n';
    const saved = await store.saveReportWithContent({ ...base, content });
    expect(saved.id).toBeTruthy();
    expect(saved.rowCount).toBe(2);

    const fetched = await store.getReportContent(saved.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.content).toBe(content);
    expect(fetched?.record.incomplete).toEqual(['Chỉ trang đầu.']);
  });

  // The UTF-8 BOM is verified at the point it matters — the CSV builder that
  // produces the downloaded bytes (see tests/csv.test.ts). PGlite strips a
  // leading BOM when decoding text columns, so asserting it here would test the
  // driver, not this application. With a real PostgreSQL server the value is
  // stored verbatim.
  it('lưu được nội dung dài nhiều KB không bị cắt', async () => {
    const long = `${'x'.repeat(20_000)}\r\n`;
    const saved = await store.saveReportWithContent({ ...base, content: long });
    const fetched = await store.getReportContent(saved.id);
    expect(fetched?.content.length).toBe(long.length);
  });

  it('danh sách chỉ trả metadata, không trả nội dung tệp', async () => {
    await store.saveReportWithContent({ ...base, content: 'bí mật nội dung' });
    const list = await store.listReports(10);
    expect(list).toHaveLength(1);
    expect(list[0].sha256Short).toBe('f'.repeat(12));
    expect(list[0]).not.toHaveProperty('content');
  });

  it('trả null cho id không tồn tại', async () => {
    expect(await store.getReportContent('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('từ chối định dạng ngoài enum', async () => {
    await expect(
      store.saveReportWithContent({ ...base, format: 'pdf' as never, content: '' }),
    ).rejects.toThrow();
  });
});

describe('khi chưa cấu hình DATABASE_URL', () => {
  it('getStore trả về store không khả dụng thay vì ném lỗi', () => {
    delete process.env.DATABASE_URL;
    __setStoreForTests(null);
    const store2 = getStore();
    expect(store2.available).toBe(false);
    expect(store2.status.backend).toBe('none');
    expect(store2.status.detail).toContain('DATABASE_URL');
  });

  it('đọc trả rỗng nhưng ghi phải ném lỗi rõ ràng', async () => {
    const unavailable = new UnavailableStore();
    expect(await unavailable.listAudit(10)).toEqual([]);
    expect(await unavailable.listReports(10)).toEqual([]);
    expect(await unavailable.getReportContent('x')).toBeNull();
    await expect(
      unavailable.recordAudit({
        occurredAt: new Date().toISOString(),
        actor: 'a',
        action: 'b',
        target: null,
        outcome: 'ok',
        detail: {},
      }),
    ).rejects.toThrow(/DATABASE_URL/);
  });

  it('listReportHistory trả rỗng thay vì làm sập trang', async () => {
    expect(await listReportHistory(new UnavailableStore(), 10)).toEqual([]);
  });

  it('lỗi cơ sở dữ liệu không làm sập trang báo cáo', async () => {
    const broken: SqlExecutor = {
      async query<T>(): Promise<T[]> {
        throw new Error('connection refused');
      },
      async exec(): Promise<void> {
        throw new Error('connection refused');
      },
    };
    const brokenStore = new SqlStore(broken, 'broken');
    // available stays true, but the read is swallowed so the page still renders.
    expect(brokenStore.available).toBe(true);
    expect(await listReportHistory(brokenStore, 10)).toEqual([]);
  });
});

describe('mô tả kết nối không lộ mật khẩu', () => {
  it('che thông tin xác thực trong DATABASE_URL', () => {
    const described = describeDatabaseUrl('postgres://user:supersecret@db.example.com:5432/appdb?sslmode=require');
    expect(described).toContain('db.example.com');
    expect(described).toContain('appdb');
    expect(described).not.toContain('supersecret');
    expect(described).not.toContain('user:');
  });

  it('báo lỗi mềm khi URL không hợp lệ', () => {
    expect(describeDatabaseUrl('not a url')).toBe('DATABASE_URL không phải URL hợp lệ');
  });
});
