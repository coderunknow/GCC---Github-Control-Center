// Store selection. Server-only.
//
// A single process-wide instance is memoised. Connecting lazily means the
// dashboard never pays for a database it does not use — and still works when
// DATABASE_URL is absent.

import { SqlStore, UnavailableStore, type DataStore, type SqlExecutor } from './store';

let cached: DataStore | null = null;

/** Redacts credentials from a connection string before it is ever displayed. */
export function describeDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const db = parsed.pathname.replace(/^\//, '') || '(không tên)';
    const ssl = parsed.searchParams.get('sslmode') ?? 'mặc định';
    return `Postgres tại ${host}, database "${db}", sslmode=${ssl}`;
  } catch {
    return 'DATABASE_URL không phải URL hợp lệ';
  }
}

function createExecutor(url: string): SqlExecutor {
  // Imported lazily so a deployment without DATABASE_URL never loads the driver.
  type SqlClient = {
    unsafe(query: string, params?: unknown[]): PromiseLike<unknown>;
  };
  let clientPromise: Promise<SqlClient> | null = null;

  const getClient = (): Promise<SqlClient> => {
    if (!clientPromise) {
      clientPromise = import('postgres').then((mod) => {
        const factory = (mod.default ?? mod) as unknown as (connectionString: string, options: Record<string, unknown>) => SqlClient;
        return factory(url, { max: 4, idle_timeout: 20, connect_timeout: 10, prepare: false });
      });
    }
    return clientPromise;
  };

  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const client = await getClient();
      const result = await client.unsafe(sql, params);
      return result as unknown as T[];
    },
    async exec(sql: string): Promise<void> {
      const client = await getClient();
      await client.unsafe(sql);
    },
  };
}

export function getStore(): DataStore {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) {
    cached = new UnavailableStore();
    return cached;
  }

  cached = new SqlStore(createExecutor(url), describeDatabaseUrl(url));
  return cached;
}

/** Test seam: replaces the memoised store. */
export function __setStoreForTests(store: DataStore | null): void {
  cached = store;
}
