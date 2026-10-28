import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import { absoluteUrl } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const response = NextResponse.redirect(absoluteUrl(request, '/login'), 303);
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return response;
}
