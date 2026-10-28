import { Shell } from '@/components/Shell';
import { authConfigured } from '@/lib/auth';
import { fetchRateLimit, githubConfigured } from '@/lib/github';

export const dynamic = 'force-dynamic';

function Row({
  name,
  status,
  tone,
  detail,
}: {
  name: string;
  status: string;
  tone: 'good' | 'warn' | 'bad' | '';
  detail: React.ReactNode;
}) {
  return (
    <tr>
      <td>{name}</td>
      <td>
        <span className={`pill ${tone}`}>{status}</span>
      </td>
      <td className="muted small">{detail}</td>
    </tr>
  );
}

export default async function HealthPage() {
  const hasGitHub = githubConfigured();
  const rate = hasGitHub ? await fetchRateLimit() : null;
  const hasDb = Boolean(process.env.DATABASE_URL);

  return (
    <Shell active="/health">
      <h1>Tình trạng tích hợp</h1>
      <p className="lede">
        Trạng thái thật của từng thành phần. Không có mục nào được đánh dấu “hoạt động” nếu chưa được kiểm chứng.
      </p>

      <section className="panel">
        <h2>Thành phần</h2>
        <table>
          <thead>
            <tr>
              <th>Thành phần</th>
              <th>Trạng thái</th>
              <th>Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            <Row
              name="Xác thực"
              status={authConfigured() ? 'Đã cấu hình' : 'Chưa cấu hình'}
              tone={authConfigured() ? 'good' : 'bad'}
              detail={
                authConfigured()
                  ? 'APP_PASSWORD và SESSION_SECRET đã được đặt trên máy chủ.'
                  : 'Thiếu APP_PASSWORD hoặc SESSION_SECRET. Mọi đăng nhập bị từ chối cho tới khi cấu hình xong.'
              }
            />
            <Row
              name="GitHub API"
              status={hasGitHub ? 'Đã cấu hình' : 'Chưa cấu hình'}
              tone={hasGitHub ? 'good' : 'bad'}
              detail={
                hasGitHub
                  ? 'Token chỉ tồn tại ở phía máy chủ và không bao giờ được gửi tới trình duyệt.'
                  : 'Thiếu GITHUB_TOKEN. Bảng điều khiển sẽ không hiển thị dữ liệu.'
              }
            />
            <Row
              name="Hạn mức GitHub"
              status={rate ? `${rate.remaining}/${rate.limit}` : 'Không đọc được'}
              tone={rate ? (rate.remaining > rate.limit * 0.2 ? 'good' : 'warn') : ''}
              detail={
                rate ? `Hạn mức còn lại, đặt lại lúc ${new Date(rate.resetAt).toLocaleString('vi-VN')}.` : 'Không gọi được /rate_limit.'
              }
            />
            <Row
              name="Cơ sở dữ liệu"
              status={hasDb ? 'Đã cấu hình' : 'Chưa cấu hình'}
              tone={hasDb ? 'good' : 'warn'}
              detail={
                hasDb
                  ? 'DATABASE_URL đã được đặt. Lịch sử, thông báo và nhật ký kiểm toán dùng cơ sở dữ liệu này.'
                  : 'Chưa đặt DATABASE_URL. Bảng điều khiển vẫn chạy bằng dữ liệu trực tiếp từ GitHub, nhưng lịch sử, thông báo và nhật ký kiểm toán đang tắt.'
              }
            />
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Kết nối trực tiếp tới Arena Agent</h2>
        <div className="banner bad" style={{ marginBottom: 12 }}>
          <strong>BLOCKED</strong> — Arena không cung cấp cơ chế được hỗ trợ nào để bắt đầu một lượt
          Agent Mode từ một sự kiện bên ngoài. Ứng dụng này <strong>không</strong> giả lập việc gửi yêu cầu
          tới agent, và không chuyển yêu cầu sang một agent hay mô hình khác.
        </div>
        <table>
          <tbody>
            <tr>
              <td>Hàng đợi bền vững (GitHub Issues)</td>
              <td>
                <span className="pill good">Đã kiểm chứng</span>
              </td>
              <td className="muted small">
                Một yêu cầu thật đã được ghi nhận và được chính phiên Arena này xử lý — nhưng chỉ khi có người
                gửi tin nhắn để kích hoạt phiên.
              </td>
            </tr>
            <tr>
              <td>Kích hoạt phiên khi người dùng vắng mặt</td>
              <td>
                <span className="pill bad">Blocked</span>
              </td>
              <td className="muted small">
                Không có scheduler, webhook hay API phiên nào được tài liệu hoá. Thiếu đúng một năng lực: khả
                năng bắt đầu lượt agent từ sự kiện bên ngoài.
              </td>
            </tr>
            <tr>
              <td>API mô hình thay thế</td>
              <td>
                <span className="pill">Không dùng</span>
              </td>
              <td className="muted small">Bị loại trừ bởi yêu cầu gốc: không thay thế agent bằng API mô hình.</td>
            </tr>
          </tbody>
        </table>
        <p className="muted small" style={{ marginTop: 12 }}>
          Chi tiết đầy đủ: <span className="mono">docs/ARENA_AGENT_CONNECTIVITY.md</span>.
        </p>
      </section>
    </Shell>
  );
}
