// Typed GitHub queries used by the screens.
//
// Two rules are enforced throughout:
//   1. Every external URL comes from GitHub's own payload (`html_url`), never
//      assembled by hand.
//   2. Any count that is only a page subtotal is labelled as such by the
//      caller, using the `scope` metadata returned here.

import { GitHubError, describeError, graphql, rest, restPaginated } from './github';

const SEGMENT = /^[A-Za-z0-9_.-]+$/;

const GITHUB_WEB = 'https://github.com';
const RESOURCE_PATH = /^\/(?:[A-Za-z0-9_.-]+\/){2,}/;

/**
 * GitHub's GraphQL `url` field for an issue or pull request is the *API* URL
 * (`https://api.github.com/repos/...`), which is useless as a link for a human.
 * GraphQL supplies `resourcePath` for the web path, so the web URL is derived
 * from that payload value rather than from an id we invented. If it is absent
 * or unexpected, the API URL is returned so the caller can still see something
 * real instead of a fabricated link.
 */
export function githubWebUrl(resourcePath: string | null | undefined, fallback: string): string {
  if (resourcePath && RESOURCE_PATH.test(resourcePath) && !resourcePath.includes('..')) {
    return `${GITHUB_WEB}${resourcePath}`;
  }
  return fallback;
}

/** Rejects anything that is not a plausible owner or repository segment. */
export function isValidSegment(value: string | undefined | null): value is string {
  if (!value || value.length > 100 || !SEGMENT.test(value)) return false;
  // '.', '..' and all-dot names satisfy the character class but are path
  // traversal segments, not GitHub owners or repositories.
  if (/^\.+$/.test(value)) return false;
  return /[A-Za-z0-9]/.test(value);
}

export function assertSegment(value: string, label: string): string {
  if (!isValidSegment(value)) {
    throw new GitHubError('not_found', `${label} không hợp lệ.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export interface PageInfo {
  /** How many items this response contains. */
  count: number;
  /** True when the upstream API reported more results than were fetched. */
  truncated: boolean;
  /** Human-readable note about what the numbers cover. */
  scope: string;
  fetchedAt: string;
}

export interface Viewer {
  login: string;
  name: string | null;
  avatarUrl: string;
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export interface RepositorySummary {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  language: string | null;
  defaultBranch: string | null;
  htmlUrl: string;
  pushedAt: string | null;
  updatedAt: string | null;
  openIssues: number;
  stars: number;
  archived: boolean;
  fork: boolean;
}

interface RawRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
  private: boolean;
  language: string | null;
  default_branch: string | null;
  html_url: string;
  pushed_at: string | null;
  updated_at: string | null;
  open_issues_count: number;
  stargazers_count: number;
  archived: boolean;
  fork: boolean;
}

function mapRepo(raw: RawRepo): RepositorySummary {
  return {
    id: raw.id,
    fullName: raw.full_name,
    owner: raw.owner.login,
    name: raw.name,
    description: raw.description,
    isPrivate: raw.private,
    language: raw.language,
    defaultBranch: raw.default_branch,
    htmlUrl: raw.html_url,
    pushedAt: raw.pushed_at,
    updatedAt: raw.updated_at,
    openIssues: raw.open_issues_count,
    stars: raw.stargazers_count,
    archived: raw.archived,
    fork: raw.fork,
  };
}

/** Loads every repository the token can reach, up to a bounded page count. */
export async function fetchRepositories(maxPages = 5): Promise<{ repos: RepositorySummary[]; pageInfo: PageInfo }> {
  const { items, pagesFetched, truncated } = await restPaginated<RawRepo>('/user/repos', {
    params: { affiliation: 'owner,collaborator,organization_member', sort: 'pushed', direction: 'desc' },
    perPage: 100,
    maxPages,
  });
  const repos = items.map(mapRepo);
  return {
    repos,
    pageInfo: {
      count: repos.length,
      truncated,
      scope: truncated
        ? `Đã tải ${repos.length} repo trong ${pagesFetched} trang; còn repo chưa tải nên số liệu tổng hợp là một phần.`
        : `Đã tải toàn bộ ${repos.length} repo mà token này truy cập được.`,
      fetchedAt: new Date().toISOString(),
    },
  };
}

export async function fetchRepository(owner: string, name: string): Promise<RepositorySummary> {
  assertSegment(owner, 'Owner');
  assertSegment(name, 'Tên repository');
  const raw = await rest<RawRepo>(`/repos/${owner}/${name}`);
  return mapRepo(raw);
}

// ---------------------------------------------------------------------------
// Issues and pull requests (cross-repository via the search API)
// ---------------------------------------------------------------------------

export interface IssueListItem {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  isPullRequest: boolean;
  repository: string;
  author: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  comments: number;
  labels: Array<{ name: string; color: string }>;
  draft?: boolean;
}

interface RawSearchItem {
  id: number;
  number: number;
  title: string;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  comments: number;
  repository_url: string;
  user: { login: string } | null;
  labels: Array<{ name: string; color: string }>;
  pull_request?: { draft?: boolean };
}

function repoFromUrl(repositoryUrl: string): string {
  const marker = '/repos/';
  const index = repositoryUrl.indexOf(marker);
  return index === -1 ? repositoryUrl : repositoryUrl.slice(index + marker.length);
}

function mapSearchItem(raw: RawSearchItem): IssueListItem {
  return {
    id: raw.id,
    number: raw.number,
    title: raw.title,
    state: raw.state === 'open' ? 'open' : 'closed',
    isPullRequest: Boolean(raw.pull_request),
    repository: repoFromUrl(raw.repository_url),
    author: raw.user?.login ?? 'không rõ',
    htmlUrl: raw.html_url,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    comments: raw.comments,
    labels: raw.labels.map((label) => ({ name: label.name, color: label.color })),
    draft: raw.pull_request?.draft,
  };
}

export interface ListFilters {
  state: 'open' | 'closed' | 'all';
  repository?: string;
  label?: string;
  author?: string;
  /**
   * GitHub login used to scope the search when no repository is chosen.
   * Without a scope, GitHub search counts every issue on GitHub, so an
   * unscoped query is never issued.
   */
  involves?: string;
  page: number;
  perPage: number;
}

function buildIssueQuery(kind: 'issue' | 'pr', filters: ListFilters): string {
  const parts = [`is:${kind}`];
  parts.push(filters.state === 'all' ? '' : `state:${filters.state}`);

  const [owner, name] = (filters.repository ?? '').split('/');
  const hasRepo = isValidSegment(owner) && isValidSegment(name);
  if (hasRepo) parts.push(`repo:${owner}/${name}`);

  // A search with no owner or repo qualifier matches all of GitHub. That would
  // report tens of millions of issues as if they were the user's, so an
  // unscoped query is scoped to the viewer — and refused when there is no
  // scope to apply.
  if (!hasRepo) {
    if (filters.involves && isValidSegment(filters.involves)) {
      parts.push(`involves:${filters.involves}`);
    } else {
      throw new GitHubError('unconfigured', 'Thiếu phạm vi tìm kiếm: cần repository hoặc tài khoản.');
    }
  }

  if (filters.label) parts.push(`label:"${filters.label.replace(/"/g, '')}"`);
  if (filters.author && isValidSegment(filters.author)) parts.push(`author:${filters.author}`);
  return parts.filter(Boolean).join(' ');
}

