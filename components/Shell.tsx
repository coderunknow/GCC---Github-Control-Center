import Link from 'next/link';

export const NAV = [
  { href: '/', label: 'Tổng quan' },
  { href: '/repos', label: 'Kho mã' },
  { href: '/issues', label: 'Issues' },
  { href: '/pulls', label: 'Pull requests' },
  { href: '/actions', label: 'CI/CD' },
  { href: '/releases', label: 'Releases' },
  { href: '/activity', label: 'Hoạt động' },
  { href: '/search', label: 'Tìm kiếm' },
  { href: '/notifications', label: 'Thông báo' },
  { href: '/reports', label: 'Báo cáo' },
  { href: '/health', label: 'Tình trạng' },
];

/** Marks the active nav item for a path, tolerating nested detail routes. */
function isActive(href: string, active?: string): boolean {
  if (!active) return false;
  if (href === '/') return active === '/';
  return active === href || active.startsWith(`${href}/`);
}

export function Shell({
  children,
  active,
  viewer,
  databaseAvailable,
}: {
  children: React.ReactNode;
  active?: string;
  viewer?: { login: string; avatarUrl: string } | null;
  databaseAvailable?: boolean;
}) {
  return (
    <>
      <a className="skip-link" href="#main">
        Bỏ qua điều hướng
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <span>Trung tâm điều khiển GitHub</span>
        </div>
        <div className="topbar-right">
          {databaseAvailable === false ? (
            <Link href="/health" className="topbar-status warn" title="Lịch sử bền vững đang tắt">
              DB: chưa cấu hình
            </Link>
          ) : null}
          {viewer ? <span className="viewer">@{viewer.login}</span> : null}
          <form action="/api/logout" method="post">
            <button type="submit" className="btn-subtle">
              Đăng xuất
            </button>
          </form>
        </div>
      </header>
      <nav className="nav" aria-label="Điều hướng chính">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href, active) ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <main id="main">{children}</main>
      <footer className="foot">
        Dữ liệu lấy trực tiếp từ GitHub mỗi lần tải trang. Không có số liệu mẫu.
      </footer>
    </>
  );
}
