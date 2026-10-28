import { describe, expect, it } from 'vitest';
import { absoluteUrl, isSecureRequest, publicOrigin, type RequestLike } from '@/lib/http';

function req(url: string, headers: Record<string, string> = {}): RequestLike {
  return { url, headers: new Headers(headers) };
}

describe('origin công khai', () => {
  it('dùng header proxy khi có (môi trường preview)', () => {
    const origin = publicOrigin(
      req('http://0.0.0.0:3100/api/login', {
        'x-forwarded-host': '3100-abc.e2b.app',
        'x-forwarded-proto': 'https',
        host: '0.0.0.0:3100',
      }),
    );
    expect(origin).toBe('https://3100-abc.e2b.app');
  });

  it('lấy giá trị đầu tiên khi proxy nối nhiều host', () => {
    const origin = publicOrigin(
      req('http://internal:3100/', {
        'x-forwarded-host': 'public.example.com, internal:3100',
        'x-forwarded-proto': 'https, http',
      }),
    );
    expect(origin).toBe('https://public.example.com');
  });

  it('không bao giờ trả 0.0.0.0', () => {
    expect(publicOrigin(req('http://0.0.0.0:3100/x'))).toBe('http://localhost:3100');
  });

  it('bỏ qua Host header không hợp lệ', () => {
    const origin = publicOrigin(req('http://127.0.0.1:3100/x', { host: 'evil.com/../../x' }));
    expect(origin).toBe('http://127.0.0.1:3100');
  });

  it('giữ nguyên host hợp lệ kèm cổng', () => {
    expect(publicOrigin(req('http://127.0.0.1:3100/x', { host: '192.168.1.10:3100' }))).toBe(
      'http://192.168.1.10:3100',
    );
  });
});

describe('phát hiện HTTPS', () => {
  it('ưu tiên x-forwarded-proto', () => {
    expect(isSecureRequest(req('http://internal/x', { 'x-forwarded-proto': 'https' }))).toBe(true);
    expect(isSecureRequest(req('https://public/x', { 'x-forwarded-proto': 'http' }))).toBe(false);
  });

  it('dựa vào URL khi không có proxy header', () => {
    expect(isSecureRequest(req('https://example.com/x'))).toBe(true);
    expect(isSecureRequest(req('http://localhost:3100/x'))).toBe(false);
  });
});

describe('URL chuyển hướng', () => {
  it('chỉ chấp nhận đường dẫn nội bộ', () => {
    const request = req('http://localhost:3100/api/login', { host: 'localhost:3100' });
    expect(absoluteUrl(request, '/repos').toString()).toBe('http://localhost:3100/repos');
    // Protocol-relative and absolute targets are rejected.
    expect(absoluteUrl(request, '//evil.com/x').toString()).toBe('http://localhost:3100/');
    expect(absoluteUrl(request, 'https://evil.com').toString()).toBe('http://localhost:3100/');
  });
});