interface RawSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: RawSearchItem[];
}

async function searchIssues(kind: 'issue' | 'pr', filters: ListFilters) {
  const query = buildIssueQuery(kind, filters);
  const data = await rest<RawSearchResponse>('/search/issues', {
    params: { q: query, sort: 'updated', order: 'desc', per_page: filters.perPage, page: filters.page },
  });

  const items = data.items
    .map(mapSearchItem)
    // GitHub respects is:issue / is:pr, but a mismatched payload must not be
    // mislabelled as the wrong kind by this layer.
    .filter((item) => (kind === 'pr' ? item.isPullRequest : !item.isPullRequest));
  const maxReachable = Math.min(data.total_count, 1000); // GitHub search caps at 1000
  const notes: string[] = [];
  if (data.incomplete_results) notes.push('GitHub báo kết quả chưa đầy đủ (incomplete_results).');
  if (data.total_count > 1000) notes.push(`GitHub chỉ trả tối đa 1000 kết quả; tổng thực là ${data.total_count}.`);

  return {
    items,
    totalCount: data.total_count,
    incomplete: data.incomplete_results,
    pageInfo: {
      count: items.length,
      truncated: data.total_count > filters.page * filters.perPage || data.incomplete_results,
      scope: notes.length ? notes.join(' ') : `Trang ${filters.page}, tối đa ${filters.perPage} mục.`,
      fetchedAt: new Date().toISOString(),
    } satisfies PageInfo,
    maxReachable,
  };
}

export function fetchIssues(filters: ListFilters) {
  return searchIssues('issue', filters);
}

export function fetchPullRequests(filters: ListFilters) {
  return searchIssues('pr', filters);
}

// ---------------------------------------------------------------------------
// Per-repository counters
// ---------------------------------------------------------------------------

export interface RepositoryCounts {
  fullName: string;
  openIssues: number;
  openPulls: number;
}

/**
 * Exact open issue / open pull request totals per repository.
 *
 * Search cannot express "every repository this token can see": a query with no
 * repo qualifier counts all of GitHub, and one `repo:` qualifier covers one
 * repository. GraphQL field aliases answer the whole set in one request with
 * exact totals, so the dashboard never mistakes a global number for a personal
 * one.
 */
