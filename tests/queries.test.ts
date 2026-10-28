// Mapping tests: GitHub's snake_case payload must become the typed shapes the
// screens consume, and every URL must come from the payload rather than being
// assembled from a template.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  githubWebUrl,
  fetchCommits,
  fetchIssue,
  fetchIssues,
  fetchNotifications,
  fetchOverview,
  fetchPull,
  fetchRepository,
  fetchWorkflowRuns,
  isValidSegment,
  searchAll,
} from '@/lib/queries';

const TOKEN = 'ghp_' + 'B'.repeat(36);

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.GITHUB_TOKEN = TOKEN;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.GITHUB_TOKEN;
});

describe('kiểm tra đoạn đường dẫn', () => {
  it('chấp nhận owner/repo hợp lệ và từ chối chuỗi có thể chèn đường dẫn', () => {
    expect(isValidSegment('coderunknow')).toBe(true);
    expect(isValidSegment('repo.name')).toBe(true);
    expect(isValidSegment('../etc')).toBe(false);
    expect(isValidSegment('a/b')).toBe(false);
    expect(isValidSegment('a b')).toBe(false);
    expect(isValidSegment('')).toBe(false);
    expect(isValidSegment(null)).toBe(false);
  });

  it('từ chối owner không hợp lệ trước khi gọi mạng', async () => {
    await expect(fetchRepository('../evil', 'repo')).rejects.toThrow(/Owner không hợp lệ/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('URL web từ payload GraphQL', () => {
  it('dựng URL web từ resourcePath thay vì dùng URL API', () => {
    expect(githubWebUrl('/o/r/pull/42', 'https://api.github.com/repos/o/r/pulls/42')).toBe(
      'https://github.com/o/r/pull/42',
    );
  });

  it('từ chối resourcePath đáng ngờ và quay về URL gốc', () => {
    expect(githubWebUrl('/../../evil', 'https://api.github.com/x')).toBe('https://api.github.com/x');
    expect(githubWebUrl('/o', 'https://api.github.com/x')).toBe('https://api.github.com/x');
    expect(githubWebUrl(null, 'https://api.github.com/x')).toBe('https://api.github.com/x');
  });
});

describe('phạm vi tìm kiếm', () => {
  it('từ chối truy vấn không có phạm vi thay vì đếm toàn bộ GitHub', async () => {
    await expect(fetchIssues({ state: 'open', page: 1, perPage: 25 })).rejects.toThrow(/phạm vi/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gắn involves:<login> khi không chọn repository', async () => {
    fetchMock.mockResolvedValue(json({ total_count: 0, incomplete_results: false, items: [] }));
    await fetchIssues({ state: 'open', page: 1, perPage: 25, involves: 'octocat' });
    const url = decodeURIComponent(String((fetchMock.mock.calls[0] as [string])[0]));
    expect(url).toContain('involves:octocat');
    expect(url).not.toContain('repo:');
  });

  it('dùng repo:<owner/name> khi đã chọn repository', async () => {
    fetchMock.mockResolvedValue(json({ total_count: 0, incomplete_results: false, items: [] }));
    await fetchIssues({ state: 'open', page: 1, perPage: 25, repository: 'o/r' });
    const url = decodeURIComponent(String((fetchMock.mock.calls[0] as [string])[0]));
    expect(url).toContain('repo:o/r');
    expect(url).not.toContain('involves:');
  });

  it('bỏ qua repository không hợp lệ và không rơi về truy vấn toàn cầu', async () => {
    await expect(
      fetchIssues({ state: 'open', page: 1, perPage: 25, repository: '../../etc' }),
    ).rejects.toThrow(/phạm vi/);
  });

  it('đếm chính xác theo từng repository bằng alias GraphQL', async () => {
    const { fetchRepositoryCounts } = await import('@/lib/queries');
    fetchMock.mockResolvedValue(
      json({
        data: {
          r0: { nameWithOwner: 'o/a', issues: { totalCount: 3 }, pullRequests: { totalCount: 1 } },
          r1: { nameWithOwner: 'o/b', issues: { totalCount: 0 }, pullRequests: { totalCount: 4 } },
        },
      }),
    );

    const counts = await fetchRepositoryCounts([
      { owner: 'o', name: 'a' },
      { owner: 'o', name: 'b' },
    ]);
    expect(counts).toEqual([
      { fullName: 'o/a', openIssues: 3, openPulls: 1 },
      { fullName: 'o/b', openIssues: 0, openPulls: 4 },
    ]);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as {
      query: string;
      variables: Record<string, string>;
    };
    expect(body.query).toContain('issues(states: OPEN)');
    expect(body.query).toContain('pullRequests(states: OPEN)');
    // Values travel as variables, never concatenated into the query text.
    expect(body.query).not.toContain('"o"');
    expect(body.variables).toEqual({ o0: 'o', n0: 'a', o1: 'o', n1: 'b' });
  });
});

describe('đếm theo repo — an toàn và không bỏ sót', () => {
  it('dùng biến GraphQL thay vì nội suy tên vào query', async () => {
    const { fetchRepositoryCounts } = await import('@/lib/queries');
    fetchMock.mockResolvedValue(json({ data: { r0: { nameWithOwner: 'o/r', issues: { totalCount: 1 }, pullRequests: { totalCount: 0 } } } }));
    await fetchRepositoryCounts([{ owner: 'o', name: 'r' }]);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as {
      query: string;
      variables: Record<string, string>;
    };
    expect(body.query).toContain('repository(owner: $o0, name: $n0)');
    expect(body.variables).toEqual({ o0: 'o', n0: 'r' });
  });

  it('không loại bỏ repo tên "-" (trước đây gây ra số liệu một phần)', async () => {
    const { fetchRepositoryCounts } = await import('@/lib/queries');
    fetchMock.mockResolvedValue(
      json({
        data: {
          r0: { nameWithOwner: 'o/-', issues: { totalCount: 0 }, pullRequests: { totalCount: 0 } },
          r1: { nameWithOwner: 'o/normal', issues: { totalCount: 2 }, pullRequests: { totalCount: 1 } },
        },
      }),
    );
    const counts = await fetchRepositoryCounts([
      { owner: 'o', name: '-' },
      { owner: 'o', name: 'normal' },
    ]);
    expect(counts).toHaveLength(2);
    expect(counts[0].fullName).toBe('o/-');
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as {
      variables: Record<string, string>;
    };
    expect(body.variables.n0).toBe('-');
  });
});

describe('ánh xạ repository', () => {
  it('giữ nguyên html_url do GitHub trả về', async () => {
    fetchMock.mockResolvedValue(
      json({
        id: 1,
        full_name: 'coderunknow/Testing',
        name: 'Testing',
        owner: { login: 'coderunknow' },
        private: false,
        archived: false,
        description: 'demo',
        language: 'TypeScript',
        stargazers_count: 3,
        forks_count: 1,
        open_issues_count: 7,
        default_branch: 'main',
        pushed_at: '2026-01-02T03:04:05Z',
        html_url: 'https://github.com/coderunknow/Testing',
      }),
    );

    const repo = await fetchRepository('coderunknow', 'Testing');
    expect(repo.fullName).toBe('coderunknow/Testing');
    expect(repo.htmlUrl).toBe('https://github.com/coderunknow/Testing');
    expect(repo.openIssues).toBe(7);
    expect(repo.owner).toBe('coderunknow');
    expect(repo.name).toBe('Testing');
  });
});

describe('ánh xạ issue', () => {
  it('tách pull request khỏi issue và giữ URL gốc từ payload', async () => {
    fetchMock.mockResolvedValue(
      json({
        total_count: 2,
        incomplete_results: false,
        items: [
          {
            id: 10,
            number: 5,
            title: 'Issue thật',
            state: 'open',
            html_url: 'https://github.com/o/r/issues/5',
            updated_at: '2026-02-01T00:00:00Z',
            created_at: '2026-01-01T00:00:00Z',
            comments: 2,
            user: { login: 'alice' },
            labels: [{ name: 'bug', color: 'ff0000' }],
            repository_url: 'https://api.github.com/repos/o/r',
            pull_request: undefined,
          },
          {
            id: 11,
            number: 6,
            title: 'PR lẫn trong search',
            state: 'open',
            html_url: 'https://github.com/o/r/pull/6',
            updated_at: '2026-02-02T00:00:00Z',
            created_at: '2026-01-02T00:00:00Z',
            comments: 0,
            user: { login: 'bob' },
            labels: [],
            repository_url: 'https://api.github.com/repos/o/r',
            pull_request: { url: 'https://api.github.com/repos/o/r/pulls/6' },
          },
        ],
      }),
    );

    const result = await fetchIssues({ state: 'open', involves: 'octocat' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('Issue thật');
    expect(result.items[0].repository).toBe('o/r');
    expect(result.items[0].htmlUrl).toBe('https://github.com/o/r/issues/5');
    expect(result.items[0].labels[0]).toEqual({ name: 'bug', color: 'ff0000' });
  });

  it('nêu rõ giới hạn 1000 kết quả của Search API', async () => {
    fetchMock.mockResolvedValue(json({ total_count: 5432, incomplete_results: true, items: [] }));
    const result = await fetchIssues({ state: 'open', involves: 'octocat' });
    expect(result.totalCount).toBe(5432);
    expect(result.incomplete).toBe(true);
    // The caller must be able to see the cap and the incompleteness flag.
    expect(result.pageInfo.truncated).toBe(true);
    expect(result.pageInfo.scope).toContain('1000');
    expect(result.pageInfo.scope).toContain('chưa đầy đủ');
  });
});

describe('ánh xạ pull request', () => {
  const pullGraphql = {
    data: {
      repository: {
        pullRequest: {
          number: 42,
          title: 'Thêm tính năng',
          state: 'OPEN',
          isDraft: false,
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'BLOCKED',
          additions: 12,
          deletions: 3,
          changedFiles: 2,
          reviewDecision: 'REVIEW_REQUIRED',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-05T00:00:00Z',
          mergedAt: null,
          url: 'https://api.github.com/repos/o/r/pulls/42',
          resourcePath: '/o/r/pull/42',
          body: 'mô tả',
          author: { login: 'alice' },
          headRefName: 'feature',
          baseRefName: 'main',
          reviewRequests: { nodes: [{ requestedReviewer: { login: 'bob' } }] },
          reviews: {
            nodes: [
              {
                id: 'R1',
                state: 'APPROVED',
                submittedAt: '2026-01-04T00:00:00Z',
                author: { login: 'bob' },
              },
            ],
          },
          files: { nodes: [{ path: 'src/a.ts', additions: 10, deletions: 1, changeType: 'MODIFIED' }] },
          commits: { nodes: [{ commit: { oid: 'abc1234', messageHeadline: 'x', committedDate: '2026-01-04T00:00:00Z', author: { name: 'alice' } } }] },
        },
      },
    },
  };

  it('giữ nguyên quyết định review do GitHub trả về, không tự suy ra', async () => {
    fetchMock
      .mockResolvedValueOnce(json(pullGraphql))
      // check-runs endpoint: the only extra request fetchPull makes
      .mockResolvedValueOnce(
        json({
          total_count: 1,
          check_runs: [
            {
              name: 'build',
              status: 'completed',
              conclusion: 'success',
              html_url: 'https://github.com/o/r/runs/1',
              details_url: 'https://github.com/o/r/runs/1',
            },
          ],
        }),
      );

    const { pull, checksNote, checksAvailable } = await fetchPull('o', 'r', 42);
    expect(pull.reviewDecision).toBe('REVIEW_REQUIRED');
    expect(pull.htmlUrl).toBe('https://github.com/o/r/pull/42');
    expect(pull.files).toHaveLength(1);
    expect(pull.files[0].path).toBe('src/a.ts');
    expect(pull.checks[0]).toMatchObject({ name: 'build', state: 'SUCCESS' });
    expect(checksAvailable).toBe(true);
    expect(checksNote).toBeNull();
  });

  it('không kết luận "sẵn sàng hợp nhất" khi chỉ có một check thành công', async () => {
    fetchMock
      .mockResolvedValueOnce(json(pullGraphql))
      .mockResolvedValueOnce(
        json({
          total_count: 1,
          check_runs: [{ name: 'build', status: 'completed', conclusion: 'success', html_url: null }],
        }),
      );

    const { pull } = await fetchPull('o', 'r', 42);
    // A green check must not be turned into a merge-readiness opinion here.
    expect(pull).not.toHaveProperty('readyToMerge');
    expect(pull).not.toHaveProperty('canMerge');
    expect(pull.checks).toHaveLength(1);
    expect(pull.reviewDecision).toBe('REVIEW_REQUIRED');
  });

  it('báo thiếu quyền Checks riêng thay vì im lặng coi là không có check', async () => {
    fetchMock
      .mockResolvedValueOnce(json(pullGraphql))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const { pull, checksNote, checksAvailable } = await fetchPull('o', 'r', 42);
    expect(pull.checks).toHaveLength(0);
    expect(checksAvailable).toBe(false);
    expect(checksNote).toContain('quyền');
  });
});

describe('chi tiết issue', () => {
  it('đánh dấu rõ khi bình luận bị cắt bớt', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          data: {
            repository: {
              issue: {
                number: 3,
                title: 'Lỗi đăng nhập',
                body: 'nội dung',
                state: 'OPEN',
                stateReason: null,
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-02T00:00:00Z',
                closedAt: null,
                url: 'https://api.github.com/repos/o/r/issues/3',
                resourcePath: '/o/r/issues/3',
                author: { login: 'alice' },
                milestone: null,
                assignees: { nodes: [] },
                labels: { nodes: [] },
                comments: { totalCount: 40, nodes: [{ id: 'C1', body: 'x', createdAt: '2026-01-02T00:00:00Z', author: { login: 'bob' }, url: 'https://github.com/o/r/issues/3#issuecomment-1' }] },
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(json([]));

    const issue = await fetchIssue('o', 'r', 3);
    expect(issue.commentsCount).toBe(40);
    expect(issue.comments).toHaveLength(1);
    expect(issue.htmlUrl).toBe('https://github.com/o/r/issues/3');
  });
});

describe('phân loại check-run', () => {
  it('chấp nhận cả chữ thường của REST và chữ hoa của GraphQL', async () => {
    const { toCheckState } = await import('@/lib/queries');
    expect(toCheckState('completed', 'success')).toBe('SUCCESS');
    expect(toCheckState('COMPLETED', 'SUCCESS')).toBe('SUCCESS');
    expect(toCheckState('completed', 'failure')).toBe('FAILURE');
    expect(toCheckState('in_progress', null)).toBe('PENDING');
    expect(toCheckState('queued', null)).toBe('PENDING');
    expect(toCheckState('completed', 'cancelled')).toBe('SKIPPED');
    expect(toCheckState('completed', null)).toBe('UNKNOWN');
  });
});

describe('workflow run và commit', () => {
  it('giữ html_url của từng run', async () => {
    fetchMock.mockResolvedValue(
      json({
        total_count: 1,
        workflow_runs: [
          {
            id: 9,
            name: 'CI',
            display_title: 'ci run',
            status: 'completed',
            conclusion: 'failure',
            event: 'push',
            head_branch: 'main',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:05:00Z',
            run_started_at: '2026-01-01T00:01:00Z',
            html_url: 'https://github.com/o/r/actions/runs/9',
            actor: { login: 'alice' },
          },
        ],
      }),
    );

    const result = await fetchWorkflowRuns('o', 'r');
    expect(result.runs[0].htmlUrl).toBe('https://github.com/o/r/actions/runs/9');
    expect(result.runs[0].conclusion).toBe('failure');
    expect(result.totalCount).toBe(1);
  });

  it('lấy dòng đầu tiên của commit message nhiều dòng', async () => {
    fetchMock.mockResolvedValue(
      json([
        {
          sha: 'abcdef1234567890',
          html_url: 'https://github.com/o/r/commit/abcdef1234567890',
          commit: {
            message: 'tiêu đề\n\nthân bài dài',
            author: { name: 'Alice', date: '2026-01-01T00:00:00Z' },
          },
        },
      ]),
    );

    const result = await fetchCommits('o', 'r');
    expect(result.commits[0].message).toBe('tiêu đề');
    expect(result.commits[0].shortSha).toBe('abcdef1');
    expect(result.commits[0].htmlUrl).toContain('/commit/abcdef1234567890');
  });
});

describe('thông báo', () => {
  it('phân biệt thiếu quyền với danh sách rỗng', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Resource not accessible by personal access token' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await fetchNotifications();
    expect(result.permissionLimited).toBe(true);
    expect(result.items).toEqual([]);
    // A UI that only checked items.length would show "no notifications" — wrong.
    expect(result.scope).toContain('Không đọc được');
  });

  it('trả danh sách rỗng khi GitHub thật sự không có thông báo', async () => {
    fetchMock.mockResolvedValue(json([]));
    const result = await fetchNotifications();
    expect(result.permissionLimited).toBe(false);
    expect(result.items).toEqual([]);
  });
});

describe('tìm kiếm', () => {
  it('ghi chú khi GitHub báo kết quả chưa đầy đủ', async () => {
    fetchMock.mockResolvedValue(
      json({ total_count: 2, incomplete_results: true, items: [] }),
    );

    const result = await searchAll('test', 'issues');
    expect(result.notes.some((note) => note.includes('chưa đầy đủ'))).toBe(true);
  });

  it('luôn gắn is:issue / is:pr vì GitHub từ chối truy vấn không có chúng', async () => {
    // A fresh Response per request: a shared body can only be read once.
    fetchMock.mockImplementation(async () =>
      json({ total_count: 0, incomplete_results: false, items: [] }),
    );
    await searchAll('arena', 'all');
    const queries = (fetchMock.mock.calls as Array<[string]>).map((call) =>
      decodeURIComponent(String(call[0])),
    );
    expect(queries.some((url) => url.includes('is%3Aissue') || url.includes('is:issue'))).toBe(true);
    expect(queries.some((url) => url.includes('is%3Apr') || url.includes('is:pr'))).toBe(true);
    // No request may go out without a type qualifier.
    for (const url of queries) {
      if (url.includes('/search/issues')) {
        expect(url).toMatch(/is(:|%3A)(issue|pr)/);
      }
    }
  });

  it('không gọi mạng khi từ khoá rỗng', async () => {
    const result = await searchAll('   ', 'all');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.results).toEqual([]);
  });
});

describe('tổng quan', () => {
  it('nêu rõ phạm vi trang và thời điểm lấy dữ liệu', async () => {
    fetchMock
      // viewer
      .mockResolvedValueOnce(json({ login: 'octocat', name: 'Octo', avatar_url: 'https://x/y.png' }))
      // repositories (1 page)
      .mockResolvedValueOnce(
        json([
          {
            id: 1,
            full_name: 'o/r',
            name: 'r',
            owner: { login: 'o' },
            private: false,
            archived: false,
            description: null,
            language: null,
            stargazers_count: 0,
            forks_count: 0,
            open_issues_count: 2,
            default_branch: 'main',
            pushed_at: '2026-01-01T00:00:00Z',
            html_url: 'https://github.com/o/r',
          },
        ]),
      )
      // aliased GraphQL counters (exact, per repository)
      .mockResolvedValueOnce(
        json({
          data: {
            r0: {
              nameWithOwner: 'o/r',
              issues: { totalCount: 2 },
              pullRequests: { totalCount: 1 },
            },
          },
        }),
      )
      // pulls search, scoped to the viewer
      .mockResolvedValueOnce(json({ total_count: 0, incomplete_results: false, items: [] }))
      // recent commits for pushed repo
      .mockResolvedValueOnce(json([]))
      // releases
      .mockResolvedValueOnce(json([]));

    const overview = await fetchOverview();
    expect(overview.reposLoaded).toBe(1);
    expect(overview.openIssues).toBe(2);
    expect(overview.openIssuesSource).toBe('graphql');
    expect(overview.countsPartial).toBe(false);
    expect(overview.scopeNote).toContain('repo');

    // The pulls search must be scoped, never GitHub-wide.
    const pullCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes('/search/issues'),
    ) as [string, RequestInit] | undefined;
    expect(pullCall).toBeDefined();
    expect(decodeURIComponent(String(pullCall?.[0]))).toContain('involves:octocat');
    expect(new Date(overview.fetchedAt).toString()).not.toBe('Invalid Date');
  });
});
