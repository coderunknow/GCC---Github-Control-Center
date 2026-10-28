import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { GitHubErrorNotice } from '@/components/errors';
import { Badge, LabelChip, Panel } from '@/components/ui';
import { fetchIssue, type IssueDetail } from '@/lib/queries';
import { databaseStatus, safeViewer } from '@/lib/page';
import { GitHubError } from '@/lib/github';
import { timestampWithRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; number: string }>;
}) {
  const { owner, repo, number } = await params;
  const issueNumber = Number.parseInt(number, 10);

  const [viewer, db] = await Promise.all([safeViewer(), Promise.resolve(databaseStatus())]);

  let issue: IssueDetail | null = null;
  let error: unknown = null;
  if (!Number.isFinite(issueNumber) || issueNumber < 1) {
    notFound();
  } else {
    try {
      issue = await fetchIssue(owner, repo, issueNumber);
    } catch (err) {
      if (err instanceof GitHubError && err.kind === 'not_found') notFound();
      error = err;
    }
  }

  return (
    <Shell active="/issues" viewer={viewer} databaseAvailable={db.available}>
      <div className="page-head">
        <p className="muted small" style={{ marginBottom: 6 }}>
          <Link href="/issues">Issues</Link> / <Link href={`/repos/${owner}/${repo}`}>{owner}/{repo}</Link>
        </p>
        <h1>{issue ? `#${issue.number} ${issue.title}` : `Issue #${number}`}</h1>
      </div>

      {error ? <GitHubErrorNotice error={error} /> : null}

      {issue ? (
        <div className="detail-grid">
          <div>
            <Panel title="Nội dung">
              {issue.body ? (
                <div className="prose">{issue.body}</div>
              ) : (
                <p className="muted small" style={{ margin: 0 }}>
                  Issue này không có nội dung mô tả.
                </p>
              )}
            </Panel>

            <Panel title={`Bình luận (${issue.commentsCount})`} id="comments">
              {issue.comments.length === 0 ? (
                <p className="muted small" style={{ margin: 0 }}>
                  Chưa có bình luận nào.
                </p>
              ) : (
                <>
                  {issue.comments.map((comment) => (
                    <div className="comment" key={comment.id}>
                      <div className="who">
                        <strong>{comment.author ?? 'không rõ'}</strong>
                        <span>{timestampWithRelative(comment.createdAt)}</span>
                        <a href={comment.url} target="_blank" rel="noreferrer noopener">
                          trên GitHub ↗
                        </a>
                      </div>
                      <div className="prose">{comment.body}</div>
                    </div>
                  ))}
                  {issue.commentsCount > issue.comments.length ? (
                    <p className="muted small">
                      Đang hiển thị {issue.comments.length}/{issue.commentsCount} bình luận đầu tiên.{' '}
                      <a href={issue.htmlUrl} target="_blank" rel="noreferrer noopener">
                        Xem đầy đủ trên GitHub ↗
                      </a>
                    </p>
                  ) : null}
                </>
              )}
            </Panel>
          </div>

          <Panel title="Thông tin">
            <dl className="meta-list">
              <div>
                <dt>Trạng thái</dt>
                <dd>
                  {issue.state === 'OPEN' ? (
                    <Badge tone="good">đang mở</Badge>
                  ) : (
                    <Badge>đã đóng{issue.stateReason === 'NOT_PLANNED' ? ' (không dự kiến)' : ''}</Badge>
                  )}
                </dd>
              </div>
              <div>
                <dt>Tác giả</dt>
                <dd>{issue.author ?? '—'}</dd>
              </div>
              <div>
                <dt>Người phụ trách</dt>
                <dd>{issue.assignees.length ? issue.assignees.join(', ') : 'chưa gán'}</dd>
              </div>
              <div>
                <dt>Milestone</dt>
                <dd>{issue.milestone ?? '—'}</dd>
              </div>
              <div>
                <dt>Tạo lúc</dt>
                <dd>{timestampWithRelative(issue.createdAt)}</dd>
              </div>
              <div>
                <dt>Cập nhật</dt>
                <dd>{timestampWithRelative(issue.updatedAt)}</dd>
              </div>
              {issue.closedAt ? (
                <div>
                  <dt>Đóng lúc</dt>
                  <dd>{timestampWithRelative(issue.closedAt)}</dd>
                </div>
              ) : null}
            </dl>

            {issue.labels.length ? (
              <div style={{ marginTop: 14 }}>
                <h3 className="small muted">Nhãn</h3>
                {issue.labels.map((label) => (
                  <LabelChip key={label.name} name={label.name} color={label.color} />
                ))}
              </div>
            ) : null}

            <p style={{ marginTop: 16, marginBottom: 0 }}>
              <a href={issue.htmlUrl} target="_blank" rel="noreferrer noopener">
                Mở issue trên GitHub ↗
              </a>
            </p>
            <p className="muted small" style={{ marginBottom: 0 }}>
              Ứng dụng đang ở chế độ chỉ đọc: không có thao tác bình luận, đóng hay gán issue.
            </p>
          </Panel>
        </div>
      ) : null}
    </Shell>
  );
}
