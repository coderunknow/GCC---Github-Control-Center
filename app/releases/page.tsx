import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { GitHubErrorNotice, SetupRequired } from '@/components/errors';
import { Badge, Empty, Field, Pagination, Panel, ScopeNote } from '@/components/ui';
import { fetchRecentReleases, fetchRepositories, type RecentRelease } from '@/lib/queries';
import { databaseStatus, enumParam, intParam, safeViewer, strParam } from '@/lib/page';
import { formatNumber, timestampWithRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

const REPORT_LIMIT = 8;
const PAGE_SIZE = 30;

export default async function ReleasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const repoFilter = strParam(params.repo);
  const kindFilter = enumParam(params.kind, ['all', 'stable', 'prerelease', 'draft'] as const, 'all');
  const page = intParam(params.page, 1, 50);

  const [viewer, db] = await Promise.all([safeViewer(), Promise.resolve(databaseStatus())]);

  let repos: string[] = [];
  let error: unknown = null;
  try {
    repos = (await fetchRepositories(3)).repos.map((repo) => repo.fullName);
  } catch (err) {
    error = err;
  }

  const targets = repoFilter ? repos.filter((fullName) => fullName === repoFilter) : repos.slice(0, REPORT_LIMIT);

  let releases: RecentRelease[] = [];
  if (!error && targets.length > 0) {
    try {
      releases = await fetchRecentReleases(targets, 5);
    } catch (err) {
      error = err;
    }
  }

  const filtered = releases.filter((release) => {
    if (kindFilter === 'stable') return !release.isDraft && !release.isPrerelease;
    if (kindFilter === 'prerelease') return release.isPrerelease && !release.isDraft;
    if (kindFilter === 'draft') return release.isDraft;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <Shell active="/releases" viewer={viewer} databaseAvailable={db.available}>
      <div className="page-head">
        <h1>Releases</h1>
        <p className="lede">
          Release gần đây trên {targets.length} repository hoạt động tích cực nhất, gồm cả bản nháp và prerelease.
        </p>
      </div>

      <SetupRequired />
      {error ? <GitHubErrorNotice error={error} /> : null}

      {!error ? (
        <Panel>
          <form className="filters" action="/releases" method="get">
            <Field label="Repository">
              <select name="repo" defaultValue={repoFilter} aria-label="Repository">
                <option value="">{REPORT_LIMIT} repo gần nhất</option>
                {repos.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Loại">
              <select name="kind" defaultValue={kindFilter} aria-label="Loại release">
                <option value="all">Tất cả</option>
                <option value="stable">Ổn định</option>
                <option value="prerelease">Prerelease</option>
                <option value="draft">Bản nháp</option>
              </select>
            </Field>
            <button type="submit">Áp dụng</button>
          </form>

          {targets.length === 0 ? (
            <Empty>Token chưa truy cập được repository nào.</Empty>
          ) : filtered.length === 0 ? (
            <Empty>Không có release nào khớp bộ lọc trong phạm vi đã tải.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Release</th>
                    <th>Kho mã</th>
                    <th>Loại</th>
                    <th>Phát hành</th>
                    <th>Tác giả</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((release) => (
                    <tr key={`${release.repository}-${release.id}`}>
                      <td>
                        <a href={release.htmlUrl} target="_blank" rel="noreferrer noopener" className="mono">
                          {release.tagName}
                        </a>
                        <div>{release.name ?? <span className="muted">không đặt tên</span>}</div>
                      </td>
                      <td className="mono small">
                        <Link href={`/repos/${release.repository}`}>{release.repository}</Link>
                      </td>
                      <td>
                        {release.isDraft ? (
                          <Badge>nháp</Badge>
                        ) : release.isPrerelease ? (
                          <Badge tone="warn">prerelease</Badge>
                        ) : (
                          <Badge tone="good">ổn định</Badge>
                        )}
                      </td>
                      <td className="nowrap muted small">{timestampWithRelative(release.publishedAt)}</td>
                      <td className="nowrap small">{release.author ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Pagination
            basePath="/releases"
            params={{ repo: repoFilter || undefined, kind: kindFilter === 'all' ? undefined : kindFilter }}
            page={safePage}
            pageSize={PAGE_SIZE}
            itemCount={filtered.length}
            totalCount={filtered.length}
          />

          <ScopeNote
            scope={`Lấy 5 release mới nhất cho mỗi repo trong ${targets.length} repo. Tổng ${formatNumber(filtered.length)} release khớp bộ lọc. Đây là phạm vi đã tải, không phải toàn bộ release của tài khoản.`}
          />
        </Panel>
      ) : null}
    </Shell>
  );
}
