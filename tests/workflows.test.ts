// Workflow policy tests.
//
// The README makes safety claims about automation. These assertions read the
// workflow files as text so a future edit cannot quietly add an unattended
// merge, a force-push, or write access the job does not need.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOW_DIR = join(process.cwd(), '.github', 'workflows');

function workflow(name: string): string {
  return readFileSync(join(WORKFLOW_DIR, name), 'utf8');
}

const nightly = workflow('nightly.yml');
const ci = workflow('ci.yml');

describe('CI hiện có', () => {
  it('chạy trên pull request và trên main', () => {
    expect(ci).toContain('pull_request:');
    expect(ci).toContain('branches: [main]');
  });

  it('chạy đủ ba cổng', () => {
    expect(ci).toContain('npm run typecheck');
    expect(ci).toContain('npm test');
    expect(ci).toContain('npm run build');
  });

  it('chỉ có quyền đọc', () => {
    expect(ci).toContain('contents: read');
    expect(ci).not.toMatch(/contents:\s*write/);
  });
});

describe('Nightly', () => {
  it('chạy theo lịch và cho phép kích hoạt tay', () => {
    expect(nightly).toMatch(/schedule:/);
    expect(nightly).toMatch(/cron:\s*'0 18 \* \* \*'/);
    expect(nightly).toContain('workflow_dispatch:');
  });

  it('xác minh main hằng đêm bằng đúng ba cổng của CI', () => {
    expect(nightly).toContain('npm run typecheck');
    expect(nightly).toContain('npm test');
    expect(nightly).toContain('npm run build');
  });

  it('chỉ cập nhật trong phạm vi version đã khai báo', () => {
    expect(nightly).toContain('npm update --save');
    // A major bump must stay a human decision.
    expect(nightly).not.toMatch(/npm (install|i) [a-z@^~]/);
    expect(nightly).not.toContain('npm-check-updates');
  });

  it('không bao giờ tự merge hay bật auto-merge', () => {
    expect(nightly).not.toMatch(/gh pr merge/);
    expect(nightly).not.toMatch(/--auto\b/);
  });

  it('không push thẳng vào main và không force-push', () => {
    expect(nightly).not.toMatch(/git push[^\n]*\bmain\b/);
    expect(nightly).not.toMatch(/--force\b/);
    expect(nightly).not.toMatch(/push -f\b/);
    expect(nightly).toContain('git push origin "$branch"');
  });

  it('chạy cổng kiểm tra trước khi mở PR', () => {
    const gatesIndex = nightly.indexOf('Verify the update');
    const openIndex = nightly.indexOf('Open pull request');
    expect(gatesIndex).toBeGreaterThan(-1);
    expect(openIndex).toBeGreaterThan(gatesIndex);
  });

  it('chống tạo trùng PR nightly', () => {
    expect(nightly).toContain("grep -q '^nightly/deps-'");
    // The duplicate check must happen before the branch is pushed.
    expect(nightly.indexOf("grep -q '^nightly/deps-'")).toBeLessThan(
      nightly.indexOf('git push origin "$branch"'),
    );
  });

  it('quyền ghi được giới hạn ở nội dung và pull request', () => {
    const permissions = nightly.slice(nightly.indexOf('permissions:'), nightly.indexOf('concurrency:'));
    expect(permissions).toContain('contents: write');
    expect(permissions).toContain('pull-requests: write');
    expect(permissions).not.toContain('packages: write');
    expect(permissions).not.toContain('actions: write');
  });

  it('báo cáo phụ thuộc chỉ để đọc, không làm đỏ đêm', () => {
    // npm outdated/audit exit non-zero by design; the job must swallow that.
    expect(nightly).toContain('npm outdated --json > outdated.json 2>/dev/null || true');
    expect(nightly).toContain('npm audit --json > audit.json 2>/dev/null || true');
  });

  it('ghi rõ hệ quả của GITHUB_TOKEN trong PR body', () => {
    // PRs created with the default token do not trigger workflows; saying so
    // prevents a maintainer from waiting for a check run that will never appear.
    expect(nightly).toContain('không kích hoạt workflow CI');
  });
});

describe('không có workflow lạ', () => {
  it('chỉ tồn tại ci.yml và nightly.yml', () => {
    const files = readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
    expect(files.sort()).toEqual(['ci.yml', 'nightly.yml']);
  });

  it('không workflow nào chứa secret dạng văn bản', () => {
    for (const name of readdirSync(WORKFLOW_DIR)) {
      const text = readFileSync(join(WORKFLOW_DIR, name), 'utf8');
      expect(text).not.toMatch(/gh[pousr]_[A-Za-z0-9]{16,}/);
      expect(text).not.toMatch(/github_pat_[A-Za-z0-9_]{16,}/);
      // Secrets must come from the context, never from a literal.
      expect(text).not.toMatch(/password:\s*[^\n$]/i);
    }
  });
});
