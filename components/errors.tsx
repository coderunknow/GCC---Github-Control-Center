import Link from 'next/link';
import { Notice } from './ui';
import { GitHubError, describeError, githubConfigured } from '@/lib/github';

/**
 * Renders an upstream failure with a remedy that matches the actual cause.
 * Collapsing every failure into "something went wrong" would hide whether the
 * user needs a token, a scope, or patience.
 */
export function GitHubErrorNotice({ error }: { error: unknown }) {
  const { kind, message } = describeError(error);
  const detail = error instanceof GitHubError ? error : null;

  switch (kind) {
    case 'unconfigured':
      return (
        <Notice tone="bad" title="Chưa cấu hình GitHub.">
          Máy chủ thiếu <span className="mono">GITHUB_TOKEN</span>. Sao chép{' '}
          <span className="mono">.env.example</span> thành <span className="mono">.env</span>, đặt token rồi khởi động
          lại. Xem <Link href="/health">Tình trạng</Link> để kiểm tra cấu hình.
        </Notice>
      );
    case 'auth':
      return (
        <Notice tone="bad" title="Token bị từ chối.">
          GitHub trả về 401. Token có thể đã hết hạn hoặc bị thu hồi. Tạo token mới và cập nhật{' '}
          <span className="mono">GITHUB_TOKEN</span>.
        </Notice>
      );
    case 'permission':
      return (
        <Notice tone="warn" title="Không đủ quyền.">
          {message} Cần cấp thêm scope cho token (ví dụ <span className="mono">repo</span>,{' '}
          <span className="mono">read:org</span>, <span className="mono">notifications</span> hoặc quyền Checks tuỳ
          màn hình).
          {detail?.docsUrl ? (
            <>
              {' '}
              <a href={detail.docsUrl} target="_blank" rel="noreferrer noopener">
                Tài liệu GitHub
              </a>
            </>
          ) : null}
        </Notice>
      );
    case 'rate_limit':
      return (
        <Notice tone="warn" title="Đã hết hạn mức GitHub API.">
          {message}
          {detail?.resetAt ? ` Hạn mức đặt lại lúc ${new Date(detail.resetAt).toLocaleTimeString('vi-VN')}.` : ''}{' '}
          Thử lại sau hoặc giảm số trang tải.
        </Notice>
      );
    case 'not_found':
      return (
        <Notice tone="warn" title="Không tìm thấy.">
          {message} Repository có thể đã bị xoá, đổi tên, hoặc chuyển sang riêng tư mà token hiện tại không đọc được.
        </Notice>
      );
    case 'timeout':
      return (
        <Notice tone="warn" title="GitHub phản hồi quá chậm.">
          {message} Đây là lỗi tạm thời — thử tải lại trang.
        </Notice>
      );
    case 'network':
      return (
        <Notice tone="bad" title="Không kết nối được tới GitHub.">
          {message}
        </Notice>
      );
    default:
      return (
        <Notice tone="bad" title="Không tải được dữ liệu.">
          {message}
        </Notice>
      );
  }
}

/** Shown when the token is missing entirely, before any request is attempted. */
export function SetupRequired() {
  if (githubConfigured()) return null;
  return (
    <Notice tone="bad" title="Chưa cấu hình GITHUB_TOKEN.">
      Không có dữ liệu nào được hiển thị và không có số liệu mẫu nào được tạo ra. Sao chép{' '}
      <span className="mono">.env.example</span> thành <span className="mono">.env</span> và đặt token GitHub, sau đó
      khởi động lại máy chủ.
    </Notice>
  );
}
