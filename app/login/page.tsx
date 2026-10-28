import { authConfigured } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = typeof params.next === 'string' && params.next.startsWith('/') ? params.next : '/';
  const configured = authConfigured();

  return (
    <main className="login-wrap">
      <div className="panel">
        <h1 style={{ fontSize: 19 }}>Đăng nhập</h1>
        <p className="muted small" style={{ marginTop: 4 }}>
          Ứng dụng riêng tư, chỉ một người dùng được phép truy cập.
        </p>

        {!configured ? (
          <div className="banner bad" style={{ marginTop: 14 }}>
            Máy chủ chưa được cấu hình. Thiếu <span className="mono">APP_PASSWORD</span> hoặc{' '}
            <span className="mono">SESSION_SECRET</span> (tối thiểu 16 ký tự). Ứng dụng sẽ từ chối mọi đăng nhập
            cho tới khi hai biến này được đặt.
          </div>
        ) : (
          <form action="/api/login" method="post" style={{ marginTop: 14 }}>
            <input type="hidden" name="next" value={next} />
            <div className="field">
              <label htmlFor="password">Mật khẩu</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
            </div>
            {params.error ? <p className="error">Mật khẩu không đúng.</p> : null}
            <button type="submit" style={{ width: '100%' }}>
              Đăng nhập
            </button>
          </form>
        )}
      </div>
      <p className="muted small" style={{ textAlign: 'center' }}>
        Phiên đăng nhập kéo dài 12 giờ và được ký bằng HMAC-SHA256.
      </p>
    </main>
  );
}
