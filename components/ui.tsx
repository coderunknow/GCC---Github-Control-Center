// Shared presentational pieces. Deliberately server-rendered and dependency-free:
// filters and pagination are plain links and GET forms, so no GitHub data (or
// token-derived state) is ever shipped to the client bundle.

import Link from 'next/link';

export function Panel({
  title,
  description,
  actions,
  children,
  id,
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section className="panel" id={id} aria-labelledby={title ? `${id ?? title}-heading` : undefined}>
      {(title || actions) && (
        <div className="panel-head">
          <div>
            {title ? <h2 id={id ? `${id}-heading` : undefined}>{title}</h2> : null}
            {description ? <p className="panel-desc">{description}</p> : null}
          </div>
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value${tone ? ` ${tone}` : ''}`}>{value}</div>
      {note ? <div className="note">{note}</div> : null}
    </div>
  );
}

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'muted';

export function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'bad';
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`banner ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      {title ? <strong>{title} </strong> : null}
      {children}
    </div>
  );
}

/** Data-provenance line: what the numbers cover and when they were fetched. */
export function ScopeNote({ scope, fetchedAt }: { scope: string; fetchedAt?: string }) {
  return (
    <p className="scope">
      {scope}
      {fetchedAt ? (
        <>
          {' · '}
          <time dateTime={fetchedAt}>lấy lúc {new Date(fetchedAt).toLocaleString('vi-VN')}</time>
        </>
      ) : null}
    </p>
  );
}

export function Pagination({
  basePath,
  params,
  page,
  pageSize,
  itemCount,
  totalCount,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  itemCount: number;
  /** Upstream total when the API supplies one; omit when unknown. */
  totalCount?: number;
}) {
  const hasNext = totalCount !== undefined ? page * pageSize < totalCount : itemCount >= pageSize;
  const build = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') search.set(key, value);
    }
    if (target > 1) search.set('page', String(target));
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  if (page === 1 && !hasNext) return null;

  return (
    <nav className="pagination" aria-label="Phân trang">
      {page > 1 ? (
        <Link href={build(page - 1)} rel="prev">
          ← Trang trước
        </Link>
      ) : (
        <span className="disabled">← Trang trước</span>
      )}
      <span className="current">
        Trang {page}
        {totalCount !== undefined ? ` / ${Math.max(1, Math.ceil(totalCount / pageSize))}` : ''}
      </span>
      {hasNext ? (
        <Link href={build(page + 1)} rel="next">
          Trang sau →
        </Link>
      ) : (
        <span className="disabled">Trang sau →</span>
      )}
    </nav>
  );
}

/** A labelled form control used by the filter bars. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function LabelChip({ name, color }: { name: string; color: string }) {
  // Colour comes from GitHub as 6 hex digits; validate before trusting it in a style.
  const safe = /^[0-9a-fA-F]{6}$/.test(color) ? `#${color}` : '#57606a';
  return (
    <span className="label-chip" style={{ borderColor: safe, color: safe }}>
      {name}
    </span>
  );
}