export async function fetchRepositoryCounts(
  repositories: Array<{ owner: string; name: string }>,
): Promise<RepositoryCounts[]> {
  const CHUNK = 40;
  const results: RepositoryCounts[] = [];

  // Only empty values are dropped. Everything else is passed as a GraphQL
  // *variable*, so no repository name is ever concatenated into query text and
  // names like "-" are counted instead of silently excluded.
  const usable = repositories.filter((repo) => Boolean(repo.owner) && Boolean(repo.name));

  for (let start = 0; start < usable.length; start += CHUNK) {
    const chunk = usable.slice(start, start + CHUNK);

    const declared: string[] = [];
    const fields: string[] = [];
    const variables: Record<string, string> = {};

    chunk.forEach((repo, index) => {
      declared.push(`$o${index}: String!`, `$n${index}: String!`);
      variables[`o${index}`] = repo.owner;
      variables[`n${index}`] = repo.name;
      fields.push(
        `r${index}: repository(owner: $o${index}, name: $n${index}) {
           nameWithOwner
           issues(states: OPEN) { totalCount }
           pullRequests(states: OPEN) { totalCount }
         }`,
      );
    });

    const query = `query Counts(${declared.join(', ')}) {\n${fields.join('\n')}\n}`;

    const data = await graphql<Record<string, {
      nameWithOwner: string;
      issues: { totalCount: number };
      pullRequests: { totalCount: number };
    } | null>>(query, variables);

    chunk.forEach((repo, index) => {
      const entry = data[`r${index}`];
      if (!entry) return;
      results.push({
        fullName: entry.nameWithOwner,
        openIssues: entry.issues.totalCount,
        openPulls: entry.pullRequests.totalCount,
      });
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Issue detail
// ---------------------------------------------------------------------------

export interface IssueDetail {
  number: number;
  title: string;
  body: string | null;
  state: string;
  stateReason: string | null;
  htmlUrl: string;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  commentsCount: number;
  labels: Array<{ name: string; color: string }>;
  assignees: string[];
  milestone: string | null;
  repository: { nameWithOwner: string; url: string };
  comments: Array<{ id: string; author: string | null; body: string; createdAt: string; url: string }>;
}

const ISSUE_QUERY = `
query Issue($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    url
    issue(number: $number) {
      number title body state stateReason url resourcePath createdAt updatedAt closedAt
      author { login }
      comments(first: 30) {
        totalCount
        nodes { id body createdAt url author { login } }
      }
      labels(first: 20) { nodes { name color } }
      assignees(first: 10) { nodes { login } }
      milestone { title }
    }
  }
}`;

interface RawIssueResponse {
  repository: {
    nameWithOwner: string;
    url: string;
    issue: {
      number: number;
      title: string;
      body: string | null;
      state: string;
      stateReason: string | null;
      url: string;
      resourcePath: string | null;
      createdAt: string;
      updatedAt: string;
      closedAt: string | null;
      author: { login: string } | null;
      comments: { totalCount: number; nodes: Array<{ id: string; body: string; createdAt: string; url: string; author: { login: string } | null }> };
      labels: { nodes: Array<{ name: string; color: string }> };
      assignees: { nodes: Array<{ login: string }> };
      milestone: { title: string } | null;
    } | null;
  } | null;
}

export async function fetchIssue(owner: string, name: string, number: number): Promise<IssueDetail> {
  assertSegment(owner, 'Owner');
  assertSegment(name, 'Tên repository');
  const data = await graphql<RawIssueResponse>(ISSUE_QUERY, { owner, name, number });
  const repo = data.repository;
  if (!repo) throw new GitHubError('not_found', 'Không tìm thấy repository hoặc không có quyền xem.');
  const issue = repo.issue;
  if (!issue) throw new GitHubError('not_found', `Không tìm thấy issue #${number}.`);

  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    stateReason: issue.stateReason,
    htmlUrl: githubWebUrl(issue.resourcePath, issue.url),
    author: issue.author?.login ?? null,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    closedAt: issue.closedAt,
    commentsCount: issue.comments.totalCount,
    labels: issue.labels.nodes,
    assignees: issue.assignees.nodes.map((node) => node.login),
    milestone: issue.milestone?.title ?? null,
    repository: { nameWithOwner: repo.nameWithOwner, url: repo.url },
    comments: issue.comments.nodes.map((comment) => ({
      id: comment.id,
      author: comment.author?.login ?? null,
      body: comment.body,
      createdAt: comment.createdAt,
      url: comment.url,
    })),
  };
}

// ---------------------------------------------------------------------------
// Pull request detail
// ---------------------------------------------------------------------------

export type CheckState = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'NEUTRAL' | 'SKIPPED' | 'UNKNOWN';

export interface PullDetail {
  number: number;
  title: string;
  body: string | null;
  state: string;
  isDraft: boolean;
  mergeable: string;
  mergeStateStatus: string;
  reviewDecision: string | null;
  htmlUrl: string;
  author: string | null;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  repository: { nameWithOwner: string; url: string };
  reviews: Array<{ id: string; author: string | null; state: string; submittedAt: string | null }>;
  reviewRequests: string[];
  files: Array<{ path: string; additions: number; deletions: number; changeType: string }>;
  commits: Array<{ oid: string; message: string; committedDate: string; author: string | null }>;
  checks: Array<{ name: string; state: CheckState; url: string | null }>;
}

const PULL_QUERY = `
query Pull($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    url
    pullRequest(number: $number) {
      number title body state isDraft mergeable mergeStateStatus reviewDecision url resourcePath
      additions deletions changedFiles createdAt updatedAt mergedAt
      headRefName baseRefName
      author { login }
      reviews(first: 20) { nodes { id state submittedAt author { login } } }
      reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
      files(first: 100) { nodes { path additions deletions changeType } }
      commits(last: 20) { nodes { commit { oid messageHeadline committedDate author { name } } } }
    }
  }
}`;

interface RawPullResponse {
  repository: {
    nameWithOwner: string;
    url: string;
    pullRequest: {
      number: number;
      title: string;
      body: string | null;
      state: string;
      isDraft: boolean;
      mergeable: string;
      mergeStateStatus: string;
      reviewDecision: string | null;
      url: string;
      resourcePath: string | null;
      additions: number;
      deletions: number;
      changedFiles: number;
      createdAt: string;
      updatedAt: string;
      mergedAt: string | null;
      headRefName: string;
      baseRefName: string;
      author: { login: string } | null;
      reviews: { nodes: Array<{ id: string; state: string; submittedAt: string | null; author: { login: string } | null }> };
      reviewRequests: { nodes: Array<{ requestedReviewer: { login?: string; name?: string } | null }> };
      files: { nodes: Array<{ path: string; additions: number; deletions: number; changeType: string }> };
      commits: { nodes: Array<{ commit: { oid: string; messageHeadline: string; committedDate: string; author: { name: string } | null } }> };
    } | null;
  } | null;
}

export async function fetchPull(owner: string, name: string, number: number): Promise<{
  pull: PullDetail;
  checksAvailable: boolean;
  checksNote: string | null;
}> {
  assertSegment(owner, 'Owner');
  assertSegment(name, 'Tên repository');

  const data = await graphql<RawPullResponse>(PULL_QUERY, { owner, name, number });
  const repo = data.repository;
  if (!repo) throw new GitHubError('not_found', 'Không tìm thấy repository hoặc không có quyền xem.');
  const pull = repo.pullRequest;
  if (!pull) throw new GitHubError('not_found', `Không tìm thấy pull request #${number}.`);

  // Checks live on a separate endpoint and need a permission (Checks: read).
  // Failure there must not fail the whole page — but it must be visible.
  let checks: PullDetail['checks'] = [];
  let checksAvailable = false;
  let checksNote: string | null = null;

  if (pull.commits.nodes.length) {
    const sha = pull.commits.nodes[pull.commits.nodes.length - 1].commit.oid;
    try {
      const payload = await rest<{ total_count: number; check_runs: Array<{ name: string; status: string; conclusion: string | null; html_url: string | null; details_url: string | null }> }>(
        `/repos/${owner}/${name}/commits/${sha}/check-runs`,
        { params: { per_page: 50 } },
      );
      checksAvailable = true;
      checks = payload.check_runs.map((run) => ({
        name: run.name,
        state: toCheckState(run.status, run.conclusion),
        url: run.details_url ?? run.html_url ?? null,
      }));
    } catch (err) {
      checksNote =
        err instanceof GitHubError && err.kind === 'permission'
          ? 'Token không có quyền đọc check-runs (cần quyền Checks: read).'
          : 'Không tải được check-runs cho commit mới nhất.';
    }
  } else {
    checksNote = 'Pull request chưa có commit nào để kiểm tra.';
  }

  return {
    pull: {
      number: pull.number,
      title: pull.title,
      body: pull.body,
      state: pull.state,
      isDraft: pull.isDraft,
      mergeable: pull.mergeable,
      mergeStateStatus: pull.mergeStateStatus,
      reviewDecision: pull.reviewDecision,
      htmlUrl: githubWebUrl(pull.resourcePath, pull.url),
      author: pull.author?.login ?? null,
      headRefName: pull.headRefName,
      baseRefName: pull.baseRefName,
      additions: pull.additions,
      deletions: pull.deletions,
      changedFiles: pull.changedFiles,
      createdAt: pull.createdAt,
      updatedAt: pull.updatedAt,
      mergedAt: pull.mergedAt,
      repository: { nameWithOwner: repo.nameWithOwner, url: repo.url },
      reviews: pull.reviews.nodes.map((review) => ({
        id: review.id,
        author: review.author?.login ?? null,
        state: review.state,
        submittedAt: review.submittedAt,
      })),
      reviewRequests: pull.reviewRequests.nodes
        .map((node) => node.requestedReviewer?.login ?? node.requestedReviewer?.name ?? null)
        .filter((value): value is string => Boolean(value)),
      files: pull.files.nodes,
      commits: pull.commits.nodes.map((node) => ({
        oid: node.commit.oid,
        message: node.commit.messageHeadline,
        committedDate: node.commit.committedDate,
        author: node.commit.author?.name ?? null,
      })),
      checks,
    },
    checksAvailable,
    checksNote,
  };
}

/**
 * Normalises a check-run outcome to the UI's coarse state.
 *
 * The REST check-runs endpoint returns lowercase values (`completed`,
 * `success`) while GraphQL uses uppercase enums, so both are normalised here.
 * Getting this wrong silently reports every passing check as UNKNOWN, which is
 * exactly the kind of "looks fine but is wrong" defect that matters on a CI
 * screen.
 */
export function toCheckState(status: string, conclusion: string | null): CheckState {
  const normalisedStatus = status.toUpperCase();
  const normalisedConclusion = (conclusion ?? '').toUpperCase();

  if (normalisedStatus !== 'COMPLETED') return 'PENDING';
  switch (normalisedConclusion) {
    case 'SUCCESS':
      return 'SUCCESS';
    case 'FAILURE':
    case 'TIMED_OUT':
    case 'ACTION_REQUIRED':
    case 'STARTUP_FAILURE':
      return 'FAILURE';
    case 'CANCELLED':
    case 'SKIPPED':
    case 'STALE':
      return 'SKIPPED';
    case 'NEUTRAL':
      return 'NEUTRAL';
    default:
      return 'UNKNOWN';
  }
}

// ---------------------------------------------------------------------------
// Actions / CI
// ---------------------------------------------------------------------------

export interface WorkflowRun {
  id: number;
  name: string;
  displayTitle: string;
  status: string | null;
  conclusion: string | null;
  event: string;
  headBranch: string | null;
  actor: string | null;
  createdAt: string;
  updatedAt: string | null;
  runStartedAt: string | null;
  htmlUrl: string;
  repository: string;
}

export async function fetchWorkflowRuns(owner: string, name: string, page = 1, perPage = 20) {
  assertSegment(owner, 'Owner');
  assertSegment(name, 'Tên repository');

  const data = await rest<{
    total_count: number;
    workflow_runs: Array<{
      id: number;
      name: string;
      display_title: string;
      status: string | null;
      conclusion: string | null;
      event: string;
      head_branch: string | null;
      created_at: string;
      updated_at: string | null;
      run_started_at: string | null;
      html_url: string;
      actor: { login: string } | null;
      repository?: { full_name: string };
    }>;
  }>(`/repos/${owner}/${name}/actions/runs`, { params: { per_page: perPage, page } });

  const runs: WorkflowRun[] = data.workflow_runs.map((run) => ({
    id: run.id,
    name: run.name,
    displayTitle: run.display_title,
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    headBranch: run.head_branch,
    actor: run.actor?.login ?? null,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    runStartedAt: run.run_started_at,
    htmlUrl: run.html_url,
    repository: `${owner}/${name}`,
  }));

  return {
    runs,
    totalCount: data.total_count,
    pageInfo: {
      count: runs.length,
      truncated: data.total_count > page * perPage,
      scope: `Repo ${owner}/${name}, trang ${page}.`,
      fetchedAt: new Date().toISOString(),
    } satisfies PageInfo,
  };
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

export interface ReleaseSummary {
  id: number;
  name: string | null;
  tagName: string;
  isPrerelease: boolean;
  isDraft: boolean;
  publishedAt: string | null;
  createdAt: string;
  htmlUrl: string;
  author: string | null;
  repository: string;
}

export async function fetchReleases(owner: string, name: string, page = 1, perPage = 20) {
  assertSegment(owner, 'Owner');
  assertSegment(name, 'Tên repository');

  const data = await rest<Array<{
    id: number;
    name: string | null;
    tag_name: string;
    prerelease: boolean;
    draft: boolean;
    published_at: string | null;
    created_at: string;
    html_url: string;
    author: { login: string } | null;
  }>>(`/repos/${owner}/${name}/releases`, { params: { per_page: perPage, page } });

  const releases: ReleaseSummary[] = data.map((release) => ({
    id: release.id,
    name: release.name,
    tagName: release.tag_name,
    isPrerelease: release.prerelease,
    isDraft: release.draft,
    publishedAt: release.published_at,
    createdAt: release.created_at,
    htmlUrl: release.html_url,
    author: release.author?.login ?? null,
    repository: `${owner}/${name}`,
  }));

  return {
    releases,
    pageInfo: {
      count: releases.length,
      truncated: releases.length === perPage,
      scope: `Repo ${owner}/${name}, trang ${page}.`,
      fetchedAt: new Date().toISOString(),
    } satisfies PageInfo,
  };
}

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------

export interface CommitSummary {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  htmlUrl: string;
  repository: string;
}

export async function fetchCommits(owner: string, name: string, page = 1, perPage = 20) {
  assertSegment(owner, 'Owner');
  assertSegment(name, 'Tên repository');

  const data = await rest<Array<{
    sha: string;
    html_url: string;
    commit: { message: string; author: { name: string; date: string } | null };
  }>>(`/repos/${owner}/${name}/commits`, { params: { per_page: perPage, page } });

  const commits: CommitSummary[] = data.map((commit) => ({
    sha: commit.sha,
    shortSha: commit.sha.slice(0, 7),
    message: (commit.commit.message ?? '').split('\n')[0],
    author: commit.commit.author?.name ?? 'không rõ',
    date: commit.commit.author?.date ?? '',
    htmlUrl: commit.html_url,
    repository: `${owner}/${name}`,
  }));

  return {
    commits,
    pageInfo: {
      count: commits.length,
      truncated: commits.length === perPage,
      scope: `Repo ${owner}/${name}, trang ${page}.`,
      fetchedAt: new Date().toISOString(),
    } satisfies PageInfo,
  };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotificationItem {
  id: string;
  unread: boolean;
  reason: string;
  subjectTitle: string;
  subjectType: string;
  subjectUrl: string | null;
  repository: string;
  updatedAt: string;
}

export async function fetchNotifications(): Promise<{
  items: NotificationItem[];
  scope: string;
  fetchedAt: string;
  permissionLimited: boolean;
}> {
  const fetchedAt = new Date().toISOString();
  try {
    const data = await rest<Array<{
      id: string;
      unread: boolean;
      reason: string;
      updated_at: string;
      subject: { title: string; type: string; url: string | null };
      repository: { full_name: string };
    }>>('/notifications', { params: { all: false, per_page: 50 } });

    return {
      items: data.map((item) => ({
        id: item.id,
        unread: item.unread,
        reason: item.reason,
        subjectTitle: item.subject.title,
        subjectType: item.subject.type,
        subjectUrl: item.subject.url,
        repository: item.repository.full_name,
        updatedAt: item.updated_at,
      })),
      scope: `Tối đa 50 thông báo chưa đọc gần nhất (trang 1).`,
      fetchedAt,
      permissionLimited: false,
    };
  } catch (err) {
    if (err instanceof GitHubError && (err.kind === 'permission' || err.kind === 'auth')) {
      return {
        items: [],
        scope: 'Không đọc được thông báo.',
        fetchedAt,
        permissionLimited: true,
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchResult {
  kind: 'issue' | 'pull' | 'repository';
  title: string;
  subtitle: string;
  htmlUrl: string;
  updatedAt: string;
  extra: string;
}

export async function searchAll(term: string, kind: 'all' | 'issues' | 'pulls' | 'repos', page = 1) {
  const cleaned = term.trim().slice(0, 256).replace(/[\r\n\t]/g, ' ');
  if (!cleaned) {
    return { results: [] as SearchResult[], totalCount: 0, notes: ['Nhập từ khoá để tìm kiếm.'], fetchedAt: new Date().toISOString() };
  }

  const notes: string[] = [];
  const results: SearchResult[] = [];
  let totalCount = 0;

  const wantIssues = kind === 'all' || kind === 'issues';
  const wantPulls = kind === 'all' || kind === 'pulls';
  const wantRepos = kind === 'all' || kind === 'repos';

  if (wantIssues || wantPulls) {
    // `/search/issues` now rejects a query without `is:issue` or `is:pr`
    // (HTTP 422), so "all" is answered by one scoped query per type rather
    // than by one unscoped query.
    const qualifiers: Array<{ qualifier: 'is:issue' | 'is:pr'; label: string }> = [];
    if (wantIssues) qualifiers.push({ qualifier: 'is:issue', label: 'Issue' });
    if (wantPulls) qualifiers.push({ qualifier: 'is:pr', label: 'Pull request' });

    for (const { qualifier, label } of qualifiers) {
      const query = `${cleaned} ${qualifier}`;
      try {
        const data = await rest<RawSearchResponse>('/search/issues', {
          params: { q: query, sort: 'updated', order: 'desc', per_page: 20, page },
        });
        totalCount += data.total_count;
        if (data.incomplete_results) notes.push(`${label}: GitHub báo kết quả chưa đầy đủ.`);
        if (data.total_count > 1000) {
          notes.push(`${label}: GitHub chỉ trả tối đa 1000 kết quả, tổng thực ${data.total_count}.`);
        }
        for (const item of data.items) {
          results.push({
            kind: item.pull_request ? 'pull' : 'issue',
            title: `#${item.number} ${item.title}`,
            subtitle: repoFromUrl(item.repository_url),
            htmlUrl: item.html_url,
            updatedAt: item.updated_at,
            extra: item.state,
          });
        }
      } catch (err) {
        if (err instanceof GitHubError && err.kind === 'rate_limit') {
          notes.push(`Đã chạm hạn mức tìm kiếm ${label.toLowerCase()} của GitHub.`);
        } else {
          throw err;
        }
      }
    }
  }

  if (wantRepos) {
    try {
      const data = await rest<{ total_count: number; items: Array<{ id: number; full_name: string; description: string | null; html_url: string; updated_at: string; private: boolean }> }>(
        '/search/repositories',
        { params: { q: cleaned, sort: 'updated', order: 'desc', per_page: 20, page } },
      );
      totalCount += data.total_count;
      if (data.total_count > 1000) notes.push(`Repository: GitHub chỉ trả tối đa 1000 kết quả, tổng thực ${data.total_count}.`);
      for (const repo of data.items) {
        results.push({
          kind: 'repository',
          title: repo.full_name,
          subtitle: repo.description ?? '',
          htmlUrl: repo.html_url,
          updatedAt: repo.updated_at,
          extra: repo.private ? 'riêng tư' : 'công khai',
        });
      }
    } catch (err) {
      if (err instanceof GitHubError && err.kind === 'rate_limit') notes.push('Đã chạm hạn mức tìm kiếm repository của GitHub.');
      else throw err;
    }
  }

  results.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { results, totalCount, notes, fetchedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Viewer + overview
// ---------------------------------------------------------------------------

export async function fetchViewer(): Promise<Viewer> {
  const raw = await rest<{ login: string; name: string | null; avatar_url: string }>('/user', { timeoutMs: 8000 });
  return { login: raw.login, name: raw.name, avatarUrl: raw.avatar_url };
}

export interface Overview {
  viewer: Viewer;
  repoTotal: number;
  reposLoaded: number;
  reposTruncated: boolean;
  openIssues: number;
  /** Where `openIssues` came from, so the UI can label it truthfully. */
  openIssuesSource: 'graphql' | 'repo-sum';
  /** True when some repositories did not answer the counter query. */
  countsPartial: boolean;
  openPulls: number;
  privateRepos: number;
  openPullsList: Array<{ number: number; title: string; url: string; repository: string; isDraft: boolean; reviewDecision: string | null; updatedAt: string }>;
  attention: Array<{ kind: string; title: string; url: string; detail: string }>;
  recentCommits: CommitSummary[];
  recentReleases: ReleaseSummary[];
  fetchedAt: string;
  scopeNote: string;
}

/**
 * Overview assembled from real endpoints.
 *
 * Deliberately NOT one giant GraphQL aggregate: repository totals must be
 * reported either completely or explicitly as partial. `reposTruncated` drives
 * that wording in the UI.
 */
export async function fetchOverview(): Promise<Overview> {
  const viewer = await fetchViewer();
  const { repos, pageInfo } = await fetchRepositories(3);

  const privateRepos = repos.filter((repo) => repo.isPrivate).length;

  // Exact per-repository counters. `open_issues_count` is deliberately not used
  // for the issue figure: GitHub includes pull requests in it, which would
  // overstate the number while looking authoritative.
  let openIssues = 0;
  let openIssuesSource: Overview['openIssuesSource'] = 'graphql';
  let countsPartial = false;
  try {
    const counts = await fetchRepositoryCounts(repos.map((repo) => ({ owner: repo.owner, name: repo.name })));
    openIssues = counts.reduce((sum, entry) => sum + entry.openIssues, 0);
    countsPartial = counts.length < repos.length;
  } catch {
    // Fall back to the repository endpoint's combined counter and say so.
    openIssues = repos.reduce((sum, repo) => sum + repo.openIssues, 0);
    openIssuesSource = 'repo-sum';
  }

  // Open PRs the account is involved in, across all repositories.
  let openPullsList: Overview['openPullsList'] = [];
  let openPullsTotal = 0;
  const attention: Overview['attention'] = [];

  try {
    const pulls = await fetchPullRequests({
      state: 'open',
      page: 1,
      perPage: 25,
      involves: viewer.login,
    });
    openPullsTotal = pulls.totalCount;
    openPullsList = pulls.items.slice(0, 10).map((item) => ({
      number: item.number,
      title: item.title,
      url: item.htmlUrl,
      repository: item.repository,
      isDraft: Boolean(item.draft),
      reviewDecision: null,
      updatedAt: item.updatedAt,
    }));

    const staleMs = 7 * 24 * 60 * 60 * 1000;
    for (const pull of pulls.items) {
      if (Date.now() - new Date(pull.updatedAt).getTime() > staleMs) {
        attention.push({
          kind: 'PR quá 7 ngày',
          title: `#${pull.number} ${pull.title}`,
          url: pull.htmlUrl,
          detail: `${pull.repository} · cập nhật ${pull.updatedAt.slice(0, 10)}`,
        });
      }
    }
  } catch (err) {
    // Overview must still render; the pull list simply reports its own failure.
    attention.push({
      kind: 'Không tải được PR',
      title: 'Danh sách pull request không tải được',
      url: '',
      detail: err instanceof GitHubError ? err.message : 'Lỗi không xác định',
    });
  }

  // Recent commits and releases from the most recently pushed repository, so
  // the numbers are tied to a named source rather than implied to be global.
  let recentCommits: CommitSummary[] = [];
  let recentReleases: ReleaseSummary[] = [];
  const primary = repos[0];
  if (primary) {
    try {
      recentCommits = (await fetchCommits(primary.owner, primary.name, 1, 5)).commits;
    } catch {
      recentCommits = [];
    }
    try {
      recentReleases = (await fetchReleases(primary.owner, primary.name, 1, 5)).releases;
    } catch {
      recentReleases = [];
    }
  }

  for (const repo of repos.slice(0, 6)) {
    if (repo.archived) continue;
    const idleMs = 60 * 24 * 60 * 60 * 1000;
    if (repo.pushedAt && Date.now() - new Date(repo.pushedAt).getTime() > idleMs) {
      attention.push({
        kind: 'Không hoạt động 60 ngày',
        title: repo.fullName,
        url: repo.htmlUrl,
        detail: `push gần nhất ${repo.pushedAt.slice(0, 10)}`,
      });
    }
  }

  return {
    viewer,
    // When truncated this is a lower bound; `reposTruncated` tells the UI to say so.
    repoTotal: repos.length,
    reposLoaded: repos.length,
    reposTruncated: pageInfo.truncated,
    openIssues,
    openIssuesSource,
    countsPartial,
    openPulls: openPullsTotal,
    privateRepos,
    openPullsList,
    attention: attention.slice(0, 12),
    recentCommits,
    recentReleases,
    fetchedAt: new Date().toISOString(),
    scopeNote: pageInfo.truncated
      ? `Số liệu issue/PR tính trên ${repos.length} repo gần nhất; còn repo chưa tải nên tổng là một phần.`
      : `Số liệu issue/PR tính trên toàn bộ ${repos.length} repo mà token này truy cập được.`,
  };
}

// ---------------------------------------------------------------------------
// Cross-repository aggregation
//
// These helpers fan out over repositories. Partial failure is returned, never
// swallowed: a page that silently drops a failing repository would report a
// smaller number as if it were complete.
// ---------------------------------------------------------------------------

export type RecentRun = WorkflowRun;
export type RecentRelease = ReleaseSummary;

export interface AggregationFailure {
  repository: string;
  message: string;
}

export interface Aggregation<T> {
  items: T[];
  failed: AggregationFailure[];
  /** Repositories actually queried. */
  answered: string[];
}

async function fanOut<T>(
  repositories: string[],
  limit: number,
  load: (owner: string, name: string) => Promise<T[]>,
): Promise<Aggregation<T>> {
  const results = await Promise.all(
    repositories.map(async (fullName) => {
      const [owner, name] = fullName.split('/');
      if (!owner || !name) {
        return { repository: fullName, items: [] as T[], error: 'Tên repository không hợp lệ' };
      }
      try {
        const items = await load(owner, name);
        return { repository: fullName, items: items.slice(0, limit), error: null };
      } catch (err) {
        return { repository: fullName, items: [] as T[], error: describeError(err).message };
      }
    }),
  );

  const items: T[] = [];
  const failed: AggregationFailure[] = [];
  const answered: string[] = [];
  for (const result of results) {
    if (result.error) {
      failed.push({ repository: result.repository, message: result.error });
    } else {
      answered.push(result.repository);
      items.push(...result.items);
    }
  }
  return { items, failed, answered };
}

export async function fetchRecentRuns(
  repositories: Array<{ fullName: string }>,
  perRepo = 8,
): Promise<RecentRun[]> {
  const { items } = await fanOut<RecentRun>(
    repositories.map((repo) => repo.fullName),
    perRepo,
    async (owner, name) => (await fetchWorkflowRuns(owner, name, 1, perRepo)).runs,
  );
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function fetchRecentReleases(repositories: string[], perRepo = 5): Promise<RecentRelease[]> {
  const { items } = await fanOut<RecentRelease>(
    repositories,
    perRepo,
    async (owner, name) => (await fetchReleases(owner, name, 1, perRepo)).releases,
  );
  return items.sort((a, b) => {
    const left = a.publishedAt ?? a.createdAt;
    const right = b.publishedAt ?? b.createdAt;
    return left < right ? 1 : -1;
  });
}

export async function fetchRecentCommits(repositories: string[], perRepo = 6): Promise<Aggregation<CommitSummary>> {
  return fanOut<CommitSummary>(
    repositories,
    perRepo,
    async (owner, name) => (await fetchCommits(owner, name, 1, perRepo)).commits,
  );
}
