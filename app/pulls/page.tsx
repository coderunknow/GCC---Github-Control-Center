import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { GitHubErrorNotice, SetupRequired } from '@/components/errors';
import { Badge, Empty, Field, LabelChip, Pagination, Panel, ScopeNote } from '@/components/ui';
import { fetchPullRequests, fetchRepositories } from '@/lib/queries';
import { databaseStatus, enumParam, intParam, safeViewer, strParam } from '@/lib/page';
import { formatNumber, relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const STATES = ['open', 'closed', 'all'] as const;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export default async function PullRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const state = enumParam(params.state, STATES, 'open');
  const repository = strParam(params.repo);
  const author = strParam(params.author);
  const attentionOnly = params.attention === '1';
  const page = intParam(params.page, 1, 40);

  const [viewer, db] = await Promise.all([safeViewer(), Promise.resolve(databaseStatus())]);

  let repoOptions: string[] = [];
  try {
    repoOptions = (await fetchRepositories(2)).repos.map((repo) => repo.fullName);
  } catch {
    repoOptions = [];
  }

  let result: Awaited<ReturnType<typeof fetchPullRequests>> | null = null;
  let error: unknown = null;
  try {
    result = await fetchPullRequests({
      state,
      repository: repository || undefined,
      author: author || undefined,
      // See the issues page: an unscoped search would be GitHub-wide.
      involves: viewer?.login,
      page,
      perPage: PAGE_SIZE,
    });
  } catch (err) {
    error = err;
  }

  const stale = (iso: string) => Date.now() - new Date(iso).getTime() > STALE_MS;
  const visible = result
    ? attentionOnly
      ? result.items.filter((item) => stale(item.updatedAt) || item.draft)
      : result.items
    : [];

  const filterParams = {
    state: state === 'open' ? undefined : state,
    repo: repository || undefined,
    author: author || undefined,
    attention: attentionOnly ? '1' : undefined,
  };

  return (
    <Shell active="/pulls" viewer={viewer} databaseAvailable={db.available}>
      <div className="page-head">
        <h1>Pull requests</h1>
        <p className="lede">
          Pull request mà tài khoản này liên quan tới. Chọn một repository để xem toàn bộ PR của repository đó. Trạng
          thái review chi tiết nằm ở trang chi tiết từng PR vì Search API không trả về trường đó.
        </p>
      </div>

      <SetupRequired />
      {error ? <GitHubErrorNotice error={error} /> : null}

      <Panel>
        <form className="filters" action="/pulls" method="get">
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
          <Field label="Tác giả">
            <input type="text" name="author" defaultValue={author} placeholder="username" aria-label="Tác giả" />
          </Field>
          <Field label="Chế độ xem">
            <select name="attention" defaultValue={attentionOnly ? '1' : ''} aria-label="Chế độ xem">
              <option value="">Tất cả</option>
              <option value="1">Cần chú ý (nháp hoặc quá 7 ngày)</option>
            </select>
          </Field>
          <button type="submit">Áp dụng</button>
          {repository || author || state !== 'open' || attentionOnly ? (
            <Link className="button secondary" href="/pulls">
              Xoá bộ lọc
            </Link>
          ) : null}
        </form>

        {result ? (
          visible.length === 0 ? (
            <Empty>
              {attentionOnly
                ? 'Không có PR nào cần chú ý theo tiêu chí hiện tại (nháp hoặc không cập nhật trong 7 ngày).'
                : 'Không có pull request nào khớp bộ lọc.'}
            </Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Pull request</th>
                      <th>Kho mã</th>
                      <th>Trạng thái</th>
                      <th>Nhãn</th>
                      <th>Cập nhật</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((item) => {
                      const [owner, name] = item.repository.split('/');
                      const isStale = stale(item.updatedAt);
                      return (
                        <tr key={item.id}>
                          <td>
                            <Link href={`/pulls/${owner}/${name}/${item.number}`}>
                              #{item.number} {item.title}
                            </Link>
                            <div className="muted small">
                              {item.author} · {item.comments} bình luận
                            </div>
                          </td>
                          <td className="mono small">{item.repository}</td>
                          <td>
                            {item.draft ? <Badge tone="warn">nháp</Badge> : null}{' '}
                            {item.state === 'open' ? <Badge tone="good">mở</Badge> : <Badge>đã đóng</Badge>}{' '}
                            {isStale && item.state === 'open' ? <Badge tone="bad">quá 7 ngày</Badge> : null}
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
                basePath="/pulls"
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
                : `Phạm vi: pull request liên quan tới @${viewer?.login ?? 'bạn'}.`
            } ${result.pageInfo.scope} Tổng khớp: ${formatNumber(result.totalCount)}.`}
            fetchedAt={result.pageInfo.fetchedAt}
          />
        ) : null}
      </Panel>
    </Shell>
  );
}
