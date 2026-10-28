// Database layer.
//
// Design constraints from the specification:
//   * database-agnostic; `DATABASE_URL` optional
//   * the dashboard must work with no database at all
//   * database-backed features must report "unavailable" honestly rather than
//     pretending data was persisted
//   * no in-memory fake standing in for durable history
//
// A single `SqlStore` implementation runs against any executor, so the tests
// exercise exactly the SQL used in production — against PGlite in-process.

export interface SqlExecutor {
  /** Returns rows. Parameters are positional ($1, $2 …). */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

export type AuditOutcome = 'ok' | 'denied' | 'failed' | 'blocked';

export interface AuditEntry {
  occurredAt: string;
  actor: string;
  action: string;
  target: string | null;
  outcome: AuditOutcome;
  detail: Record<string, unknown>;
}

export interface ReportRecord {
  id: string;
  createdAt: string;
  createdBy: string;
  format: 'csv' | 'json' | 'markdown';
  kind: string;
  rangeFrom: string | null;
  rangeTo: string | null;
  repositories: string[];
  rowCount: number;
  sha256: string;
  incomplete: string[];
}

export interface ReportSummary extends Omit<ReportRecord, 'sha256'> {
  sha256Short: string;
}

export interface DataStore {
  readonly available: boolean;
  /** Why the store is unavailable, or what backend it is. Never a secret. */
  readonly status: { backend: 'postgres' | 'none'; detail: string };
  migrate(): Promise<void>;
  recordAudit(entry: AuditEntry): Promise<void>;
  listAudit(limit: number): Promise<AuditEntry[]>;
  saveReport(record: Omit<ReportRecord, 'id' | 'createdAt'>): Promise<ReportRecord>;
  listReports(limit: number): Promise<ReportSummary[]>;
  getReportContent(id: string): Promise<{ record: ReportRecord; content: string } | null>;
  saveReportWithContent(record: Omit<ReportRecord, 'id' | 'createdAt'> & { content: string }): Promise<ReportRecord>;
}

interface RawAuditRow {
  occurred_at: Date | string;
  actor: string;
  action: string;
  target: string | null;
  outcome: AuditOutcome;
  detail: Record<string, unknown>;
}

interface RawReportRow {
  id: string;
  created_at: Date | string;
  created_by: string;
  format: ReportRecord['format'];
  kind: string;
  range_from: Date | string | null;
  range_to: Date | string | null;
  repositories: string[] | null;
  row_count: number;
  sha256: string;
  incomplete: string[] | null;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class SqlStore implements DataStore {
  readonly available = true;
  readonly status: DataStore['status'];

  constructor(
    private readonly db: SqlExecutor,
    backendDetail: string,
  ) {
    this.status = { backend: 'postgres', detail: backendDetail };
  }

  async migrate(): Promise<void> {
    // The canonical schema is db/schema.sql; it is idempotent. Loading it here
    // would require filesystem access in the request path, so migrations are
    // applied explicitly with `npm run db:migrate` and verified by tests.
  }

  async recordAudit(entry: AuditEntry): Promise<void> {
    await this.db.query(
      `insert into audit_log (occurred_at, actor, action, target, outcome, detail)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [entry.occurredAt, entry.actor, entry.action, entry.target, entry.outcome, JSON.stringify(entry.detail)],
    );
  }

  async listAudit(limit: number): Promise<AuditEntry[]> {
    const rows = await this.db.query<RawAuditRow>(
      `select occurred_at, actor, action, target, outcome, detail
         from audit_log order by occurred_at desc, id desc limit $1`,
      [Math.max(1, Math.min(limit, 200))],
    );
    return rows.map((row) => ({
      occurredAt: iso(row.occurred_at) ?? '',
      actor: row.actor,
      action: row.action,
      target: row.target,
      outcome: row.outcome,
      detail: row.detail ?? {},
    }));
  }

  async saveReportWithContent(
    record: Omit<ReportRecord, 'id' | 'createdAt'> & { content: string },
  ): Promise<ReportRecord> {
    const rows = await this.db.query<RawReportRow>(
      `insert into reports (created_by, format, kind, range_from, range_to, repositories, row_count, sha256, incomplete, content)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id, created_at, created_by, format, kind, range_from, range_to, repositories, row_count, sha256, incomplete`,
      [
        record.createdBy,
        record.format,
        record.kind,
        record.rangeFrom,
        record.rangeTo,
        record.repositories,
        record.rowCount,
        record.sha256,
        record.incomplete,
        record.content,
      ],
    );
    const row = rows[0];
    return {
      id: row.id,
      createdAt: iso(row.created_at) ?? '',
      createdBy: row.created_by,
      format: row.format,
      kind: row.kind,
      rangeFrom: iso(row.range_from),
      rangeTo: iso(row.range_to),
      repositories: row.repositories ?? [],
      rowCount: row.row_count,
      sha256: row.sha256,
      incomplete: row.incomplete ?? [],
    };
  }

  async saveReport(record: Omit<ReportRecord, 'id' | 'createdAt'>): Promise<ReportRecord> {
    return this.saveReportWithContent({ ...record, content: '' });
  }

  async listReports(limit: number): Promise<ReportSummary[]> {
    const rows = await this.db.query<Omit<RawReportRow, 'content'>>(
      `select id, created_at, created_by, format, kind, range_from, range_to, repositories, row_count, sha256, incomplete
         from reports order by created_at desc limit $1`,
      [Math.max(1, Math.min(limit, 100))],
    );
    return rows.map((row) => ({
      id: row.id,
      createdAt: iso(row.created_at) ?? '',
      createdBy: row.created_by,
      format: row.format,
      kind: row.kind,
      rangeFrom: iso(row.range_from),
      rangeTo: iso(row.range_to),
      repositories: row.repositories ?? [],
      rowCount: row.row_count,
      sha256Short: row.sha256.slice(0, 12),
      incomplete: row.incomplete ?? [],
    }));
  }

  async getReportContent(id: string): Promise<{ record: ReportRecord; content: string } | null> {
    const rows = await this.db.query<RawReportRow & { content: string }>(
      `select id, created_at, created_by, format, kind, range_from, range_to, repositories, row_count, sha256, incomplete, content
         from reports where id = $1 limit 1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      record: {
        id: row.id,
        createdAt: iso(row.created_at) ?? '',
        createdBy: row.created_by,
        format: row.format,
        kind: row.kind,
        rangeFrom: iso(row.range_from),
        rangeTo: iso(row.range_to),
        repositories: row.repositories ?? [],
        rowCount: row.row_count,
        sha256: row.sha256,
        incomplete: row.incomplete ?? [],
      },
      content: row.content,
    };
  }
}

/**
 * The store used when `DATABASE_URL` is absent.
 *
 * It stores nothing. Reads return empty arrays; writes throw, so a caller can
 * never believe history was persisted when it was not.
 */
export class UnavailableStore implements DataStore {
  readonly available = false;
  readonly status: DataStore['status'] = {
    backend: 'none',
    detail:
      'Chưa cấu hình DATABASE_URL. Lịch sử bền vững, thông báo lưu trữ và nhật ký kiểm toán đang tắt. Bảng điều khiển và các luồng GitHub trực tiếp vẫn hoạt động.',
  };

  private readonly message =
    'Chức năng này cần DATABASE_URL. Xem .env.example và chạy `npm run db:migrate`.';

  async migrate(): Promise<void> {
    throw new Error(this.message);
  }

  async recordAudit(): Promise<void> {
    throw new Error(this.message);
  }

  async listAudit(): Promise<AuditEntry[]> {
    return [];
  }

  async saveReport(): Promise<ReportRecord> {
    throw new Error(this.message);
  }

  async saveReportWithContent(): Promise<ReportRecord> {
    throw new Error(this.message);
  }

  async listReports(): Promise<ReportSummary[]> {
    return [];
  }

  async getReportContent(): Promise<{ record: ReportRecord; content: string } | null> {
    return null;
  }
}
