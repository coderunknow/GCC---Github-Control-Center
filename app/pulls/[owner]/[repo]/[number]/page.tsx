import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { GitHubErrorNotice } from '@/components/errors';
import { Badge, Empty, Notice, Panel, type Tone } from '@/components/ui';
import { fetchPull, type CheckState, type PullDetail } from '@/lib/queries';
import { databaseStatus, safeViewer } from '@/lib/page';
import { GitHubError } from '@/lib/github';
import { formatNumber, relativeTime, timestampWithRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

function reviewTone(decision: string | null): { tone: Tone; label: string } {
  switch (decision) {
    case 'APPROVED':
      return { tone: 'good', label: 'Đã duyệt' };
    case 'CHANGES_REQUESTED':
      return { tone: 'bad', label: 'Yêu cầu sửa' };
    case 'REVIEW_REQUIRED':
      return { tone: 'warn', label: 'Chờ review' };
    default:
      return { tone: 'muted', label: 'Chưa có quyết định review' };
  }
}

function checkTone(state: CheckState): Tone {
  switch (state) {
    case 'SUCCESS':
      return 'good';
    case 'FAILURE':
      return 'bad';
    case 'PENDING':
      return 'warn';
    default:
      return 'muted';
  }
}

function PullBody({ pull, checksNote }: { pull: PullDetail; checksNote: string | null }) {
  const decision = reviewTone(pull.reviewDecision);
  const failedChecks = pull.checks.filter((check) => check.state === 'FAILURE');
  const pendingChecks = pull.checks.filter((check) => check.state === 'PENDING');

  return (
    <div className="detail-grid">
      <div>
        <Panel title="Mô tả">
          {pull.body ? (
            <div className="prose">{pull.body}</div>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              Pull request này không có mô tả.
            </p>
          )}
        </Panel>

        <Panel title={`Kiểm tra (${pull.checks.length})`} id="checks">
          {checksNote ? <Notice tone="warn">{checksNote}</Notice> : null}
          {pull.checks.length === 0 && !checksNote ? (
            <Empty>Không có check-run nào trên commit mới nhất.</Empty>
          ) : null}
          {pull.checks.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Check</th>
                    <th>Kết quả</th>
                  </tr>
                </thead>
                <tbody>
                  {pull.checks.map((check, index) => (
                    <tr key={`${check.name}-${index}`}>
                      <td>
                        {check.url ? (
                          <a href={check.url} target="_blank" rel="noreferrer noopener">
                            {check.name}
                          </a>
                        ) : (
                          check.name
                        )}
                      </td>
                      <td>
                        <Badge tone={checkTone(check.state)}>{check.state.toLowerCase()}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="muted small">
            Khả năng hợp nhất không được suy ra từ một check đơn lẻ. Trạng thái dưới đây là dữ liệu GitHub trả về,
            không phải kết luận rằng PR đã sẵn sàng hợp nhất.
          </p>
        </Panel>

        <Panel title={`File thay đổi (${formatNumber(pull.changedFiles)})`} id="files">
          {pull.files.length === 0 ? (
            <Empty>Không đọc được danh sách file (hoặc PR không thay đổi file nào).</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Đường dẫn</th>
                    <th className="num">+</th>
                    <th className="num">−</th>
                  </tr>
                </thead>
                <tbody>
                  {pull.files.map((file) => (
                    <tr key={file.path}>
                      <td className="mono">{file.path}</td>
                      <td className="num" style={{ color: '#7ee787' }}>
                        {file.additions}
                      </td>
                      <td className="num" style={{ color: '#ffb3ae' }}>
                        {file.deletions}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pull.changedFiles > pull.files.length ? (
            <p className="muted small">
              Hiển thị {pull.files.length}/{pull.changedFiles} file.
            </p>
          ) : null}
        </Panel>

        <Panel title={`Commit (${pull.commits.length})`} id="commits">
          {pull.commits.length === 0 ? (
            <Empty>PR chưa có commit.</Empty>
          ) : (
            <ul className="plain-list">
              {pull.commits.map((commit) => (
                <li key={commit.oid}>
                  <span className="mono">{commit.oid.slice(0, 7)}</span>{' '}
                  <span className="truncate" title={commit.message}>
                    {commit.message}
                  </span>
                  <div className="muted small">
                    {commit.author ?? 'không rõ'} · {relativeTime(commit.committedDate)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Thông tin">
        <dl className="meta-list">
          <div>
            <dt>Trạng thái</dt>
            <dd>
              {pull.state === 'OPEN' ? <Badge tone="good">đang mở</Badge> : <Badge>{pull.state.toLowerCase()}</Badge>}
              {pull.isDraft ? (
                <>
                  {' '}
                  <Badge tone="warn">nháp</Badge>
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Review</dt>
            <dd>
              <Badge tone={decision.tone}>{decision.label}</Badge>
            </dd>
          </div>
          <div>
            <dt>Người review được yêu cầu</dt>
            <dd>{pull.reviewRequests.length ? pull.reviewRequests.join(', ') : '—'}</dd>
          </div>
          <div>
            <dt>Nhánh</dt>
            <dd className="mono small">
              {pull.headRefName} → {pull.baseRefName}
            </dd>
          </div>
          <div>
            <dt>Tác giả</dt>
            <dd>{pull.author ?? '—'}</dd>
          </div>
          <div>
            <dt>Thay đổi</dt>
            <dd>
              +{formatNumber(pull.additions)} / −{formatNumber(pull.deletions)} trong{' '}
              {formatNumber(pull.changedFiles)} file
            </dd>
          </div>
          <div>
            <dt>Tạo lúc</dt>
            <dd>{timestampWithRelative(pull.createdAt)}</dd>
          </div>
          <div>
            <dt>Cập nhật</dt>
            <dd>{timestampWithRelative(pull.updatedAt)}</dd>
          </div>
          {pull.mergedAt ? (
            <div>
              <dt>Đã hợp nhất</dt>
              <dd>{timestampWithRelative(pull.mergedAt)}</dd>
            </div>
          ) : null}
        </dl>

        {failedChecks.length > 0 ? (
          <div className="banner bad" style={{ marginTop: 14, marginBottom: 0 }}>
            {failedChecks.length} check thất bại.
          </div>
        ) : pendingChecks.length > 0 ? (
          <div className="banner warn" style={{ marginTop: 14, marginBottom: 0 }}>
            {pendingChecks.length} check đang chạy.
          </div>
        ) : pull.checks.length > 0 ? (
          <div className="banner info" style={{ marginTop: 14, marginBottom: 0 }}>
            Tất cả {pull.checks.length} check đã xong.
          </div>
        ) : null}

        <h3 className="small muted" style={{ marginTop: 16 }}>
          Lịch sử review
        </h3>
        {pull.reviews.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            Chưa có review nào được gửi.
          </p>
        ) : (
          <ul className="plain-list">
            {pull.reviews.map((review) => (
              <li key={review.id}>
                <strong>{review.author ?? 'không rõ'}</strong>{' '}
                <Badge tone={review.state === 'APPROVED' ? 'good' : review.state === 'CHANGES_REQUESTED' ? 'bad' : 'muted'}>
                  {review.state.toLowerCase()}
                </Badge>
                <div className="muted small">{review.submittedAt ? relativeTime(review.submittedAt) : 'chưa gửi'}</div>
              </li>
            ))}
          </ul>
        )}

        <p style={{ marginTop: 16, marginBottom: 0 }}>
          <a href={pull.htmlUrl} target="_blank" rel="noreferrer noopener">
            Mở pull request trên GitHub ↗
          </a>
        </p>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Ứng dụng ở chế độ chỉ đọc: không có thao tác approve, merge hay đóng PR.
        </p>
      </Panel>
    </div>
  );
}

export default async function PullDetailPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; number: string }>;
}) {
  const { owner, repo, number } = await params;
  const pullNumber = Number.parseInt(number, 10);

  const [viewer, db] = await Promise.all([safeViewer(), Promise.resolve(databaseStatus())]);

  let data: Awaited<ReturnType<typeof fetchPull>> | null = null;
  let error: unknown = null;

  if (!Number.isFinite(pullNumber) || pullNumber < 1) {
    notFound();
  } else {
    try {
      data = await fetchPull(owner, repo, pullNumber);
    } catch (err) {
      if (err instanceof GitHubError && err.kind === 'not_found') notFound();
      error = err;
    }
  }

  return (
    <Shell active="/pulls" viewer={viewer} databaseAvailable={db.available}>
      <div className="page-head">
        <p className="muted small" style={{ marginBottom: 6 }}>
          <Link href="/pulls">Pull requests</Link> /{' '}
          <Link href={`/repos/${owner}/${repo}`}>
            {owner}/{repo}
          </Link>
        </p>
        <h1>{data ? `#${data.pull.number} ${data.pull.title}` : `Pull request #${number}`}</h1>
      </div>

      {error ? <GitHubErrorNotice error={error} /> : null}
      {data ? <PullBody pull={data.pull} checksNote={data.checksNote} /> : null}
    </Shell>
  );
}
