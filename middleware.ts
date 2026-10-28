import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, authDisabled, verifySessionToken } from './lib/auth';

// Everything is protected by default; only these paths are reachable
// unauthenticated. A path is public because it must be (login form, liveness
// probe), never because it is convenient.
const PUBLIC_PATHS = new Set(['/login', '/api/login', '/api/health']);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Manual-testing mode. Explicitly opt-in via AUTH_DISABLED=1; every screen
  // then also shows a red banner so an open instance cannot be mistaken for a
  // protected one.
  if (authDisabled()) return NextResponse.next();

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
