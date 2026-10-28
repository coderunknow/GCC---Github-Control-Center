// GitHub API access. SERVER-ONLY: the token must never reach the browser.
//
// Errors are classified rather than collapsed into one opaque failure, because
// the UI has to distinguish "you lack permission" from "you are rate limited"
// from "no such repository" — each needs a different message and remedy.

const REST_BASE = 'https://api.github.com';
const GRAPHQL_URL = 'https://api.github.com/graphql';
const DEFAULT_TIMEOUT_MS = 12_000;
const USER_AGENT = 'github-project-control-center';

export type GitHubErrorKind =
  | 'unconfigured'
  | 'auth'
  | 'permission'
  | 'rate_limit'
  | 'not_found'
  | 'network'
  | 'timeout'
  | 'server'
  | 'graphql';

export class GitHubError extends Error {
  readonly kind: GitHubErrorKind;
  readonly status: number;
  /** When the rate limit resets, if the failure was a rate limit. */
  readonly resetAt: string | null;
  /** Documentation URL GitHub supplied, shown instead of guessing a remedy. */
  readonly docsUrl: string | null;

  constructor(
    kind: GitHubErrorKind,
    message: string,
    options: { status?: number; resetAt?: string | null; docsUrl?: string | null } = {},
  ) {
    super(message);
    this.name = 'GitHubError';
    this.kind = kind;
    this.status = options.status ?? 0;
    this.resetAt = options.resetAt ?? null;
    this.docsUrl = options.docsUrl ?? null;
  }
}

export function githubConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN);
}

function token(): string {
  if (typeof window !== 'undefined') {
    throw new GitHubError('unconfigured', 'GITHUB_TOKEN chỉ được đọc ở phía máy chủ.');
  }
  const value = process.env.GITHUB_TOKEN;
  if (!value) {
    throw new GitHubError(
      'unconfigured',
      'Chưa cấu hình GITHUB_TOKEN trên máy chủ nên không thể gọi GitHub API.',
    );
  }
  return value;
}

function baseHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT,
  };
}

/**
 * Removes anything that looks like a credential from text that may be shown to
 * a user or written to a log. Upstream messages are untrusted; if GitHub ever
 * echoes a token back (proxy, debug layer, misconfigured mirror), the value must
 * not reach the browser.
 */
export function scrubSecrets(text: string): string {
  let out = text;
  const current = process.env.GITHUB_TOKEN;
  if (current && current.length >= 8) {
    out = out.split(current).join('[REDACTED]');
  }
  return out
    .replace(/gh[pousr]_[A-Za-z0-9]{16,}/g, '[REDACTED]')
    .replace(/github_pat_[A-Za-z0-9_]{16,}/g, '[REDACTED]')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]');
}

function resetFromHeaders(headers: Headers): string | null {
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  if (remaining === '0' && reset) {
    const seconds = Number(reset);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString();
  }
  return null;
}

function classify(status: number, headers: Headers, body: string): GitHubError {
  const resetAt = resetFromHeaders(headers);
  let detail = '';
  let docsUrl: string | null = null;
  try {
    const parsed = JSON.parse(body) as { message?: string; documentation_url?: string };
    detail = scrubSecrets(parsed.message ?? '');
    docsUrl = parsed.documentation_url ?? null;
  } catch {
    detail = scrubSecrets(body.slice(0, 200));
  }

  if (status === 401) return new GitHubError('auth', 'GitHub từ chối token (401). Token sai hoặc đã hết hạn.', { status, docsUrl });
  if (status === 403) {
    if (resetAt) {
      return new GitHubError('rate_limit', 'Đã hết hạn mức gọi GitHub API (403).', { status, resetAt, docsUrl });
    }
    return new GitHubError('permission', `Tài khoản không có quyền cho thao tác này (403): ${detail}`, { status, docsUrl });
  }
  if (status === 404) return new GitHubError('not_found', 'Không tìm thấy tài nguyên hoặc không có quyền xem nó (404).', { status, docsUrl });
  if (status === 429) return new GitHubError('rate_limit', 'GitHub giới hạn tần suất (429).', { status, resetAt, docsUrl });
  if (status >= 500) return new GitHubError('server', `GitHub trả về lỗi máy chủ (${status}).`, { status, docsUrl });
  return new GitHubError('server', `GitHub trả về ${status}: ${detail}`, { status, docsUrl });
}

async function request(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new GitHubError('timeout', `GitHub không phản hồi trong ${timeoutMs / 1000} giây.`);
    }
    throw new GitHubError('network', 'Không kết nối được tới GitHub API. Kiểm tra mạng máy chủ.');
  }
  return response;
}

