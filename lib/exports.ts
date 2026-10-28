// Export builders.
//
// Each builder returns a column whitelist plus already-projected rows, so the
// route never serialises a raw upstream payload. Anything not named in
// `columns` cannot reach a downloadable file.

import {
  fetchViewer,
  fetchIssues,
  fetchPullRequests,
  fetchRecentReleases,
  fetchRecentRuns,
  fetchRepositories,
  searchAll,
} from './queries';
import { pick, type CsvValue } from './csv';
import { isValidSegment } from './queries';

/** Accepts only a well-formed `owner/name`; anything else is treated as absent. */
function safeRepository(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const [owner, name] = value.split('/');
  return isValidSegment(owner) && isValidSegment(name) ? `${owner}/${name}` : undefined;
}

export interface ExportDataset {
  kind: string;
  columns: string[];
  rows: Record<string, CsvValue>[];
  incomplete: string[];
  filters: Record<string, string>;
}

export type ExportKind = 'repos' | 'issues' | 'pulls' | 'actions' | 'releases' | 'search';

export const EXPORT_KINDS: ExportKind[] = ['repos', 'issues', 'pulls', 'actions', 'releases', 'search'];

export function isExportKind(value: string): value is ExportKind {
  return (EXPORT_KINDS as string[]).includes(value);
}

function project(columns: string[], rows: Record<string, unknown>[]): Record<string, CsvValue>[] {
  return rows.map((row) => pick(row, columns) as Record<string, CsvValue>);
}

export async function buildExport(
  kind: ExportKind,
  params: Record<string, string>,
): Promise<ExportDataset> {
  switch (kind) {
    case 'repos': {
      const { repos, pageInfo } = await fetchRepositories(5);
      const columns = ['fullName', 'isPrivate', 'language', 'openIssues', 'stars', 'forks', 'defaultBranch', 'pushedAt', 'htmlUrl'];
      return {
        kind: 'repos',
        columns,
        rows: project(columns, repos as unknown as Record<string, unknown>[]),
        incomplete: pageInfo.truncated ? ['Danh sách repository bị giới hạn theo số trang đã tải.'] : [],
        filters: {},
      };
    }

    case 'issues': {
      const state = params.state === 'closed' || params.state === 'all' ? params.state : 'open';
      const repository = safeRepository(params.repo);
      // Same scoping rule as the screen: no repository means "related to the
      // viewer", never the whole of GitHub.
      const involves = repository ? undefined : (await fetchViewer()).login;
      const result = await fetchIssues({ state, page: 1, perPage: 100, repository, involves });
      const columns = ['number', 'title', 'repository', 'state', 'author', 'comments', 'updatedAt', 'htmlUrl'];
      return {
        kind: 'issues',
        columns,
        rows: project(columns, result.items as unknown as Record<string, unknown>[]),
        incomplete: [
          ...(result.pageInfo.truncated ? ['Chỉ xuất trang đầu tiên (tối đa 100 issue).'] : []),
          ...(result.totalCount > 1000 ? ['GitHub Search giới hạn 1000 kết quả.'] : []),
        ],
        filters: { state, repo: params.repo ?? '' },
      };
    }

    case 'pulls': {
      const state = params.state === 'closed' || params.state === 'all' ? params.state : 'open';
      const repository = safeRepository(params.repo);
      const involves = repository ? undefined : (await fetchViewer()).login;
      const result = await fetchPullRequests({ state, page: 1, perPage: 100, repository, involves });
      const columns = ['number', 'title', 'repository', 'state', 'draft', 'author', 'comments', 'updatedAt', 'htmlUrl'];
      return {
        kind: 'pulls',
        columns,
        rows: project(columns, result.items as unknown as Record<string, unknown>[]),
        incomplete: result.pageInfo.truncated ? ['Chỉ xuất trang đầu tiên (tối đa 100 pull request).'] : [],
        filters: { state, repo: params.repo ?? '' },
      };
    }

    case 'actions': {
      const repos = (await fetchRepositories(3)).repos.slice(0, 8);
      const runs = await fetchRecentRuns(repos, 20);
      const columns = ['repository', 'name', 'displayTitle', 'status', 'conclusion', 'event', 'headBranch', 'createdAt', 'htmlUrl'];
      return {
        kind: 'actions',
        columns,
        rows: project(columns, runs as unknown as Record<string, unknown>[]),
        incomplete: ['Chỉ gồm các repository đang hoạt động tích cực nhất, tối đa 20 run mỗi repo.'],
        filters: {},
      };
    }

    case 'releases': {
      const repos = (await fetchRepositories(3)).repos.slice(0, 8).map((repo) => repo.fullName);
      const releases = await fetchRecentReleases(repos, 20);
      const columns = ['repository', 'tagName', 'name', 'isDraft', 'isPrerelease', 'publishedAt', 'author', 'htmlUrl'];
      return {
        kind: 'releases',
        columns,
        rows: project(columns, releases as unknown as Record<string, unknown>[]),
        incomplete: ['Chỉ gồm các repository đang hoạt động tích cực nhất, tối đa 20 release mỗi repo.'],
        filters: {},
      };
    }

    case 'search': {
      const term = (params.q ?? '').slice(0, 200);
      const scope = params.kind === 'issues' || params.kind === 'pulls' || params.kind === 'repos' ? params.kind : 'all';
      const result = await searchAll(term, scope, 1);
      const columns = ['kind', 'title', 'subtitle', 'extra', 'updatedAt', 'htmlUrl'];
      return {
        kind: 'search',
        columns,
        rows: project(columns, result.results as unknown as Record<string, unknown>[]),
        incomplete: ['Chỉ xuất trang đầu tiên (tối đa 40 kết quả).', ...result.notes],
        filters: { q: term, kind: scope },
      };
    }

    default: {
      const exhaustive: never = kind;
      throw new Error(`Loại xuất không hỗ trợ: ${String(exhaustive)}`);
    }
  }
}
