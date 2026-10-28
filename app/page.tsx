import { Shell } from '@/components/Shell';
import { fetchOverview, GitHubError, githubConfigured, type Overview } from '@/lib/github';

// Rendered per request: the data is live GitHub state and must never be baked
// into a build artefact.
export const dynamic = 'force-dynamic';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.round(hours / 24)} ngày trước`;
}

/** Pull requests with no decision and untouched for 7+ days are attention items. */
function attentionItems(overview: Overview) {
  const staleMs = 7 * 24 * 60 * 60 * 1000;
  return overview.openPulls.filter((pull) => {
    const stale = Date.now() - new Date(pull.updatedAt).getTime() > staleMs;
    return stale || (!pull.isDraft && pull.reviewDecision === 'REVIEW_REQUIRED');
  });
}

export default async function OverviewPage() {
  if (!githubConfigured()) {
    return (
      <Shell active="/">
        <h1>Tổng quan</h1>
        <div className="banner bad">
          Chưa cấu hình <span className="mono">GITHUB_TOKEN</span> trên máy chủ. Không có dữ liệu nào được hiển thị,
          và không có số liệu giả nào được tạo ra. Đặt biến môi trường theo <span className="mono">.env.example</span>{' '}
          rồi khởi động lại.
        </div>
      </Shell>
    );
  }

  let overview: Overview | null = null;
  let error: string | null = null;
  try {
    overview = await fetchOverview();
  } catch (err) {
    error = err instanceof GitHubError ? err.message : 'Không gọi được GitHub API.';
  }

  if (error || !overview) {
    return (
      <Shell active="/">
        <h1>Tổng quan</h1>
        <div className="banner bad">
          Không tải được dữ liệu từ GitHub: {error}
        </div>
      </Shell>
    );
  }

  const attention = attentionItems(overview);

  return (
    <Shell active="/">
      <h1>Tổng quan</h1>
      <p className="lede">
        {overview.viewer.name ?? overview.viewer.login} · {overview.repoTotal} kho mã người dùng này được phép truy
        cập. Số liệu lấy trực tiếp từ GitHub lúc {formatDate(overview.fetchedAt)}.
      </p>

      <div className="stat-grid">
        <div className="stat">
          <div className="label">Kho mã</div>
          <div className="value">{overview.repoTotal}</div>
          <div className="note">{overview.totals.privateRepos} riêng tư trong số đang hiển thị</div>
        </div>
        <div className="stat">
          <div className="label">Vấn đề đang mở</div>
          <div className="value">{overview.totals.openIssues}</div>
          <div className="note">trên {overview.repos.length} kho mã gần nhất</div>
        </div>
        <div className="stat">
          <div className="label">Pull request đang mở</div>
          <div className="value">{overview.totals.openPulls}</div>
          <div className="note">tổng từ các kho mã đang hiển thị</div>
        </div>
        <div className="stat">
          <div className="label">Cần chú ý</div>
          <div className="value">{attention.length}</div>
          <div className="note">PR quá 7 ngày hoặc chờ review</div>
        </div>
      </div>

      <section className="panel" aria-labelledby="repos-heading">
        <h2 id="repos-heading">Kho mã gần đây</h2>
        {overview.repos.length === 0 ? (
          <div className="empty">Tài khoản này chưa truy cập được kho mã nào. Đây là kết quả rỗng, không phải lỗi.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Kho mã</th>
                <th className="num">Vấn đề</th>
                <th className="num">PR</th>
                <th className="num">Phát hành</th>
                <th>Cập nhật</th>
              </tr>
            </thead>
            <tbody>
              {overview.repos.map((repo) => (
                <tr key={repo.nameWithOwner}>
                  <td>
                    <a href={repo.url} target="_blank" rel="noreferrer noopener">
                      {repo.nameWithOwner}
                    </a>{' '}
                    {repo.isPrivate ? <span className="pill">riêng tư</span> : null}
                    {repo.description ? <div className="muted small">{repo.description}</div> : null}
                    {repo.recentCommits[0] ? (
                      <div className="muted small mono">HEAD · {repo.recentCommits[0].message}</div>
                    ) : null}
                  </td>
                  <td className="num">{repo.openIssues}</td>
                  <td className="num">{repo.openPulls}</td>
                  <td className="num">
                    {repo.releases}
                    {repo.latestRelease?.publishedAt ? (
                      <div className="muted small">{relative(repo.latestRelease.publishedAt)}</div>
                    ) : null}
                  </td>
                  <td>{repo.pushedAt ? relative(repo.pushedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel" aria-labelledby="pull-heading">
        <h2 id="pull-heading">Pull request đang mở</h2>
        {overview.openPulls.length === 0 ? (
          <div className="empty">Không có pull request nào đang mở.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Pull request</th>
                <th>Kho mã</th>
                <th>Trạng thái review</th>
                <th>Cập nhật</th>
              </tr>
            </thead>
            <tbody>
              {overview.openPulls.map((pull) => {
                const label = pull.isDraft
                  ? 'Bản nháp'
                  : pull.reviewDecision === 'APPROVED'
                    ? 'Đã duyệt'
                    : pull.reviewDecision === 'CHANGES_REQUESTED'
                      ? 'Yêu cầu sửa'
                      : pull.reviewDecision === 'REVIEW_REQUIRED'
                        ? 'Chờ review'
                        : 'Chưa có quyết định';
                const tone = pull.reviewDecision === 'APPROVED' ? 'good' : pull.reviewDecision === 'CHANGES_REQUESTED' ? 'bad' : 'warn';
                return (
                  <tr key={`${pull.repository}-${pull.number}`}>
                    <td>
                      <a href={pull.url} target="_blank" rel="noreferrer noopener">
                        #{pull.number} {pull.title}
                      </a>
                    </td>
                    <td className="mono">{pull.repository}</td>
                    <td>
                      <span className={`pill ${tone}`}>{label}</span>
                    </td>
                    <td>{relative(pull.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="muted small" style={{ marginTop: 12 }}>
          Khả năng hợp nhất không được suy ra từ một dấu hiệu duy nhất. Trạng thái review ở đây là dữ liệu GitHub
          trả về, không phải kết luận rằng PR đã sẵn sàng hợp nhất.
        </p>
      </section>

      <section className="panel" aria-labelledby="attention-heading">
        <h2 id="attention-heading">Cần chú ý</h2>
        {attention.length === 0 ? (
          <div className="empty">Không có mục nào cần chú ý theo tiêu chí hiện tại.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {attention.map((pull) => (
              <li key={`attention-${pull.repository}-${pull.number}`} style={{ marginBottom: 6 }}>
                <a href={pull.url} target="_blank" rel="noreferrer noopener">
                  {pull.repository} #{pull.number}
                </a>{' '}
                <span className="muted small">
                  {pull.isDraft ? 'bản nháp' : pull.reviewDecision === 'REVIEW_REQUIRED' ? 'chờ review' : 'không hoạt động'}
                  {' · '}
                  {relative(pull.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}
