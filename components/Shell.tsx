import Link from 'next/link';

const NAV = [
  { href: '/', label: 'Tổng quan' },
  { href: '/health', label: 'Tình trạng tích hợp' },
];

export function Shell({ children, active }: { children: React.ReactNode; active?: string }) {
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <span>Trung tâm điều khiển GitHub</span>
        </div>
        <nav className="nav" aria-label="Điều hướng chính">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} aria-current={active === item.href ? 'page' : undefined}>
              {item.label}
            </Link>
          ))}
          <form action="/api/logout" method="post">
            <button type="submit" className="btn" style={{ background: 'transparent', color: 'var(--muted)', border: '1px solid var(--line)', fontWeight: 500 }}>
              Đăng xuất
            </button>
          </form>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="foot">
        Ứng dụng riêng tư, một người dùng. Số liệu lấy trực tiếp từ GitHub tại thời điểm tải trang.
      </footer>
    </>
  );
}
