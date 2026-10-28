import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { GitHubErrorNotice, SetupRequired } from '@/components/errors';
import { Badge, Empty, Field, Pagination, Panel, ScopeNote, Stat, type Tone } from '@/components/ui';
import { fetchRecentRuns, fetchRepositories, type RecentRun } from '@/lib/queries';
import { databaseStatus, enumParam, intParam, safeViewer, strParam } from '@/lib/page';
import { formatDuration, formatNumber, relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const REPORT_LIMIT = 6;

function toneFor(conclusion: string | null, status: string | null): Tone {
  if (status && status !== 'completed') return 'warn';
  switch (conclusion) {
    case 'success':
      return 'good';
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return 'bad';
    default:
      return 'muted';
  }
}

export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = intParam(params.page, 1, 20);
  const conclusionFilter = enumParam(params.conclusion, ['all', 'success', 'failure', 'pending'] as const, 'all');
  const repoFilter = strParam(params.repo);

  const [viewer, db] = await Promise.all([safeViewer(), Promise.resolve(databaseStatus())]);

  let repos: { fullName: string; defaultBranch: string | null }[] = [];
  let error: unknown = null;
  try {
    const repoResult = await fetchRepositories(3);
    repos = repoResult.repos.map((repo) => ({ fullName: repo.fullName, defaultBranch: repo.defaultBranch }));
  } catch (err) {
    error = err;
  }

  const targets = repoFilter ? repos.filter((repo) => repo.fullName === repoFilter) : repos.slice(0, REPORT_LIMIT);

  let runs: RecentRun[] = [];
  if (!error && targets.length > 0) {
    try {
      runs = await fetchRecentRuns(targets, 8);
    } catch (err) {
      error = err;
    }
  }

  const filtered = runs.filter((run) => {
    if (conclusionFilter === 'all') return true;
    if (conclusionFilter === 'pending') return run.status !== 'completed';
    return run.conclusion === conclusionFilter;
  });

  const successes = runs.filter((run) => run.conclusion === 'success').length;
  const failures = runs.filter((run) => run.conclusion === 'failure' || run.conclusion === 'timed_out').length;
  const running = runs.filter((run) => run.status !== 'completed').length;
  const settled = successes + failures;
  const successRate = settled > 0 ? Math.round((successes / settled) * 100) : null;

  return (
    <Shell active="/actions" viewer={viewer} databaseAvailable={db.available}>
      <div className="page-head">
        <h1>CI/CD</h1>
        <p className="lede">
          Workflow run gần đây trên {targets.length} repository hoạt động tích cực nhất. Không có thao tác chạy lại hay
          huỷ workflow ở đây.
        </p>
      </div>

      <SetupRequired />
      {error ? <GitHubErrorNotice error={error} /> : null}

      {!error ? (
        <>
          <div className="stat-grid">
            <Stat label="Run đã tải" value={formatNumber(runs.length)} note={`từ ${targets.length} repo`} />
            <Stat label="Thành công" value={formatNumber(successes)} tone={successes > 0 ? 'good' : undefined} />
            <Stat label="Thất bại" value={formatNumber(failures)} tone={failures > 0 ? 'bad' : undefined} />
            <Stat label="Đang chạy" value={formatNumber(running)} tone={running > 0 ? 'warn' : undefined} />
            <Stat
              label="Tỉ lệ thành công"
              value={successRate === null ? '—' : `${successRate}%`}
              note={settled === 0 ? 'chưa có run nào kết thúc' : `${settled} run đã kết thúc`}
            />
          </div>

          <Panel>
            <form className="filters" action="/actions" method="get">
              <Field label="Repository">
                <select name="repo" defaultValue={repoFilter} aria-label="Repository">
                  <option value="">{REPORT_LIMIT} repo gần nhất</option>
                  {repos.map((repo) => (
                    <option key={repo.fullName} value={repo.fullName}>
                      {repo.fullName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Kết quả">
                <select name="conclusion" defaultValue={conclusionFilter} aria-label="Kết quả">
                  <option value="all">Tất cả</option>
                  <option value="success">Thành công</option>
                  <option value="failure">Thất bại</option>
                  <option value="pending">Đang chạy</option>
                </select>
              </Field>
              <button type="submit">Áp dụng</button>
            </form>

            {targets.length === 0 ? (
              <Empty>Token chưa truy cập được repository nào, nên không có workflow run để hiển thị.</Empty>
            ) : filtered.length === 0 ? (
              <Empty>
                Không có run nào khớp bộ lọc. Có thể các repository này chưa cấu hình GitHub Actions, hoặc token thiếu
                quyền Actions: read.
              </Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Workflow</th>
                      <th>Kho mã</th>
                      <th>Kết quả</th>
                      <th>Nhánh</th>
                      <th>Thời lượng</th>
                      <th>Bắt đầu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((run) => (
                      <tr key={`${run.repository}-${run.id}`}>
                        <td>
                          <a href={run.htmlUrl} target="_blank" rel="noreferrer noopener">
                            {run.name}
                          </a>
                          <div className="muted small truncate" title={run.displayTitle}>
                            {run.displayTitle}
                          </div>
                        </td>
                        <td className="mono small">
                          <Link href={`/repos/${run.repository}?tab=actions`}>{run.repository}</Link>
                        </td>
                        <td>
                          <Badge tone={toneFor(run.conclusion, run.status)}>
                            {run.status !== 'completed' ? run.status ?? 'đang chạy' : run.conclusion ?? 'không rõ'}
                          </Badge>
                        </td>
                        <td className="mono small">{run.headBranch ?? '—'}</td>
                        <td className="nowrap muted small">{formatDuration(run.runStartedAt ?? run.createdAt, run.updatedAt)}</td>
                        <td className="nowrap muted small">{relativeTime(run.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <ScopeNote
              scope={`Lấy 8 run gần nhất cho mỗi repo trong ${targets.length} repo. Số liệu chỉ phản ánh phạm vi này, không phải toàn bộ lịch sử CI.`}
            />
            <p className="muted small">
              Trạng thái CI ở đây là kết quả của từng run riêng lẻ. Một run thành công không đủ để kết luận PR sẵn sàng
              hợp nhất — xem trang chi tiết PR để biết đầy đủ check, review và quyết định.
            </p>
          </Panel>
        </>
      ) : null}
    </Shell>
  );
}
