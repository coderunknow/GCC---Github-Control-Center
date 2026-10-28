import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trung tâm điều khiển GitHub',
  description: 'Bảng điều khiển GitHub cho một người dùng: kho mã, vấn đề, pull request, CI/CD và báo cáo.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <div className="layout">{children}</div>
      </body>
    </html>
  );
}
