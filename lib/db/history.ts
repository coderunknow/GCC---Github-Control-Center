// Report history reads. Kept separate from the store so pages can depend on a
// narrow function instead of the whole data layer.

import type { DataStore, ReportSummary } from './store';

/** Returns [] when the store is unavailable — the caller decides how to say so. */
export async function listReportHistory(store: DataStore, limit: number): Promise<ReportSummary[]> {
  if (!store.available) return [];
  try {
    return await store.listReports(limit);
  } catch {
    // A reachable-but-broken database must not take the page down.
    return [];
  }
}
