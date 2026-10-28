// Boundary tests.
//
// These are deliberately structural: they fail if a future change moves the
// GitHub token into client code, injects untrusted HTML, or disables TLS
// verification. They complement the behavioural tests elsewhere.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const sourceFiles = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'components')), join(ROOT, 'middleware.ts')];

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function filesMatching(pattern: RegExp): string[] {
  return sourceFiles.filter((file) => pattern.test(read(file))).map((file) => relative(ROOT, file));
}

describe('ranh giới token', () => {
  it('mọi tệp đọc GITHUB_TOKEN đều nằm phía máy chủ', () => {
    const readers = filesMatching(/process\.env\.GITHUB_TOKEN/);
    expect(readers.length).toBeGreaterThan(0);
    for (const file of readers) {
      // Only the API layer and the health probe may touch the token directly.
      expect(['lib/github.ts', 'app/api/health/route.ts']).toContain(file);
    }
  });

  it('không có "use client" nào trong tệp đọc token', () => {
    for (const file of sourceFiles) {
      const text = read(file);
      if (text.includes('process.env.GITHUB_TOKEN')) {
        expect(text).not.toContain("'use client'");
      }
    }
  });

  it('không đưa token vào URL hay query string', () => {
    const offenders = filesMatching(/(access_token=|token=|Authorization.*searchParams)/);
    expect(offenders).toEqual([]);
  });

  it('không ghi log token', () => {
    const offenders = filesMatching(/console\.(log|error|warn)\([^)]*GITHUB_TOKEN/);
    expect(offenders).toEqual([]);
  });
});

describe('ranh giới hiển thị', () => {
  it('không dùng dangerouslySetInnerHTML với dữ liệu GitHub', () => {
    expect(filesMatching(/dangerouslySetInnerHTML/)).toEqual([]);
  });

  it('không gán innerHTML', () => {
    expect(filesMatching(/\.innerHTML\s*=/)).toEqual([]);
  });
});

describe('ranh giới TLS', () => {
  it('không tắt kiểm tra chứng chỉ', () => {
    expect(filesMatching(/rejectUnauthorized\s*:\s*false/)).toEqual([]);
    expect(filesMatching(/NODE_TLS_REJECT_UNAUTHORIZED/)).toEqual([]);
  });
});

describe('ranh giới chỉ đọc', () => {
  it('không có lời gọi ghi lên GitHub (POST/PATCH/PUT/DELETE tới API)', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const text = read(file);
      // A mutating call would need a method plus a GitHub endpoint path.
      if (/method:\s*'(POST|PATCH|PUT|DELETE)'/.test(text) && /api\.github\.com/.test(text)) {
        // GraphQL reads are POST by protocol; only REST mutations are forbidden.
        if (!file.endsWith('lib/github.ts')) offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('không có endpoint tạo commit, tag hay release', () => {
    const forbidden = /api\.github\.com\/repos\/[^'"`]*\/(git\/refs|releases)\b/;
    expect(filesMatching(forbidden)).toEqual([]);
  });
});

describe('cấu hình bí mật', () => {
  it('.env.example không chứa giá trị bí mật thật', () => {
    const text = read(join(ROOT, '.env.example'));
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [, value = ''] = trimmed.split('=');
      if (!value) continue;
      // Placeholder values only: no long random-looking strings.
      expect(value.length).toBeLessThan(60);
      expect(value).not.toMatch(/gh[pousr]_[A-Za-z0-9]{16,}/);
    }
  });

  it('không có tệp .env nào bị theo dõi bởi git', async () => {
    const { execFileSync } = await import('node:child_process');
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((line) => /(^|\/)\.env($|\.)/.test(line) && !line.endsWith('.env.example'));
    expect(tracked).toEqual([]);
  });
});
