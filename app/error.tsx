'use client';

import { useEffect } from 'react';

/**
 * Route-level error boundary. Shows a generic message and a retry, and never
 * renders the raw error message: an upstream payload could contain a URL with
 * an embedded credential.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server logs keep the digest for correlation; the browser gets no detail.
    console.error('Route error', error.digest ?? '(no digest)');
  }, [error]);

  return (
    <main id="main">
      <div className="banner bad" role="alert">
        <strong>Đã xảy ra lỗi khi tải trang này.</strong> Chi tiết kỹ thuật không được hiển thị để tránh lộ dữ liệu.
        {error.digest ? (
          <>
            {' '}
            Mã lỗi: <span className="mono">{error.digest}</span>
          </>
        ) : null}
      </div>
      <button type="button" onClick={reset}>
        Thử lại
      </button>
    </main>
  );
}
