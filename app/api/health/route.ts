import { NextResponse } from 'next/server';
import { authConfigured } from '@/lib/auth';
import { githubConfigured } from '@/lib/github';

export const dynamic = 'force-dynamic';

/**
 * Liveness and configuration probe. Deliberately unauthenticated so a deploy
 * can be smoke-tested, and deliberately free of secrets: it reports whether
 * configuration exists, never what it is.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'github-project-control-center',
    time: new Date().toISOString(),
    checks: {
      auth_configured: authConfigured(),
      github_configured: githubConfigured(),
      database_configured: Boolean(process.env.DATABASE_URL),
      arena_direct_connectivity: 'blocked',
    },
  });
}
