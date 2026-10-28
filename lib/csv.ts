// CSV and JSON export helpers.
//
// GitHub content is untrusted. Spreadsheet applications execute cells that
// begin with = + - @ (and tab/CR), so those are neutralised before quoting.
// This is the "CSV formula injection" control the specification requires.

export type CsvValue = string | number | boolean | null | undefined;

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Neutralises a value for CSV. A leading formula character is prefixed with a
 * single quote, which spreadsheets treat as literal text. Quotes are doubled
 * and the field is quoted whenever it contains a delimiter, quote or newline.
 */
export function escapeCsvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';

  let text = String(value);

  // Defuse formula injection before quoting.
  if (FORMULA_PREFIX.test(text)) {
    text = `'${text}`;
  }

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(columns: string[], rows: CsvValue[][]): string {
  const header = columns.map(escapeCsvCell).join(',');
  const body = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
  // A UTF-8 BOM keeps Vietnamese diacritics readable when Excel opens the file.
  return `\uFEFF${header}\r\n${body}\r\n`;
}

export interface ReportMeta {
  kind: string;
  generatedAt: string;
  filters: Record<string, string>;
  rowCount: number;
  /** Sections the upstream API could not fully supply, stated rather than hidden. */
  incomplete: string[];
}

export function buildJsonReport(meta: ReportMeta, rows: Record<string, unknown>[]): string {
  return `${JSON.stringify({ meta, rows }, null, 2)}\n`;
}

export function buildMarkdownReport(meta: ReportMeta, rows: Record<string, unknown>[], columns: string[]): string {
  const lines: string[] = [
    `# Báo cáo ${meta.kind}`,
    '',
    `- Tạo lúc: ${meta.generatedAt}`,
    `- Số dòng: ${meta.rowCount}`,
    ...Object.entries(meta.filters).map(([key, value]) => `- Bộ lọc \`${key}\`: ${value || '(không)'}`),
  ];
  if (meta.incomplete.length) {
    lines.push('', '## Phần dữ liệu chưa đầy đủ', ...meta.incomplete.map((note) => `- ${note}`));
  }
  lines.push('', `| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    const cells = columns.map((column) => {
      const raw = row[column];
      const text = raw === null || raw === undefined ? '' : String(raw);
      return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    });
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return `${lines.join('\n')}\n`;
}

/** Filename safe for a Content-Disposition header. */
export function reportFilename(kind: string, extension: string, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `gpcc-${kind}-${stamp}.${extension}`;
}

/**
 * Whitelist of fields that may appear in an export. Anything outside it is
 * dropped, so a future refactor cannot accidentally ship a token or a raw
 * upstream payload into a downloadable file.
 */
export function pick(row: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in row) out[field] = row[field];
  }
  return out;
}
