// GitHub client. Server-side only — the token never reaches the browser.
//
// Uses GraphQL for the overview so that a cross-repository summary costs one
// request instead of one per repository, which matters against rate limits.

const REST_BASE = 'https://api.github.com';
const GRAPHQL_URL = 'https://api.github.com/graphql';

export class GitHubError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

export function githubConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN);
}

function token(): string {
  const value = process.env.GITHUB_TOKEN;
  if (!value) {
    throw new GitHubError(
      'GITHUB_TOKEN chưa được cấu hình trên máy chủ. Xem .env.example để biết cách đặt biến môi trường.',
      503,
    );
  }
  return value;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'github-project-control-center',
  };
}

export async function githubRest<T>(path: string): Promise<T> {
  const response = await fetch(`${REST_BASE}${path}`, {
    headers: headers(),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new GitHubError(`GitHub REST ${path} trả về ${response.status}`, response.status);
  }
  return (await response.json()) as T;
}

export async function githubGraphQL<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new GitHubError(`GitHub GraphQL trả về ${response.status}`, response.status);
  }

  const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (payload.errors?.length) {
    throw new GitHubError(`GitHub GraphQL: ${payload.errors.map((e) => e.message).join('; ')}`, 502);
  }
  if (!payload.data) throw new GitHubError('GitHub GraphQL trả về dữ liệu rỗng', 502);
  return payload.data;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface CommitSummary {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface RepoSummary {
  nameWithOwner: string;
  description: string | null;
  isPrivate: boolean;
  pushedAt: string | null;
  defaultBranch: string | null;
  openIssues: number;
  openPulls: number;
  releases: number;
  latestRelease: { name: string; publishedAt: string | null } | null;
  recentCommits: CommitSummary[];
  url: string;
}

export interface PullSummary {
  number: number;
  title: string;
  url: string;
  repository: string;
  isDraft: boolean;
  reviewDecision: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface Overview {
  viewer: { login: string; name: string | null; avatarUrl: string };
  repoTotal: number;
  repos: RepoSummary[];
  openPulls: PullSummary[];
  totals: { openIssues: number; openPulls: number; privateRepos: number };
  fetchedAt: string;
}

const OVERVIEW_QUERY = `
query Overview($repoCount: Int!, $pullCount: Int!) {
  viewer {
    login
    name
    avatarUrl
    repositories(first: $repoCount, affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER],
                 orderBy: {field: PUSHED_AT, direction: DESC}) {
      totalCount
      nodes {
        nameWithOwner
        description
        isPrivate
        pushedAt
        url
        defaultBranchRef { name }
        issues(states: OPEN) { totalCount }
        pullRequests(states: OPEN) { totalCount }
        releases(first: 1, orderBy: {field: CREATED_AT, direction: DESC}) {
          totalCount
          nodes { name publishedAt }
        }
        defaultBranchRef {
          name
          target {
            ... on Commit {
              history(first: 3) {
                nodes { oid messageHeadline committedDate author { name } }
              }
            }
          }
        }
      }
    }
    pullRequests(states: OPEN, first: $pullCount, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        url
        isDraft
        reviewDecision
        updatedAt
        createdAt
        repository { nameWithOwner }
      }
    }
  }
}`;

interface RawOverview {
  viewer: {
    login: string;
    name: string | null;
    avatarUrl: string;
    repositories: {
      totalCount: number;
      nodes: Array<{
        nameWithOwner: string;
        description: string | null;
        isPrivate: boolean;
        pushedAt: string | null;
        url: string;
        defaultBranchRef: {
          name: string;
          target?: { history?: { nodes: Array<{ oid: string; messageHeadline: string; committedDate: string; author: { name: string } | null }> } };
        } | null;
        issues: { totalCount: number };
        pullRequests: { totalCount: number };
        releases: { totalCount: number; nodes: Array<{ name: string; publishedAt: string | null }> };
      }>;
    };
    pullRequests: {
      nodes: Array<{
        number: number;
        title: string;
        url: string;
        isDraft: boolean;
        reviewDecision: string | null;
        updatedAt: string;
        createdAt: string;
        repository: { nameWithOwner: string };
      }>;
    };
  };
}

export async function fetchOverview(repoCount = 15, pullCount = 15): Promise<Overview> {
  const data = await githubGraphQL<RawOverview>(OVERVIEW_QUERY, { repoCount, pullCount });
  const { viewer } = data;

  const repos: RepoSummary[] = viewer.repositories.nodes.map((node) => ({
    nameWithOwner: node.nameWithOwner,
    description: node.description,
    isPrivate: node.isPrivate,
    pushedAt: node.pushedAt,
    defaultBranch: node.defaultBranchRef?.name ?? null,
    openIssues: node.issues.totalCount,
    openPulls: node.pullRequests.totalCount,
    releases: node.releases.totalCount,
    latestRelease: node.releases.nodes[0]
      ? { name: node.releases.nodes[0].name, publishedAt: node.releases.nodes[0].publishedAt }
      : null,
    recentCommits: (node.defaultBranchRef?.target?.history?.nodes ?? []).map((commit) => ({
      sha: commit.oid.slice(0, 7),
      message: commit.messageHeadline,
      author: commit.author?.name ?? 'không rõ',
      date: commit.committedDate,
    })),
    url: node.url,
  }));

  const pullRequests: PullSummary[] = viewer.pullRequests.nodes.map((pull) => ({
    number: pull.number,
    title: pull.title,
    url: pull.url,
    repository: pull.repository.nameWithOwner,
    isDraft: pull.isDraft,
    reviewDecision: pull.reviewDecision,
    updatedAt: pull.updatedAt,
    createdAt: pull.createdAt,
  }));

  return {
    viewer: { login: viewer.login, name: viewer.name, avatarUrl: viewer.avatarUrl },
    repoTotal: viewer.repositories.totalCount,
    repos,
    openPulls: pullRequests,
    totals: {
      openIssues: repos.reduce((sum, repo) => sum + repo.openIssues, 0),
      openPulls: repos.reduce((sum, repo) => sum + repo.openPulls, 0),
      privateRepos: repos.filter((repo) => repo.isPrivate).length,
    },
    fetchedAt: new Date().toISOString(),
  };
}

/** Rate-limit state, shown on the health page so limits are never a surprise. */
export async function fetchRateLimit(): Promise<{ limit: number; remaining: number; resetAt: string } | null> {
  try {
    const data = await githubRest<{ resources: { core: { limit: number; remaining: number; reset: number } } }>(
      '/rate_limit',
    );
    return {
      limit: data.resources.core.limit,
      remaining: data.resources.core.remaining,
      resetAt: new Date(data.resources.core.reset * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}
