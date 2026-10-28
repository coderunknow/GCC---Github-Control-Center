import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GitHubError,
  describeError,
  fetchRateLimit,
  githubConfigured,
  graphql,
  rest,
  restPaginated,
  scrubSecrets,
} from '@/lib/github';

const TOKEN = 'ghp_' + 'A'.repeat(36);

function respond(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

function errorResponse(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
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

describe('cấu hình token', () => {
  it('báo chưa cấu hình khi thiếu GITHUB_TOKEN', async () => {
    delete process.env.GITHUB_TOKEN;
    expect(githubConfigured()).toBe(false);
    await expect(rest('/user')).rejects.toMatchObject({ kind: 'unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gửi token trong header Authorization chứ không phải query string', async () => {
    fetchMock.mockResolvedValue(respond('{"login":"octocat"}'));
    await rest('/user');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(TOKEN);
    expect(url).not.toContain('access_token');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });
});

describe('phân loại lỗi', () => {
  const cases: Array<[number, Record<string, string>, string]> = [
    [401, {}, 'auth'],
    [403, {}, 'permission'],
    [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' }, 'rate_limit'],
    [404, {}, 'not_found'],
    [429, {}, 'rate_limit'],
    [500, {}, 'server'],
    [502, {}, 'server'],
  ];

  for (const [status, headers, kind] of cases) {
    it(`ánh xạ ${status}${headers['x-ratelimit-remaining'] ? ' (hết hạn mức)' : ''} → ${kind}`, async () => {
      fetchMock.mockResolvedValue(errorResponse(status, 'upstream said no', headers));
      const error = await rest('/repos/o/r').catch((err: unknown) => err);
      expect(error).toBeInstanceOf(GitHubError);
      expect((error as GitHubError).kind).toBe(kind);
      expect((error as GitHubError).status).toBe(status);
    });
  }

  it('gắn thời điểm đặt lại hạn mức khi bị rate limit', async () => {
    fetchMock.mockResolvedValue(
      errorResponse(403, 'API rate limit exceeded', {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1700000000',
      }),
    );
    const error = (await rest('/user').catch((err: unknown) => err)) as GitHubError;
    expect(error.kind).toBe('rate_limit');
    expect(error.resetAt).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it('ánh xạ lỗi mạng thành network, không lộ chi tiết nội bộ', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const error = (await rest('/user').catch((err: unknown) => err)) as GitHubError;
    expect(error.kind).toBe('network');
    expect(error.message).not.toContain('fetch failed');
  });

  it('ánh xạ timeout thành timeout', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'TimeoutError';
    fetchMock.mockRejectedValue(abort);
    const error = (await rest('/user').catch((err: unknown) => err)) as GitHubError;
    expect(error.kind).toBe('timeout');
  });

  it('describeError không ném lỗi với giá trị lạ', () => {
    expect(describeError('boom')).toEqual({ kind: 'unknown', message: expect.stringContaining('không xác định') });
    expect(describeError(new GitHubError('auth', 'x')).kind).toBe('auth');
  });
});

describe('không rò rỉ bí mật', () => {
  it('che token nếu GitHub phản chiếu nó trong thông báo lỗi', async () => {
    fetchMock.mockResolvedValue(errorResponse(403, `Bad credentials for token ${TOKEN}`));
    const error = (await rest('/user').catch((err: unknown) => err)) as GitHubError;
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).toContain('[REDACTED]');
  });

  it('che các mẫu token phổ biến trong chuỗi bất kỳ', () => {
    expect(scrubSecrets('ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toBe('[REDACTED]');
    expect(scrubSecrets('github_pat_11ABCDEFG0123456789_abcdefghijklmnop')).toBe('[REDACTED]');
    expect(scrubSecrets('Authorization: Bearer sometokenvalue')).toBe('Authorization: Bearer [REDACTED]');
    expect(scrubSecrets('không có bí mật nào')).toBe('không có bí mật nào');
  });

  it('ánh xạ "Could not resolve to" thành not_found', async () => {
    fetchMock.mockResolvedValue(
      respond(
        JSON.stringify({
          errors: [{ message: 'Could not resolve to a PullRequest with the number of 99999.' }],
        }),
      ),
    );
    const error = (await graphql('{ x }').catch((err: unknown) => err)) as GitHubError;
    expect(error.kind).toBe('not_found');
  });

  it('che token trong lỗi GraphQL', async () => {
    fetchMock.mockResolvedValue(
      respond(JSON.stringify({ errors: [{ message: `token ${TOKEN} không hợp lệ` }] })),
    );
    const error = (await graphql('{ viewer { login } }').catch((err: unknown) => err)) as GitHubError;
    expect(error.kind).toBe('graphql');
    expect(error.message).not.toContain(TOKEN);
  });
});

describe('phân trang', () => {
  it('đi theo header Link rel=next', async () => {
    fetchMock
      .mockResolvedValueOnce(
        respond('[{"id":1}]', {
          headers: {
            'content-type': 'application/json',
            link: '<https://api.github.com/repos/o/r/issues?per_page=1&page=2>; rel="next"',
          },
        }),
      )
      .mockResolvedValueOnce(respond('[{"id":2}]'));

    const result = await restPaginated<{ id: number }>('/repos/o/r/issues', { perPage: 1, maxPages: 5 });
    expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.pagesFetched).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('báo truncated khi còn trang nhưng đã chạm maxPages', async () => {
    // A fresh Response per call: a shared one would have its body consumed.
    fetchMock.mockImplementation(async () =>
      respond('[{"id":1}]', {
        headers: {
          'content-type': 'application/json',
          link: '<https://api.github.com/x?page=2>; rel="next"',
        },
      }),
    );

    const result = await restPaginated<{ id: number }>('/x', { perPage: 1, maxPages: 3 });
    expect(result.pagesFetched).toBe(3);
    expect(result.truncated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('không tự cộng dồn khi GitHub ném lỗi giữa đường', async () => {
    fetchMock
      .mockResolvedValueOnce(
        respond('[{"id":1}]', {
          headers: {
            'content-type': 'application/json',
            link: '<https://api.github.com/x?page=2>; rel="next"',
          },
        }),
      )
      .mockResolvedValueOnce(errorResponse(500, 'boom'));

    await expect(restPaginated('/x')).rejects.toMatchObject({ kind: 'server' });
  });
});

describe('han muc', () => {
  it('đọc cả core và graphql và chọn bể cạn trước', async () => {
    fetchMock.mockResolvedValue(
      respond(
        JSON.stringify({
          resources: {
            core: { limit: 5000, remaining: 4800, used: 200, reset: 1700000000 },
            graphql: { limit: 5000, remaining: 120, used: 4880, reset: 1700000000 },
            search: { limit: 30, remaining: 30, used: 0, reset: 1700000000 },
          },
        }),
      ),
    );

    const state = await fetchRateLimit();
    expect(state).not.toBeNull();
    expect(state?.core.remaining).toBe(4800);
    expect(state?.graphql?.remaining).toBe(120);
    expect(state?.search?.limit).toBe(30);
    // The binding bucket is GraphQL, so the headline number is the smaller one.
    expect(state?.remaining).toBe(120);
  });

  it('trả null thay vì bịa số khi không đọc được', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    expect(await fetchRateLimit()).toBeNull();
  });
});
