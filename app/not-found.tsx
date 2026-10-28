import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main">
      <div className="page-head">
        <h1>Không tìm thấy trang</h1>
        <p className="lede">
          Đường dẫn này không tồn tại. Nếu bạn theo một liên kết tới repository, issue hoặc pull request, có thể nó đã
          bị xoá hoặc đổi tên trên GitHub.
        </p>
      </div>
      <p>
        <Link className="button" href="/">
          Về trang tổng quan
        </Link>
      </p>
    </main>
  );
}
