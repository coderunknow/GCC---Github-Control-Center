import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { GitHubErrorNotice } from '@/components/errors';
import { Badge, Empty, Panel, ScopeNote } from '@/components/ui';
import {
  fetchCommits,
  fetchIssues,
  fetchPullRequests,
  fetchReleases,
  fetchRepository,
  fetchWorkflowRuns,
  type RepositorySummary,
} from '@/lib/queries';
import { databaseStatus, enumParam, intParam, safeViewer } from '@/lib/page';
import { GitHubError } from '@/lib/github';
import { formatDuration, formatNumber, relativeTime, timestampWithRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

const TABS = ['overview', 'issues', 'pulls', 'actions', 'releases'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Tổng quan',
  issues: 'Issues',
  pulls: 'Pull requests',
  actions: 'CI/CD',
  releases: 'Releases',
};

function conclusionTone(conclusion: string | null): 'good' | 'bad' | 'warn' | 'muted' {
  switch (conclusion) {
    case 'success':
      return 'good';
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return 'bad';
    case 'cancelled':
    case 'skipped':
    case 'neutral':
      return 'muted';
    default:
      return 'warn';
  }
}

export default async function RepositoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { owner, repo } = await params;
  const query = await searchParams;
  const tab = enumParam(query.tab, TABS, 'overview');
  const page = intParam(query.page, 1, 100);

  const [viewer, db] = await Promise.all([safeViewer(), Promise.resolve(databaseStatus())]);

  let repository: RepositorySummary | null = null;
  let error: unknown = null;
  try {
    repository = await fetchRepository(owner, repo);
  } catch (err) {
    // A repository that is deleted, renamed or not visible to this token is
    // genuinely absent; returning 200 would tell crawlers and monitors it exists.
    if (err instanceof GitHubError && err.kind === 'not_found') notFound();
    error = err;
  }

  const base = `/repos/${owner}/${repo}`;
  const tabLink = (target: Tab) => (target === 'overview' ? base : `${base}?tab=${target}`);

  return (
    <Shell active="/repos" viewer={viewer} databaseAvailable={db.available}>
      <div className="page-head">
        <p className="muted small" style={{ marginBottom: 6 }}>
          <Link href="/repos">Kho mã</Link> / {owner}
        </p>
        <h1>{repo}</h1>
        {repository ? (
          <p className="lede">
            {repository.description ?? 'Không có mô tả.'}{' '}
            {repository.htmlUrl ? (
              <a href={repository.htmlUrl} target="_blank" rel="noreferrer noopener">
                Mở trên GitHub ↗
              </a>
            ) : null}
          </p>
        ) : null}
      </div>

      {error ? <GitHubErrorNotice error={error} /> : null}

      {repository ? (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Hiển thị</div>
              <div className="value" style={{ fontSize: 18 }}>
                {repository.isPrivate ? 'Riêng tư' : 'Công khai'}
              </div>
              <div className="note">{repository.archived ? 'đã lưu trữ' : 'đang hoạt động'}</div>
            </div>
            <div className="stat">
              <div className="label">Nhánh mặc định</div>
              <div className="value mono" style={{ fontSize: 16 }}>
                {repository.defaultBranch ?? '—'}
              </div>
            </div>
            <div className="stat">
              <div className="label">Issue mở</div>
              <div className="value">{formatNumber(repository.openIssues)}</div>
            </div>
            <div className="stat">
              <div className="label">Push gần nhất</div>
              <div className="value" style={{ fontSize: 16 }}>
                {relativeTime(repository.pushedAt)}
              </div>
            </div>
          </div>

          <nav className="tabs" aria-label="Mục trong repository">
            {TABS.map((item) => (
              <Link key={item} href={tabLink(item)} aria-current={tab === item ? 'page' : undefined}>
                {TAB_LABELS[item]}
              </Link>
            ))}
          </nav>

          {tab === 'overview' ? <OverviewTab owner={owner} repo={repo} /> : null}
          {tab === 'issues' ? <IssuesTab owner={owner} repo={repo} page={page} /> : null}
          {tab === 'pulls' ? <PullsTab owner={owner} repo={repo} page={page} /> : null}
          {tab === 'actions' ? <ActionsTab owner={owner} repo={repo} page={page} /> : null}
          {tab === 'releases' ? <ReleasesTab owner={owner} repo={repo} page={page} /> : null}
        </>
      ) : null}
    </Shell>
  );
}