export interface RestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
}

export async function rest<T>(path: string, options: RestOptions = {}): Promise<T> {
  const url = new URL(`${REST_BASE}${path}`);
  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await request(url.toString(), { headers: baseHeaders() }, options.timeoutMs);
  if (!response.ok) throw classify(response.status, response.headers, await response.text());
  return (await response.json()) as T;
}

/** Follows the `Link: rel="next"` header, stopping at `maxPages`. */
export async function restPaginated<T>(
  path: string,
  options: RestOptions & { perPage?: number; maxPages?: number } = {},
): Promise<{ items: T[]; pagesFetched: number; truncated: boolean }> {
  const perPage = options.perPage ?? 100;
  const maxPages = options.maxPages ?? 5;
  const items: T[] = [];
  let next: string | null = null;
  let page = 1;
  let pagesFetched = 0;

  do {
    const url = new URL(`${REST_BASE}${path}`);
    for (const [key, value] of Object.entries(options.params ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));

    const response: Response = await request(url.toString(), { headers: baseHeaders() }, options.timeoutMs);
    if (!response.ok) throw classify(response.status, response.headers, await response.text());

    items.push(...((await response.json()) as T[]));
    pagesFetched += 1;

    const link: string | null = response.headers.get('link');
    const match: RegExpMatchArray | null = link ? link.match(/<([^>]+)>;\s*rel="next"/) : null;
    next = match ? match[1] : null;
    page += 1;
  } while (next && pagesFetched < maxPages);

  return { items, pagesFetched, truncated: Boolean(next) };
}

export async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await request(GRAPHQL_URL, {
    method: 'POST',
    headers: { ...baseHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) throw classify(response.status, response.headers, await response.text());

  const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string; type?: string }> };
  if (payload.errors?.length) {
    const message = scrubSecrets(payload.errors.map((e) => e.message).join('; '));
    // GraphQL reports a missing node as an error, not as null. Classifying it
    // as not_found lets the caller answer 404 instead of "unknown error".
    const kind: GitHubErrorKind = /rate limit|abuse/i.test(message)
      ? 'rate_limit'
      : /could not resolve to a/i.test(message)
        ? 'not_found'
        : 'graphql';
    throw new GitHubError(kind, `GitHub GraphQL: ${message}`);
  }
  if (!payload.data) throw new GitHubError('graphql', 'GitHub GraphQL trả về dữ liệu rỗng.');
  return payload.data;
}

export interface RateLimitBucket {
  limit: number;
  remaining: number;
  used: number;
  resetAt: string;
}

export interface RateLimitState extends RateLimitBucket {
  /** Which quota bucket the top-level numbers describe. */
  resource: 'core';
  /** REST core quota. */
  core: RateLimitBucket;
  /** GraphQL quota, which is a separate pool and often the binding one here. */
  graphql: RateLimitBucket | null;
  search: RateLimitBucket | null;
}

type RawBucket = { limit: number; remaining: number; used: number; reset: number };

function toBucket(bucket: RawBucket | undefined): RateLimitBucket | null {
  if (!bucket) return null;
  return {
    limit: bucket.limit,
    remaining: bucket.remaining,
    used: bucket.used,
    resetAt: new Date(bucket.reset * 1000).toISOString(),
  };
}

/**
 * Reads the token's rate-limit buckets. This is a read-only call that does not
 * itself consume the core quota. Returns null when it cannot be read, so the
 * caller can say "unknown" rather than inventing numbers.
 */
export async function fetchRateLimit(): Promise<RateLimitState | null> {
  try {
    const data = await rest<{
      resources: { core: RawBucket; graphql?: RawBucket; search?: RawBucket };
    }>('/rate_limit', { timeoutMs: 6000 });

    const core = toBucket(data.resources.core);
    if (!core) return null;
    const graphql = toBucket(data.resources.graphql);
    const search = toBucket(data.resources.search);
    // Report whichever pool will run out first, so the number shown is useful.
    const binding = graphql && graphql.remaining < core.remaining ? graphql : core;

    return {
      ...binding,
      resource: 'core',
      core,
      graphql,
      search,
    };
  } catch {
    return null;
  }
}

/** Turns any thrown value into a message safe to render, without leaking internals. */
export function describeError(err: unknown): { kind: GitHubErrorKind | 'unknown'; message: string } {
  if (err instanceof GitHubError) return { kind: err.kind, message: scrubSecrets(err.message) };
  return { kind: 'unknown', message: 'Đã xảy ra lỗi không xác định khi tải dữ liệu.' };
}
