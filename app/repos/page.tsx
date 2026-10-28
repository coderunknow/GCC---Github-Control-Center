import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { GitHubErrorNotice, SetupRequired } from '@/components/errors';
import { Badge, Empty, Field, Pagination, Panel, ScopeNote } from '@/components/ui';
import { fetchRepositories, type RepositorySummary } from '@/lib/queries';
import { databaseStatus, enumParam, intParam, safeViewer, strParam } from '@/lib/page';
import { formatNumber, relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const SORTS = ['pushed', 'name', 'stars', 'issues'] as const;
const VISIBILITY = ['all', 'public', 'private'] as const;

type Sort = (typeof SORTS)[number];
type Visibility = (typeof VISIBILITY)[number];

function sortRepos(repos: RepositorySummary[], sort: Sort): RepositorySummary[] {
  const copy = [...repos];
  switch (sort) {
    case 'name':
      return copy.sort((a, b) => a.fullName.localeCompare(b.fullName));
    case 'stars':
      return copy.sort((a, b) => b.stars - a.stars);
    case 'issues':
      return copy.sort((a, b) => b.openIssues - a.openIssues);
    case 'pushed':
    default:
      return copy.sort((a, b) => (a.pushedAt ?? '') < (b.pushedAt ?? '') ? 1 : -1);
  }
}

export default async function RepositoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = strParam(params.q).toLowerCase();
  const sort = enumParam(params.sort, SORTS, 'pushed');
  const visibility = enumParam(params.visibility, VISIBILITY, 'all');
  const language = strParam(params.language);
  const page = intParam(params.page, 1, 200);

  const [viewer, db] = await Promise.all([safeViewer(), Promise.resolve(databaseStatus())]);

  let repos: RepositorySummary[] = [];
  let scope = '';
  let fetchedAt = '';
  let error: unknown = null;

  try {
    const result = await fetchRepositories(5);
    repos = result.repos;
    scope = result.pageInfo.scope;
    fetchedAt = result.pageInfo.fetchedAt;
  } catch (err) {
    error = err;
  }

  const languages = [...new Set(repos.map((repo) => repo.language).filter((value): value is string => Boolean(value)))].sort();

  const filtered = repos.filter((repo) => {
    if (visibility === 'public' && repo.isPrivate) return false;
    if (visibility === 'private' && !repo.isPrivate) return false;
    if (language && repo.language !== language) return false;
    if (query) {
      const haystack = `${repo.fullName} ${repo.description ?? ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const sorted = sortRepos(filtered, sort);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const filterParams = {
    q: query || undefined,
    sort,
    visibility: visibility === 'all' ? undefined : visibility,
    language: language || undefined,
  };

  return (
    <Shell active="/repos" viewer={viewer} databaseAvailable={db.available}>
      <div className="page-head">
        <h1>Kho mã</h1>
        <p className="lede">
          Mọi repository mà token hiện tại truy cập được, gồm cả repository của tổ chức. Tìm kiếm và lọc áp dụng trên
          tập đã tải.
        </p>
      </div>

      <SetupRequired />
      {error ? <GitHubErrorNotice error={error} /> : null}

      {!error ? (
        <Panel>
          <form className="filters" action="/repos" method="get" role="search">
            <Field label="Tìm kiếm">
              <input type="search" name="q" defaultValue={query} placeholder="tên hoặc mô tả…" aria-label="Tìm repository" />
            </Field>
            <Field label="Sắp xếp">
              <select name="sort" defaultValue={sort} aria-label="Sắp xếp">
                <option value="pushed">Cập nhật gần nhất</option>
                <option value="name">Tên A→Z</option>
                <option value="stars">Nhiều sao</option>
                <option value="issues">Nhiều issue mở</option>
              </select>
            </Field>
            <Field label="Hiển thị">
              <select name="visibility" defaultValue={visibility} aria-label="Hiển thị">
                <option value="all">Tất cả</option>
                <option value="public">Công khai</option>
                <option value="private">Riêng tư</option>
              </select>
            </Field>
            <Field label="Ngôn ngữ">
              <select name="language" defaultValue={language} aria-label="Ngôn ngữ">
                <option value="">Tất cả</option>
                {languages.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <button type="submit">Áp dụng</button>
            {query || language || visibility !== 'all' ? (
              <Link className="button secondary" href="/repos">
                Xoá bộ lọc
              </Link>
            ) : null}
          </form>

          {sorted.length === 0 ? (
            <Empty>
              {repos.length === 0
                ? 'Token này chưa truy cập được repository nào. Đây là kết quả rỗng từ GitHub, không phải lỗi.'
                : 'Không có repository nào khớp bộ lọc hiện tại.'}
            </Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Repository</th>
                      <th className="num">Issue mở</th>
                      <th className="num">Sao</th>
                      <th>Push gần nhất</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((repo) => (
                      <tr key={repo.id}>
                        <td>
                          <Link href={`/repos/${repo.owner}/${repo.name}`}>{repo.fullName}</Link>{' '}
                          {repo.isPrivate ? <Badge>riêng tư</Badge> : <Badge tone="info">công khai</Badge>}{' '}
                          {repo.archived ? <Badge tone="warn">lưu trữ</Badge> : null}
                          {repo.language ? <Badge>{repo.language}</Badge> : null}
                          {repo.description ? <div className="muted small">{repo.description}</div> : null}
                          <div className="muted small">
                            nhánh mặc định: <span className="mono">{repo.defaultBranch ?? '—'}</span>
                          </div>
                        </td>
                        <td className="num">{formatNumber(repo.openIssues)}</td>
                        <td className="num">{formatNumber(repo.stars)}</td>
                        <td className="nowrap muted small">{relativeTime(repo.pushedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination
                basePath="/repos"
                params={filterParams}
                page={safePage}
                pageSize={PAGE_SIZE}
                itemCount={sorted.length}
                totalCount={sorted.length}
              />
            </>
          )}

          <ScopeNote
            scope={`${scope} Đang hiển thị ${pageItems.length}/${formatNumber(sorted.length)} repo sau khi lọc.`}
            fetchedAt={fetchedAt}
          />
        </Panel>
      ) : null}
    </Shell>
  );
}
