import { NextResponse, type NextRequest } from 'next/server';
import { getStore } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Recent audit entries. Returns an explicit 503 with `available: false` when no
 * database is configured — an empty list would be indistinguishable from
 * "nothing has happened yet".
 */
export async function GET(request: NextRequest) {
  const store = getStore();
  if (!store.available) {
    return NextResponse.json(
      {
        available: false,
        entries: [],
        detail: store.status.detail,
      },
      { status: 503 },
    );
  }

  const limitParam = Number.parseInt(request.nextUrl.searchParams.get('limit') ?? '50', 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

  try {
    const entries = await store.listAudit(limit);
    return NextResponse.json({
      available: true,
      detail: store.status.detail,
      entries,
    });
  } catch {
    return NextResponse.json(
      { available: true, entries: [], detail: 'Không đọc được nhật ký kiểm toán.' },
      { status: 500 },
    );
  }
}
