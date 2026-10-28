// Single-user session auth.
//
// Design: no external identity provider. One authorised user, authenticated by
// a password held only in the server environment, receiving a signed,
// HttpOnly, SameSite=Lax session cookie. The signature uses HMAC-SHA256 via
// Web Crypto so the same code runs in Edge middleware and in Node routes.
//
// Deliberate properties:
//  * The cookie carries no secret and no password material — only an issued-at
//    and expiry, both signed.
//  * Comparison is constant-time where it matters.
//  * Configuring the app without APP_PASSWORD or SESSION_SECRET fails closed:
//    every request is treated as unauthenticated rather than as "no auth needed".

export const SESSION_COOKIE = 'gpcc_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function key(): Promise<CryptoKey | null> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) return null;
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

async function hmac(payload: string): Promise<string | null> {
  const k = await key();
  if (!k) return null;
  const signature = await crypto.subtle.sign('HMAC', k, encoder.encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

/** Constant-time-ish string comparison for equal-length candidates. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Escape hatch for local manual testing only.
 *
 * The default posture is unchanged: without a valid session cookie, every route
 * except the public three is refused. Setting AUTH_DISABLED=1 turns the login
 * requirement off explicitly, which is only defensible on a throwaway test host
 * where the operator knows the URL is public. It is never inferred, and an
 * absent or different value leaves authentication fully enforced.
 */
export function authDisabled(): boolean {
  return process.env.AUTH_DISABLED === '1';
}

export function authConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD && process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16);
}

export async function createSessionToken(now = Date.now()): Promise<string | null> {
  if (!authConfigured()) return null;
  const payload = toBase64Url(encoder.encode(JSON.stringify({ sub: 'owner', iat: Math.floor(now / 1000) })));
  const signature = await hmac(payload);
  if (!signature) return null;
  return `${payload}.${signature}`;
}

export async function verifySessionToken(token: string | undefined | null, now = Date.now()): Promise<boolean> {
  if (!token || !authConfigured()) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expected = await hmac(payload);
  if (!expected || !safeEqual(signature, expected)) return false;

  try {
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { sub?: string; iat?: number };
    if (data.sub !== 'owner' || typeof data.iat !== 'number') return false;
    return now / 1000 - data.iat < SESSION_TTL_SECONDS;
  } catch {
    return false;
  }
}

/** Verifies the submitted password without short-circuiting on content. */
export function passwordMatches(candidate: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;

  // Fold the length difference into the accumulator so that both length and
  // content differences contribute, without returning early.
  let diff = candidate.length ^ expected.length;
  const max = Math.max(candidate.length, expected.length);
  for (let i = 0; i < max; i += 1) {
    diff |= (candidate.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export const SESSION_MAX_AGE = SESSION_TTL_SECONDS;
