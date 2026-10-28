// Export tests. Two properties matter beyond "it produces a file":
//   1. no credential can reach a downloadable file, and
//   2. CSV cells from GitHub cannot execute as spreadsheet formulas.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildExport, isExportKind } from '@/lib/exports';
import { toCsv } from '@/lib/csv';

const TOKEN = 'ghp_' + 'C'.repeat(36);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
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

const repoPage = [
  {
    id: 1,
    full_name: 'o/r',
    name: 'r',
    owner: { login: 'o' },
    private: true,
    archived: false,
    description: 'mô tả',
    language: 'TypeScript',
    stargazers_count: 2,
    forks_count: 1,
    open_issues_count: 4,
    default_branch: 'main',
    pushed_at: '2026-01-01T00:00:00Z',
    html_url: 'https://github.com/o/r',
  },
];

describe('chọn loại xuất', () => {
  it('chỉ chấp nhận loại đã biết', () => {
    expect(isExportKind('repos')).toBe(true);
    expect(isExportKind('search')).toBe(true);
    expect(isExportKind('secrets')).toBe(false);
    expect(isExportKind('../etc/passwd')).toBe(false);
  });
});

describe('xuất repository', () => {
  it('chỉ chứa các trường trong danh sách cho phép', async () => {
    fetchMock.mockResolvedValue(json(repoPage));
    const dataset = await buildExport('repos', {});

    expect(dataset.columns).not.toContain('token');
    for (const row of dataset.rows) {
      for (const key of Object.keys(row)) {
        expect(dataset.columns).toContain(key);
      }
    }
    expect(dataset.rows[0]).toMatchObject({ fullName: 'o/r', isPrivate: true, language: 'TypeScript' });
  });

  it('không chứa token dù payload có thêm trường lạ', async () => {
    fetchMock.mockResolvedValue(
      json([{ ...repoPage[0], token: TOKEN, nested_secret: { value: TOKEN } }]),
    );
    const dataset = await buildExport('repos', {});
    const serialised = JSON.stringify(dataset.rows);
    expect(serialised).not.toContain(TOKEN);
    expect(serialised).not.toContain('nested_secret');
  });

  it('ghi chú khi danh sách bị cắt theo số trang', async () => {
    // Five pages of 100 repositories, each announcing a following page: the
    // reader stops at maxPages and must report that the list is incomplete.
    let page = 1;
    fetchMock.mockImplementation(async () => {
      const current = page;
      page += 1;
      return new Response(
        JSON.stringify(
          Array.from({ length: 100 }, (_, index) => ({ ...repoPage[0], id: current * 1000 + index, full_name: `o/r${index}` })),
        ),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            link: '<https://api.github.com/user/repos?page=99>; rel="next"',
          },
        },
      );
    });
    const dataset = await buildExport('repos', {});
    expect(dataset.rows).toHaveLength(500);
    expect(dataset.incomplete.join(' ')).toContain('giới hạn');
  });
});

describe('xuất issue', () => {
  it('chặn công thức trong tiêu đề issue', async () => {
    fetchMock.mockResolvedValueOnce(json({ login: 'octocat', name: 'Octo', avatar_url: '' }));
    fetchMock.mockResolvedValue(
      json({
        total_count: 1,
        incomplete_results: false,
        items: [
          {
            id: 1,
            number: 1,
            title: '=cmd|calc!A1',
            state: 'open',
            html_url: 'https://github.com/o/r/issues/1',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            comments: 0,
            user: { login: '=evil' },
            labels: [],
            repository_url: 'https://api.github.com/repos/o/r',
          },
        ],
      }),
    );

    const dataset = await buildExport('issues', { state: 'open' });
    const csv = toCsv(
      dataset.columns,
      dataset.rows.map((row) => dataset.columns.map((column) => row[column])),
    );

    expect(csv).toContain("'=cmd|calc!A1");
    expect(csv).toContain("'=evil");
    // The raw, executable form must not appear at the start of a cell.
    expect(csv).not.toMatch(/(^|[,\r\n])=cmd/m);
  });

  it('từ chối state lạ và quay về mặc định an toàn', async () => {
    fetchMock.mockResolvedValueOnce(json({ login: 'octocat', name: 'Octo', avatar_url: '' }));
    fetchMock.mockResolvedValue(json({ total_count: 0, incomplete_results: false, items: [] }));
    const dataset = await buildExport('issues', { state: 'anything' });
    expect(dataset.filters.state).toBe('open');
  });

  it('không gửi repository không hợp lệ vào truy vấn tìm kiếm', async () => {
    fetchMock.mockResolvedValueOnce(json({ login: 'octocat', name: 'Octo', avatar_url: '' }));
    fetchMock.mockResolvedValue(json({ total_count: 0, incomplete_results: false, items: [] }));
    await buildExport('issues', { repo: '../../etc' });
    const searchCall = (fetchMock.mock.calls as Array<[string]>).find((call) =>
      String(call[0]).includes('/search/issues'),
    );
    expect(searchCall).toBeDefined();
    // The invalid repo is dropped and the scope falls back to the viewer.
    const url = decodeURIComponent(String(searchCall?.[0]));
    expect(url).not.toContain('../../etc');
    expect(url).toContain('involves:octocat');
  });
});

describe('xuất tìm kiếm', () => {
  it('giữ URL từ payload và không dựng URL thủ công', async () => {
    fetchMock.mockResolvedValue(
      json({
        total_count: 1,
        incomplete_results: false,
        items: [
          {
            id: 5,
            number: 5,
            title: 'kết quả',
            state: 'open',
            html_url: 'https://github.com/o/r/issues/5',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            comments: 0,
            user: { login: 'a' },
            labels: [],
            repository_url: 'https://api.github.com/repos/o/r',
          },
        ],
      }),
    );

    const dataset = await buildExport('search', { q: 'kết quả', kind: 'issues' });
    expect(dataset.rows[0].htmlUrl).toBe('https://github.com/o/r/issues/5');
    expect(dataset.rows[0].kind).toBe('issue');
  });

  it('cảnh báo khi chỉ xuất trang đầu', async () => {
    fetchMock.mockResolvedValue(json({ total_count: 0, incomplete_results: false, items: [] }));
    const dataset = await buildExport('search', { q: 'x', kind: 'issues' });
    expect(dataset.incomplete.join(' ')).toContain('trang đầu');
  });
});
