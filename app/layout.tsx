import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trung tâm điều khiển GitHub',
  description: 'Bảng điều khiển GitHub cho một người dùng: kho mã, issue, pull request, CI/CD và báo cáo.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0b0f14',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
