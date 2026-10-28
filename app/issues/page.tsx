import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { GitHubErrorNotice, SetupRequired } from '@/components/errors';
import { Badge, Empty, Field, LabelChip, Pagination, Panel, ScopeNote } from '@/components/ui';
import { fetchIssues, fetchRepositories } from '@/lib/queries';
import { databaseStatus, enumParam, intParam, safeViewer, strParam } from '@/lib/page';
import { formatNumber, relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const STATES = ['open', 'closed', 'all'] as const;

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const state = enumParam(params.state, STATES, 'open');
  const repository = strParam(params.repo);
  const label = strParam(params.label);
  const author = strParam(params.author);
  const page = intParam(params.page, 1, 40);

  const [viewer, db] = await Promise.all([safeViewer(), Promise.resolve(databaseStatus())]);

  let repoOptions: string[] = [];
  try {
    const repos = await fetchRepositories(2);
    repoOptions = repos.repos.map((repo) => repo.fullName);
  } catch {
    repoOptions = [];
  }

  let result: Awaited<ReturnType<typeof fetchIssues>> | null = null;
  let error: unknown = null;
  try {
    result = await fetchIssues({
      state,
      repository: repository || undefined,
      label: label || undefined,
      author: author || undefined,
      // Without a repository, scope to the signed-in account. An unscoped
      // search would return GitHub-wide totals as if they were yours.
      involves: viewer?.login,
      page,
      perPage: PAGE_SIZE,
    });
  } catch (err) {
    error = err;
  }

  const filterParams = {
    state: state === 'open' ? undefined : state,
    repo: repository || undefined,
    label: label || undefined,
    author: author || undefined,
  };

  return (
    <Shell active="/issues" viewer={viewer} databaseAvailable={db.available}>
      <div className="page-head">
        <h1>Issues</h1>
        <p className="lede">
          Issue mà tài khoản này liên quan tới (được giao, tạo, nhắc tên hoặc bình luận). Chọn một repository cụ thể để
          lấy toàn bộ issue của repository đó — GitHub Search không thể gộp nhiều repository trong một truy vấn.
        </p>
      </div>

      <SetupRequired />
      {error ? <GitHubErrorNotice error={error} /> : null}

      <Panel>
        <form className="filters" action="/issues" method="get">
          <Field label="Repository">
            <select name="repo" defaultValue={repository} aria-label="Repository">
              <option value="">Tất cả</option>
              {repoOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Trạng thái">
            <select name="state" defaultValue={state} aria-label="Trạng thái">
              <option value="open">Đang mở</option>
              <option value="closed">Đã đóng</option>
              <option value="all">Tất cả</option>
            </select>
          </Field>
          <Field label="Nhãn">
            <input type="text" name="label" defaultValue={label} placeholder="tên nhãn" aria-label="Nhãn" />
          </Field>
          <Field label="Tác giả">
            <input type="text" name="author" defaultValue={author} placeholder="username" aria-label="Tác giả" />
          </Field>
          <button type="submit">Áp dụng</button>
          {repository || label || author || state !== 'open' ? (
            <Link className="button secondary" href="/issues">
              Xoá bộ lọc
            </Link>
          ) : null}
        </form>

        {result ? (
          result.items.length === 0 ? (
            <Empty>Không có issue nào khớp bộ lọc. Đây là kết quả rỗng từ GitHub, không phải lỗi tải dữ liệu.</Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Issue</th>
                      <th>Kho mã</th>
                      <th>Trạng thái</th>
                      <th>Nhãn</th>
                      <th>Cập nhật</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((item) => {
                      const [owner, name] = item.repository.split('/');
                      return (
                        <tr key={item.id}>
                          <td>
                            <Link href={`/issues/${owner}/${name}/${item.number}`}>
                              #{item.number} {item.title}
                            </Link>
                            <div className="muted small">
                              {item.author} · {item.comments} bình luận
                            </div>
                          </td>
                          <td className="mono small">{item.repository}</td>
                          <td>
                            {item.state === 'open' ? <Badge tone="good">mở</Badge> : <Badge>đã đóng</Badge>}
                          </td>
                          <td>
                            {item.labels.length === 0 ? (
                              <span className="muted small">—</span>
                            ) : (
                              item.labels.slice(0, 3).map((entry) => (
                                <LabelChip key={entry.name} name={entry.name} color={entry.color} />
                              ))
                            )}
                          </td>
                          <td className="nowrap muted small">{relativeTime(item.updatedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <Pagination
                basePath="/issues"
                params={filterParams}
                page={page}
                pageSize={PAGE_SIZE}
                itemCount={result.items.length}
                totalCount={Math.min(result.totalCount, 1000)}
              />
            </>
          )
        ) : null}

        {result ? (
          <ScopeNote
            scope={`${
              repository
                ? `Phạm vi: repository ${repository}.`
                : `Phạm vi: issue liên quan tới @${viewer?.login ?? 'bạn'}.`
            } ${result.pageInfo.scope} Tổng khớp: ${formatNumber(result.totalCount)}.`}
            fetchedAt={result.pageInfo.fetchedAt}
          />
        ) : null}
      </Panel>
    </Shell>
  );
}
