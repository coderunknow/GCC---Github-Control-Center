import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { buildJsonReport, buildMarkdownReport, reportFilename, toCsv } from '@/lib/csv';
import { buildExport, isExportKind } from '@/lib/exports';
import { getStore } from '@/lib/db';
import { describeError } from '@/lib/github';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CONTENT_TYPES: Record<string, string> = {
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
};

/**
 * Records an export in durable history when a database is configured.
 *
 * A failure to record must not fail the download — but it must not be silent
 * either, so the outcome is reported in a response header the UI can surface.
 */
async function recordExport(
  kind: string,
  format: 'csv' | 'json' | 'markdown',
  rowCount: number,
  content: string,
  incomplete: string[],
): Promise<'recorded' | 'skipped:no-database' | 'failed'> {
  const store = getStore();
  if (!store.available) return 'skipped:no-database';

  const occurredAt = new Date().toISOString();
  try {
    await store.saveReportWithContent({
      createdBy: 'session',
      format,
      kind,
      rangeFrom: null,
      rangeTo: null,
      repositories: [],
      rowCount,
      sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
      incomplete,
      content,
    });
    // The audit trail is separate from the report row on purpose: it answers
    // "who exported what, and did it succeed" without shipping the file itself.
    await store.recordAudit({
      occurredAt,
      actor: 'session',
      action: `export.${kind}`,
      target: kind,
      outcome: 'ok',
      detail: { format, rowCount, incomplete: incomplete.length },
    });
    return 'recorded';
  } catch {
    try {
      await store.recordAudit({
        occurredAt,
        actor: 'session',
        action: `export.${kind}`,
        target: kind,
        outcome: 'failed',
        detail: { format, rowCount },
      });
    } catch {
      // A broken database must not mask the original failure.
    }
    return 'failed';
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ kind: string }> },
) {
  const { kind } = await context.params;

  if (!isExportKind(kind)) {
    return NextResponse.json({ error: 'loại xuất không hợp lệ' }, { status: 404 });
  }

  const formatParam = request.nextUrl.searchParams.get('format') ?? 'csv';
  if (formatParam !== 'csv' && formatParam !== 'json' && formatParam !== 'markdown') {
    return NextResponse.json({ error: 'định dạng không hợp lệ' }, { status: 400 });
  }
  const format = formatParam;

  const params: Record<string, string> = {};
  request.nextUrl.searchParams.forEach((value, key) => {
    if (key !== 'format') params[key] = value.slice(0, 200);
  });

  try {
    const dataset = await buildExport(kind, params);
    const generatedAt = new Date().toISOString();
    const meta = {
      kind: dataset.kind,
      generatedAt,
      filters: dataset.filters,
      rowCount: dataset.rows.length,
      incomplete: dataset.incomplete,
    };

    let body: string;
    if (format === 'csv') {
      body = toCsv(
        dataset.columns,
        dataset.rows.map((row) => dataset.columns.map((column) => row[column])),
      );
    } else if (format === 'json') {
      body = buildJsonReport(meta, dataset.rows as unknown as Record<string, unknown>[]);
    } else {
      body = buildMarkdownReport(meta, dataset.rows as unknown as Record<string, unknown>[], dataset.columns);
    }

    const recordStatus = await recordExport(kind, format, dataset.rows.length, body, dataset.incomplete);

    return new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': CONTENT_TYPES[format],
        'content-disposition': `attachment; filename="${reportFilename(kind, format === 'markdown' ? 'md' : format)}"`,
        'cache-control': 'no-store, max-age=0',
        'x-export-rows': String(dataset.rows.length),
        'x-export-recording': recordStatus,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    const { kind: errorKind, message } = describeError(err);
    return NextResponse.json(
      { error: message, errorKind, hint: 'Thử lại; nếu lỗi quyền, kiểm tra scope của GITHUB_TOKEN.' },
      { status: errorKind === 'permission' ? 403 : errorKind === 'rate_limit' ? 429 : 502 },
    );
  }
}