async function OverviewTab({ owner, repo }: { owner: string; repo: string }) {
  try {
    const { commits, pageInfo } = await fetchCommits(owner, repo, 1, 15);
    return (
      <Panel title="Commit gần đây" id="commits">
        {commits.length === 0 ? (
          <Empty>Repository chưa có commit nào, hoặc nhánh mặc định đang trống.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Commit</th>
                  <th>Tác giả</th>
                  <th>Thời gian</th>
                </tr>
              </thead>
              <tbody>
                {commits.map((commit) => (
                  <tr key={commit.sha}>
                    <td>
                      <a href={commit.htmlUrl} target="_blank" rel="noreferrer noopener" className="mono">
                        {commit.shortSha}
                      </a>{' '}
                      <span className="truncate" title={commit.message}>
                        {commit.message}
                      </span>
                    </td>
                    <td className="nowrap">{commit.author}</td>
                    <td className="nowrap muted small">{timestampWithRelative(commit.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ScopeNote scope={pageInfo.scope} fetchedAt={pageInfo.fetchedAt} />
      </Panel>
    );
  } catch (err) {
    return <GitHubErrorNotice error={err} />;
  }
}

async function IssuesTab({ owner, repo, page }: { owner: string; repo: string; page: number }) {
  try {
    const result = await fetchIssues({ state: 'open', repository: `${owner}/${repo}`, page, perPage: 25 });
    return (
      <Panel title="Issue đang mở" id="issues">
        {result.items.length === 0 ? (
          <Empty>Không có issue nào đang mở trong repository này.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Issue</th>
                  <th>Nhãn</th>
                  <th>Cập nhật</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <a href={item.htmlUrl} target="_blank" rel="noreferrer noopener">
                        #{item.number} {item.title}
                      </a>
                      <div className="muted small">
                        {item.author} · {item.comments} bình luận
                      </div>
                    </td>
                    <td>
                      {item.labels.length === 0 ? (
                        <span className="muted small">không nhãn</span>
                      ) : (
                        item.labels.map((label) => (
                          <span key={label.name} className="label-chip" style={{ borderColor: `#${label.color}` }}>
                            {label.name}
                          </span>
                        ))
                      )}
                    </td>
                    <td className="nowrap muted small">{relativeTime(item.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ScopeNote scope={result.pageInfo.scope} fetchedAt={result.pageInfo.fetchedAt} />
      </Panel>
    );
  } catch (err) {
    return <GitHubErrorNotice error={err} />;
  }
}

async function PullsTab({ owner, repo, page }: { owner: string; repo: string; page: number }) {
  try {
    const result = await fetchPullRequests({ state: 'open', repository: `${owner}/${repo}`, page, perPage: 25 });
    return (
      <Panel title="Pull request đang mở" id="pulls">
        {result.items.length === 0 ? (
          <Empty>Không có pull request nào đang mở.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pull request</th>
                  <th>Trạng thái</th>
                  <th>Cập nhật</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <a href={item.htmlUrl} target="_blank" rel="noreferrer noopener">
                        #{item.number} {item.title}
                      </a>
                      <div className="muted small">{item.author}</div>
                    </td>
                    <td>{item.draft ? <Badge tone="warn">nháp</Badge> : <Badge tone="info">mở</Badge>}</td>
                    <td className="nowrap muted small">{relativeTime(item.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ScopeNote scope={result.pageInfo.scope} fetchedAt={result.pageInfo.fetchedAt} />
      </Panel>
    );
  } catch (err) {
    return <GitHubErrorNotice error={err} />;
  }
}

async function ActionsTab({ owner, repo, page }: { owner: string; repo: string; page: number }) {
  try {
    const result = await fetchWorkflowRuns(owner, repo, page, 20);
    return (
      <Panel title="Workflow run" id="actions">
        {result.runs.length === 0 ? (
          <Empty>
            Repository này chưa có workflow run nào, hoặc token không có quyền Actions: read.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Kết quả</th>
                  <th>Nhánh</th>
                  <th>Thời lượng</th>
                </tr>
              </thead>
              <tbody>
                {result.runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <a href={run.htmlUrl} target="_blank" rel="noreferrer noopener">
                        {run.name}
                      </a>
                      <div className="muted small truncate" title={run.displayTitle}>
                        {run.displayTitle}
                      </div>
                    </td>
                    <td>
                      <Badge tone={conclusionTone(run.conclusion)}>
                        {run.status !== 'completed' ? run.status ?? 'đang chạy' : run.conclusion ?? 'không rõ'}
                      </Badge>
                    </td>
                    <td className="mono small">{run.headBranch ?? '—'}</td>
                    <td className="nowrap muted small">{formatDuration(run.runStartedAt ?? run.createdAt, run.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ScopeNote
          scope={`${result.pageInfo.scope} Tổng ${formatNumber(result.totalCount)} run.`}
          fetchedAt={result.pageInfo.fetchedAt}
        />
        <p className="muted small">
          Không hiển thị log hay artifact ở đây: dữ liệu đó cần quyền riêng và có thể rất lớn. Mỗi run đều có liên kết
          trực tiếp để xem trên GitHub.
        </p>
      </Panel>
    );
  } catch (err) {
    return <GitHubErrorNotice error={err} />;
  }
}

async function ReleasesTab({ owner, repo, page }: { owner: string; repo: string; page: number }) {
  try {
    const result = await fetchReleases(owner, repo, page, 20);
    return (
      <Panel title="Release" id="releases">
        {result.releases.length === 0 ? (
          <Empty>Repository này chưa công bố release nào.</Empty>
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
                {result.releases.map((release) => (
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
        <ScopeNote scope={result.pageInfo.scope} fetchedAt={result.pageInfo.fetchedAt} />
      </Panel>
    );
  } catch (err) {
    return <GitHubErrorNotice error={err} />;
  }
}
