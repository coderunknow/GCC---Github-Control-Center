import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { GitHubErrorNotice, SetupRequired } from '@/components/errors';
import { Badge, Empty, Panel, ScopeNote, Stat } from '@/components/ui';
import { fetchOverview, type Overview } from '@/lib/queries';
import { databaseStatus, safeViewer } from '@/lib/page';
import { formatNumber, relativeTime, timestampWithRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

function OverviewBody({ data }: { data: Overview }) {
  return (
    <>
      <div className="stat-grid">
        <Stat
          label="Kho mã"
          value={data.reposTruncated ? `≥ ${formatNumber(data.reposLoaded)}` : formatNumber(data.reposLoaded)}
          note={data.reposTruncated ? `còn repo chưa tải · ${data.privateRepos} riêng tư` : `${data.privateRepos} riêng tư`}
        />
        <Stat
          label="Issue đang mở"
          value={formatNumber(data.openIssues)}
          note={
            data.openIssuesSource === 'graphql'
              ? data.countsPartial
                ? 'một số repo không trả lời'
                : 'không gồm pull request'
              : 'tạm tính, gồm cả PR'
          }
        />
        <Stat
          label="Pull request đang mở"
          value={formatNumber(data.openPulls)}
          note="PR có liên quan tới tài khoản"
        />
        <Stat
          label="Cần chú ý"
          value={formatNumber(data.attention.length)}
          tone={data.attention.length > 0 ? 'warn' : undefined}
          note="PR quá 7 ngày, repo không hoạt động"
        />
      </div>

      <Panel
        title="Pull request đang mở"
        description="Danh sách rút gọn; mở trang Pull requests để lọc và phân trang đầy đủ."
        actions={<Link className="button secondary" href="/pulls">Xem tất cả</Link>}
        id="pulls"
      >
        {data.openPullsList.length === 0 ? (
          <Empty>Không có pull request nào đang mở trong phạm vi tài khoản.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pull request</th>
                  <th>Kho mã</th>
                  <th>Trạng thái</th>
                  <th>Cập nhật</th>
                </tr>
              </thead>
              <tbody>
                {data.openPullsList.map((pull) => (
                  <tr key={`${pull.repository}-${pull.number}`}>
                    <td>
                      <a href={pull.url} target="_blank" rel="noreferrer noopener">
                        #{pull.number} {pull.title}
                      </a>
                    </td>
                    <td className="mono">{pull.repository}</td>
                    <td>{pull.isDraft ? <Badge>x</Badge> : <Badge tone="info">mở</Badge>}</td>
                    <td className="nowrap muted small">{relativeTime(pull.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ScopeNote scope={data.scopeNote} fetchedAt={data.fetchedAt} />
      </Panel>

      <div className="detail-grid">
        <Panel title="Commit gần đây" description="Từ repository được push gần nhất." id="commits">
          {data.recentCommits.length === 0 ? (
            <Empty>Repository gần nhất chưa có commit nào đọc được.</Empty>
          ) : (
            <ul className="plain-list">
              {data.recentCommits.map((commit) => (
                <li key={commit.sha}>
                  <a href={commit.htmlUrl} target="_blank" rel="noreferrer noopener" className="mono">
                    {commit.shortSha}
                  </a>{' '}
                  <span className="truncate" title={commit.message}>
                    {commit.message}
                  </span>
                  <div className="muted small">
                    {commit.author} · {relativeTime(commit.date)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Cần chú ý" id="attention">
          {data.attention.length === 0 ? (
            <Empty>Không có mục nào cần chú ý theo tiêu chí hiện tại.</Empty>
          ) : (
            <ul className="plain-list">
              {data.attention.map((item, index) => (
                <li key={`${item.kind}-${index}`}>
                  <Badge tone={item.kind.startsWith('Không tải') ? 'bad' : 'warn'}>{item.kind}</Badge>
                  <div>
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noreferrer noopener">
                        {item.title}
                      </a>
                    ) : (
                      item.title
                    )}
                  </div>
                  <div className="muted small">{item.detail}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Release gần đây"
        description="Từ repository được push gần nhất."
        actions={<Link className="button secondary" href="/releases">Xem tất cả</Link>}
        id="releases"
      >
        {data.recentReleases.length === 0 ? (
          <Empty>Repository gần nhất chưa có release nào.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tag</th>
                  <th>Tên</th>
                  <th>Loại</th>
                  <th>Phát hành</th>
                </tr>
              </thead>
              <tbody>
                {data.recentReleases.map((release) => (
                  <tr key={release.id}>
                    <td className="mono">
                      <a href={release.htmlUrl} target="_blank" rel="noreferrer noopener">
                        {release.tagName}
                      </a>
                    </td>
                    <td>{release.name ?? '—'}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

export default async function OverviewPage() {
  const [viewer, db] = await Promise.all([safeViewer(), Promise.resolve(databaseStatus())]);

  let data: Overview | null = null;
  let error: unknown = null;
  try {
    data = await fetchOverview();
  } catch (err) {
    error = err;
  }

  return (
    <Shell active="/" viewer={viewer} databaseAvailable={db.available}>
      <div className="page-head">
        <h1>Tổng quan</h1>
        <p className="lede">
          Tình trạng tài khoản và hoạt động GitHub. Mọi con số đều tính từ dữ liệu GitHub trả về — không có dữ liệu mẫu.
        </p>
      </div>

      <SetupRequired />
      {error ? <GitHubErrorNotice error={error} /> : null}
      {data ? <OverviewBody data={data} /> : null}

      {!db.available ? (
        <Panel title="Lịch sử bền vững đang tắt" id="db">
          <p className="muted small" style={{ margin: 0 }}>
            {db.detail} Thiết lập: sao chép <span className="mono">.env.example</span>, đặt{' '}
            <span className="mono">DATABASE_URL</span>, rồi chạy <span className="mono">npm run db:migrate</span>.{' '}
            <Link href="/reports">Báo cáo</Link> và <Link href="/health">Tình trạng</Link> sẽ hiển thị chi tiết.
          </p>
        </Panel>
      ) : null}
    </Shell>
  );
}
