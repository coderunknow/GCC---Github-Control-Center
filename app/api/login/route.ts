import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_MAX_AGE, createSessionToken, passwordMatches } from '@/lib/auth';
import { absoluteUrl, isSecureRequest } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get('password') ?? '');
  const nextRaw = String(form.get('next') ?? '/');
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/';

  if (!password || !passwordMatches(password)) {
    return NextResponse.redirect(
      absoluteUrl(request, `/login?error=1&next=${encodeURIComponent(next)}`),
      303,
    );
  }

  const token = await createSessionToken();
  if (!token) {
    // Configuration is incomplete; fail closed rather than issuing a cookie.
    return NextResponse.redirect(absoluteUrl(request, '/login?error=1'), 303);
  }

  const response = NextResponse.redirect(absoluteUrl(request, next), 303);
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Derived from the actual request: Secure over HTTPS, not over plain HTTP,
    // where the browser would drop the cookie and the login would appear broken.
    secure: isSecureRequest(request),
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
