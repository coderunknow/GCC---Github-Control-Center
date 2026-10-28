import { describe, expect, it } from 'vitest';
import {
  buildJsonReport,
  buildMarkdownReport,
  escapeCsvCell,
  pick,
  reportFilename,
  toCsv,
} from '@/lib/csv';

describe('làm sạch ô CSV', () => {
  it('vô hiệu hoá công thức ở đầu ô', () => {
    // Each of these would otherwise be executed by a spreadsheet application.
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('+1+1')).toBe("'+1+1");
    expect(escapeCsvCell('-1+1')).toBe("'-1+1");
    expect(escapeCsvCell('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)");
    expect(escapeCsvCell('\tcmd')).toBe("'\tcmd");
    // A carriage return also forces quoting, so the cell is both escaped and wrapped.
    expect(escapeCsvCell('\rcmd')).toBe("\"'\rcmd\"");
  });

  it('không chạm vào chuỗi bình thường', () => {
    expect(escapeCsvCell('bình thường')).toBe('bình thường');
    expect(escapeCsvCell('a-b')).toBe('a-b');
    expect(escapeCsvCell(42)).toBe('42');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('nhân đôi dấu nháy và bọc ô có dấu phẩy, nháy, xuống dòng', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
  });

  it('chặn công thức cả khi ô cần bọc', () => {
    expect(escapeCsvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
  });
});

describe('tạo tệp CSV', () => {
  it('có BOM UTF-8 và CRLF để Excel đọc đúng tiếng Việt', () => {
    const csv = toCsv(['tên'], [['Nguyễn Văn A']]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('tên\r\n');
    expect(csv).toContain('Nguyễn Văn A');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('làm sạch từng ô trong dữ liệu, không chỉ tiêu đề', () => {
    const csv = toCsv(['a', 'b'], [['=cmd', '@cmd']]);
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'@cmd");
  });
});

describe('báo cáo JSON và Markdown', () => {
  const meta = {
    kind: 'issues',
    generatedAt: '2026-01-01T00:00:00.000Z',
    filters: { state: 'open' },
    rowCount: 1,
    incomplete: ['Chỉ xuất trang đầu tiên.'],
  };

  it('JSON giữ metadata phạm vi và cảnh báo thiếu dữ liệu', () => {
    const parsed = JSON.parse(buildJsonReport(meta, [{ number: 1, title: 'x' }])) as {
      meta: typeof meta;
      rows: Array<{ number: number }>;
    };
    expect(parsed.meta.incomplete).toEqual(['Chỉ xuất trang đầu tiên.']);
    expect(parsed.meta.rowCount).toBe(1);
    expect(parsed.rows[0].number).toBe(1);
  });

  it('Markdown nêu rõ phần dữ liệu chưa đầy đủ', () => {
    const md = buildMarkdownReport(meta, [{ number: 1, title: 'a|b' }], ['number', 'title']);
    expect(md).toContain('## Phần dữ liệu chưa đầy đủ');
    expect(md).toContain('Chỉ xuất trang đầu tiên.');
    expect(md).toContain('a\\|b');
  });
});

describe('tên tệp và danh sách trường', () => {
  it('tên tệp an toàn cho header Content-Disposition', () => {
    const name = reportFilename('issues', 'csv', new Date('2026-03-04T05:06:07.000Z'));
    expect(name).toBe('gpcc-issues-2026-03-04-05-06-07.csv');
    expect(name).not.toMatch(/[",\r\n]/);
  });

  it('pick loại bỏ mọi trường ngoài danh sách cho phép', () => {
    const row = { title: 'x', token: 'ghp_secret', nested: { a: 1 }, number: 3 };
    const picked = pick(row, ['title', 'number']);
    expect(picked).toEqual({ title: 'x', number: 3 });
    expect(Object.keys(picked)).not.toContain('token');
  });
});
