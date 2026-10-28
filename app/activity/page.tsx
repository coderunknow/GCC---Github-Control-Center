import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { GitHubErrorNotice, SetupRequired } from '@/components/errors';
import { Empty, Notice, Panel, ScopeNote, Stat } from '@/components/ui';
import { fetchRecentCommits, fetchRepositories, type CommitSummary } from '@/lib/queries';
import { databaseStatus, safeViewer } from '@/lib/page';
import { formatNumber, timestampWithRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

const REPO_LIMIT = 8;

export default async function ActivityPage() {
  const [viewer, db] = await Promise.all([safeViewer(), Promise.resolve(databaseStatus())]);

  let commits: CommitSummary[] = [];
  let failed: { repository: string; message: string }[] = [];
  let repos: string[] = [];
  let error: unknown = null;

  try {
    const repoResult = await fetchRepositories(2);
    repos = repoResult.repos.slice(0, REPO_LIMIT).map((repo) => repo.fullName);
    if (repos.length > 0) {
      const result = await fetchRecentCommits(repos, 6);
      commits = result.items.sort((a, b) => (a.date < b.date ? 1 : -1));
      failed = result.failed;
    }
  } catch (err) {
    error = err;
  }

  const byDate = new Map<string, number>();
  for (const commit of commits) {
    const day = commit.date.slice(0, 10);
    byDate.set(day, (byDate.get(day) ?? 0) + 1);
  }
  const busiestDay = [...byDate.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <Shell active="/activity" viewer={viewer} databaseAvailable={db.available}>
      <div className="page-head">
        <h1>Hoạt động</h1>
        <p className="lede">
          Commit gần đây trên {repos.length} repository được push gần nhất. Đây là ảnh chụp hiện tại, không phải lịch
          sử đầy đủ.
        </p>
      </div>

      <SetupRequired />
      {error ? <GitHubErrorNotice error={error} /> : null}

      {failed.length > 0 ? (
        <Notice tone="warn" title="Một số repository không tải được.">
          {failed.map((entry) => `${entry.repository} (${entry.message})`).join('; ')}. Các repo còn lại vẫn được hiển
          thị, nhưng tổng số bên dưới chỉ tính phần đọc được.
        </Notice>
      ) : null}

      {!error ? (
        <>
          <div className="stat-grid">
            <Stat label="Commit đã tải" value={formatNumber(commits.length)} note={`từ ${repos.length} repo`} />
            <Stat label="Ngày sôi động nhất" value={busiestDay ? busiestDay[0] : '—'} note={busiestDay ? `${busiestDay[1]} commit` : undefined} />
            <Stat label="Số ngày có commit" value={formatNumber(byDate.size)} note="trong phạm vi đã tải" />
          </div>

          <Panel title="Commit gần đây" id="activity">
            {commits.length === 0 ? (
              <Empty>Không có commit nào trong phạm vi đã tải.</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Commit</th>
                      <th>Kho mã</th>
                      <th>Tác giả</th>
                      <th>Thời gian</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commits.map((commit) => (
                      <tr key={`${commit.repository}-${commit.sha}`}>
                        <td>
                          <a href={commit.htmlUrl} target="_blank" rel="noreferrer noopener" className="mono">
                            {commit.shortSha}
                          </a>{' '}
                          <span className="truncate" title={commit.message}>
                            {commit.message}
                          </span>
                        </td>
                        <td className="mono small">
                          <Link href={`/repos/${commit.repository}`}>{commit.repository}</Link>
                        </td>
                        <td className="nowrap">{commit.author}</td>
                        <td className="nowrap muted small">{timestampWithRelative(commit.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <ScopeNote
              scope={`Lấy 6 commit gần nhất cho mỗi repo trong ${repos.length} repo: ${repos.join(', ') || '—'}.`}
            />
          </Panel>
        </>
      ) : null}
    </Shell>
  );
}
