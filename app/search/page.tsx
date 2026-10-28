import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { GitHubErrorNotice, SetupRequired } from '@/components/errors';
import { Badge, Empty, Field, Notice, Pagination, Panel, ScopeNote } from '@/components/ui';
import { searchAll } from '@/lib/queries';
import { databaseStatus, enumParam, intParam, safeViewer, strParam } from '@/lib/page';
import { formatNumber, relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const KINDS = ['all', 'issues', 'pulls', 'repos'] as const;
const PAGE_SIZE = 20;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const term = strParam(params.q);
  const kind = enumParam(params.kind, KINDS, 'all');
  const page = intParam(params.page, 1, 40);

  const [viewer, db] = await Promise.all([safeViewer(), Promise.resolve(databaseStatus())]);

  let result: Awaited<ReturnType<typeof searchAll>> | null = null;
  let error: unknown = null;
  if (term.length > 0) {
    try {
      result = await searchAll(term, kind, page);
    } catch (err) {
      error = err;
    }
  }

  const reportHref = `/api/export/search?q=${encodeURIComponent(term)}&kind=${kind}`;

  return (
    <Shell active="/search" viewer={viewer} databaseAvailable={db.available}>
      <div className="page-head">
        <h1>Tìm kiếm</h1>
        <p className="lede">
          Tìm issue, pull request và repository trên GitHub. Kết quả do GitHub xếp hạng; ứng dụng chỉ hiển thị lại.
        </p>
      </div>

      <SetupRequired />
      {error ? <GitHubErrorNotice error={error} /> : null}

      <Panel>
        <form className="filters" action="/search" method="get" role="search">
          <Field label="Từ khoá">
            <input
              type="search"
              name="q"
              defaultValue={term}
              placeholder="ví dụ: login timeout repo:coderunknow/Testing"
              aria-label="Từ khoá tìm kiếm"
            />
          </Field>
          <Field label="Phạm vi">
            <select name="kind" defaultValue={kind} aria-label="Phạm vi">
              <option value="all">Tất cả</option>
              <option value="issues">Issue</option>
              <option value="pulls">Pull request</option>
              <option value="repos">Repository</option>
            </select>
          </Field>
          <button type="submit">Tìm</button>
          {term ? (
            <a className="button secondary" href={reportHref}>
              Xuất CSV
            </a>
          ) : null}
        </form>

        {!term ? (
          <Empty>
            Nhập từ khoá để tìm. Hỗ trợ cú pháp GitHub như <span className="mono">repo:</span>,{' '}
            <span className="mono">is:open</span>, <span className="mono">author:</span>.
          </Empty>
        ) : null}

        {result ? (
          <>
            {result.notes.map((note) => (
              <Notice key={note} tone="warn">
                {note}
              </Notice>
            ))}

            {result.results.length === 0 ? (
              <Empty>Không có kết quả nào khớp từ khoá.</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Kết quả</th>
                      <th>Loại</th>
                      <th>Cập nhật</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.results.map((item) => {
                      const [owner, name] = item.subtitle.split('/');
                      const canLinkInternally = item.kind === 'repository' && owner && name;
                      return (
                        <tr key={`${item.kind}-${item.htmlUrl}`}>
                          <td>
                            {canLinkInternally ? (
                              <Link href={`/repos/${owner}/${name}`}>{item.title}</Link>
                            ) : (
                              <a href={item.htmlUrl} target="_blank" rel="noreferrer noopener">
                                {item.title}
                              </a>
                            )}
                            {item.subtitle ? <div className="muted small">{item.subtitle}</div> : null}
                          </td>
                          <td>
                            <Badge tone={item.kind === 'repository' ? 'info' : 'muted'}>{item.kind}</Badge>{' '}
                            {item.extra ? <Badge>{item.extra}</Badge> : null}
                          </td>
                          <td className="nowrap muted small">{relativeTime(item.updatedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <Pagination
              basePath="/search"
              params={{ q: term, kind: kind === 'all' ? undefined : kind }}
              page={page}
              pageSize={PAGE_SIZE}
              itemCount={result.results.length}
            />
            <ScopeNote
              scope={`Tổng khớp theo GitHub: ${formatNumber(result.totalCount)} (tối đa 1000 kết quả truy cập được). Trang ${page}.`}
              fetchedAt={result.fetchedAt}
            />
          </>
        ) : null}
      </Panel>
    </Shell>
  );
}
