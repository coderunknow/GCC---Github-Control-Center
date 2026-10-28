// Authentication for the host.
//
// Two distinct credential classes, because the human and the worker must never
// share one:
//
//   human  → password login → signed HttpOnly session cookie
//   worker → AGENT_TOKEN in an x-agent-token header (never in a URL)
//
// This mirrors the application's existing design (lib/auth.ts): HMAC-SHA256
// signed cookie, 12-hour TTL, constant-time comparisons, and fail-closed
// behaviour when configuration is missing.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'arena_host_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  // timingSafeEqual requires equal lengths; hash first so length does not leak.
  const hashA = createHmac('sha256', 'length-guard').update(bufA).digest();
  const hashB = createHmac('sha256', 'length-guard').update(bufB).digest();
  return timingSafeEqual(hashA, hashB) && bufA.length === bufB.length;
}

/**
 * Reads and validates configuration. Throws rather than running without
 * credentials — an unauthenticated host is worse than a host that refuses to
 * start, because the failure is invisible.
 */
export function loadConfig(env = process.env) {
  const password = env.APP_PASSWORD ?? '';
  const secret = env.SESSION_SECRET ?? '';
  const agentToken = env.AGENT_TOKEN ?? '';

  const problems = [];
  if (password.length < 8) problems.push('APP_PASSWORD phải dài ít nhất 8 ký tự');
  if (secret.length < 16) problems.push('SESSION_SECRET phải dài ít nhất 16 ký tự');
  if (agentToken.length < 16) problems.push('AGENT_TOKEN phải dài ít nhất 16 ký tự');

  if (problems.length) {
    throw new Error(`Cấu hình không hợp lệ (fail closed):\n  - ${problems.join('\n  - ')}`);
  }

  return { password, secret, agentToken };
}

export function passwordMatches(candidate, expected) {
  if (!candidate || !expected) return false;
  return constantTimeEqual(candidate, expected);
}

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken(secret, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ sub: 'owner', iat: Math.floor(now / 1000), n: randomBytes(8).toString('hex') }),
  ).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token, secret, now = Date.now()) {
  if (!token || typeof token !== 'string') return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expected = sign(payload, secret);
  if (!constantTimeEqual(signature, expected)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.sub !== 'owner' || typeof data.iat !== 'number') return false;
    return now / 1000 - data.iat < SESSION_TTL_SECONDS;
  } catch {
    return false;
  }
}

export function parseCookies(header) {
  /** @type {Record<string,string>} */
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function agentTokenMatches(presented, expected) {
  if (!presented || !expected) return false;
  return constantTimeEqual(presented, expected);
}

/**
 * Simple in-memory rate limiter for the login endpoint, to make password
 * guessing impractical. Deliberately fixed-window and per-process.
 */
export class LoginThrottle {
  constructor({ limit = 8, windowMs = 15 * 60 * 1000 } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    /** @type {Map<string, number[]>} */
    this.hits = new Map();
  }

  check(key, now = Date.now()) {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.hits.set(key, recent);
    return { allowed: recent.length < this.limit, remaining: Math.max(0, this.limit - recent.length) };
  }

  record(key, now = Date.now()) {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    recent.push(now);
    this.hits.set(key, recent);
  }

  reset(key) {
    this.hits.delete(key);
  }
}
