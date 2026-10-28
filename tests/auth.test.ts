import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  authConfigured,
  createSessionToken,
  passwordMatches,
  verifySessionToken,
} from '../lib/auth';

const PASSWORD = 'correct-horse-battery-staple';
const SECRET = 'a'.repeat(48);

beforeEach(() => {
  process.env.APP_PASSWORD = PASSWORD;
  process.env.SESSION_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.APP_PASSWORD;
  delete process.env.SESSION_SECRET;
});

describe('configuration fails closed', () => {
  it('reports not configured without a password', () => {
    delete process.env.APP_PASSWORD;
    expect(authConfigured()).toBe(false);
    expect(passwordMatches('')).toBe(false);
  });

  it('reports not configured with a short session secret', () => {
    process.env.SESSION_SECRET = 'too-short';
    expect(authConfigured()).toBe(false);
  });

  it('refuses to mint a token when unconfigured', async () => {
    delete process.env.SESSION_SECRET;
    await expect(createSessionToken()).resolves.toBeNull();
  });
});

describe('session tokens', () => {
  it('accepts a freshly issued token', async () => {
    const token = await createSessionToken();
    expect(token).toBeTypeOf('string');
    await expect(verifySessionToken(token)).resolves.toBe(true);
  });

  it('rejects a missing token', async () => {
    await expect(verifySessionToken(undefined)).resolves.toBe(false);
    await expect(verifySessionToken('')).resolves.toBe(false);
  });

  it('rejects a tampered payload', async () => {
    const token = await createSessionToken();
    const [payload, signature] = token!.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'owner', iat: Date.now() / 1000, admin: true }))
      .toString('base64url');
    await expect(verifySessionToken(`${forgedPayload}.${signature}`)).resolves.toBe(false);
    // Sanity: the original payload is still accepted.
    await expect(verifySessionToken(`${payload}.${signature}`)).resolves.toBe(true);
  });

  it('rejects a tampered signature', async () => {
    const token = await createSessionToken();
    const [payload] = token!.split('.');
    await expect(verifySessionToken(`${payload}.deadbeef`)).resolves.toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createSessionToken();
    process.env.SESSION_SECRET = 'b'.repeat(48);
    await expect(verifySessionToken(token)).resolves.toBe(false);
  });

  it('rejects an expired token', async () => {
    const issuedAt = Date.now();
    const token = await createSessionToken(issuedAt);
    // 12h TTL; check one second past it.
    await expect(verifySessionToken(token, issuedAt + 12 * 60 * 60 * 1000 + 1000)).resolves.toBe(false);
    // Still valid one second before expiry.
    await expect(verifySessionToken(token, issuedAt + 12 * 60 * 60 * 1000 - 1000)).resolves.toBe(true);
  });
});

describe('password comparison', () => {
  it('accepts the configured password', () => {
    expect(passwordMatches(PASSWORD)).toBe(true);
  });

  it('rejects wrong, empty, and prefix/suffix variants', () => {
    expect(passwordMatches('wrong')).toBe(false);
    expect(passwordMatches('')).toBe(false);
    expect(passwordMatches(PASSWORD.slice(0, -1))).toBe(false);
    expect(passwordMatches(`${PASSWORD}x`)).toBe(false);
    expect(passwordMatches(PASSWORD.toUpperCase())).toBe(false);
  });
});
