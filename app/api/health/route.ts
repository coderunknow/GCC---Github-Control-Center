import { NextResponse } from 'next/server';
import { authConfigured } from '@/lib/auth';
import { githubConfigured } from '@/lib/github';
import { getStore } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Liveness and configuration probe.
 *
 * Unauthenticated on purpose so a deployment can be smoke-tested, and free of
 * secrets on purpose: it reports whether configuration exists, never what it
 * is. It performs no network calls, so it stays cheap and cannot be used to
 * burn GitHub rate limit.
 */
export async function GET() {
  const store = getStore();
  return NextResponse.json({
    ok: true,
    service: 'github-project-control-center',
    version: '0.1.0-dev2',
    time: new Date().toISOString(),
    checks: {
      auth_configured: authConfigured(),
      github_configured: githubConfigured(),
      database_configured: store.available,
      database_backend: store.status.backend,
    },
  });
}
