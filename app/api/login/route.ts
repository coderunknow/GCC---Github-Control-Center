import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_MAX_AGE, createSessionToken, passwordMatches } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get('password') ?? '');
  const nextRaw = String(form.get('next') ?? '/');
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/';

  const origin = new URL(request.url).origin;

  if (!password || !passwordMatches(password)) {
    return NextResponse.redirect(new URL(`/login?error=1&next=${encodeURIComponent(next)}`, origin), 303);
  }

  const token = await createSessionToken();
  if (!token) {
    // Configuration is incomplete; fail closed rather than issuing a cookie.
    return NextResponse.redirect(new URL('/login?error=1', origin), 303);
  }

  const response = NextResponse.redirect(new URL(next, origin), 303);
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
