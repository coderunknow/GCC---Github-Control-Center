import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { Badge, Panel, ScopeNote } from '@/components/ui';
import { githubConfigured, fetchRateLimit, describeError } from '@/lib/github';
import { databaseStatus, safeViewer } from '@/lib/page';

export const dynamic = 'force-dynamic';

type Status = 'ok' | 'warn' | 'off' | 'bad';

function tone(status: Status): 'good' | 'warn' | 'muted' | 'bad' {
  return status === 'ok' ? 'good' : status === 'warn' ? 'warn' : status === 'bad' ? 'bad' : 'muted';
}

function Row({ label, status, detail }: { label: string; status: Status; detail: React.ReactNode }) {
  return (
    <tr>
      <td className="nowrap">{label}</td>
      <td>
        <Badge tone={tone(status)}>
          {status === 'ok' ? 'hoạt động' : status === 'warn' ? 'hạn chế' : status === 'bad' ? 'lỗi' : 'tắt'}
        </Badge>
      </td>
      <td className="small">{detail}</td>
    </tr>
  );
}

export default async function HealthPage() {
  const [viewer, db] = await Promise.all([safeViewer(), Promise.resolve(databaseStatus())]);

  const githubReady = githubConfigured();
  let rateLimit: Awaited<ReturnType<typeof fetchRateLimit>> = null;
  let rateLimitError: string | null = null;
  if (githubReady) {
    try {
      rateLimit = await fetchRateLimit();
    } catch (err) {
      rateLimitError = describeError(err).message;
    }
  }

  const authReady = Boolean(process.env.APP_PASSWORD && process.env.SESSION_SECRET);

  return (
    <Shell active="/health" viewer={viewer} databaseAvailable={db.available}>
      <div className="page-head">
        <h1>Tình trạng hệ thống</h1>
        <p className="lede">
          Kiểm tra cấu hình thật của máy chủ này. Không hiển thị, không ghi log và không gửi bất kỳ token hay bí mật nào
          về trình duyệt.
        </p>
      </div>

      <Panel title="Thành phần" id="components">
        <div className="table-wrap">
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
                label="GitHub token"
                status={githubReady ? 'ok' : 'bad'}
                detail={
                  githubReady
                    ? 'Đã cấu hình GITHUB_TOKEN trên máy chủ (không hiển thị giá trị).'
                    : 'Thiếu GITHUB_TOKEN. Toàn bộ dữ liệu GitHub sẽ không tải được.'
                }
              />
              <Row
                label="Xác thực phiên"
                status={authReady ? 'ok' : 'bad'}
                detail={
                  authReady
                    ? 'APP_PASSWORD và SESSION_SECRET đã đặt; cookie phiên được ký HMAC.'
                    : 'Thiếu APP_PASSWORD hoặc SESSION_SECRET — ứng dụng đóng lại, mọi yêu cầu bị coi là chưa đăng nhập.'
                }
              />
              <Row
                label="Tài khoản GitHub"
                status={viewer ? 'ok' : githubReady ? 'warn' : 'off'}
                detail={viewer ? `Đọc được tài khoản @${viewer.login}.` : 'Chưa đọc được /user (kiểm tra token hoặc mạng).'}
              />
              <Row
                label="Hạn mức API"
                status={rateLimit ? (rateLimit.remaining > 50 ? 'ok' : 'warn') : 'off'}
                detail={
                  rateLimit ? (
                    <>
                      REST core: {rateLimit.core.remaining}/{rateLimit.core.limit} — đặt lại lúc{' '}
                      {new Date(rateLimit.core.resetAt).toLocaleString('vi-VN')}.
                      {rateLimit.graphql ? (
                        <>
                          {' '}
                          GraphQL: {rateLimit.graphql.remaining}/{rateLimit.graphql.limit}.
                        </>
                      ) : null}
                      {rateLimit.search ? (
                        <>
                          {' '}
                          Search: {rateLimit.search.remaining}/{rateLimit.search.limit}.
                        </>
                      ) : null}
                    </>
                  ) : (
                    rateLimitError ?? 'Chưa kiểm tra.'
                  )
                }
              />
              <Row
                label="Cơ sở dữ liệu"
                status={db.available ? 'ok' : 'off'}
                detail={db.detail}
              />
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Điều gì hoạt động khi thiếu từng thành phần" id="degradation">
        <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            <strong>Thiếu GITHUB_TOKEN:</strong> mọi màn hình dữ liệu hiển thị hướng dẫn cấu hình. Không có số liệu giả
            nào được tạo.
          </li>
          <li>
            <strong>Thiếu DATABASE_URL:</strong> bảng điều khiển, kho mã, issue, PR, CI, release, tìm kiếm và xuất dữ
            liệu vẫn hoạt động. Lịch sử xuất và nhật ký kiểm toán bị tắt, và giao diện nói rõ điều đó.
          </li>
          <li>
            <strong>Thiếu quyền trên token:</strong> màn hình tương ứng báo “thiếu quyền”, phân biệt với “không có dữ
            liệu”.
          </li>
        </ul>
      </Panel>

      <Panel title="Nhật ký kiểm toán" id="audit">
        {db.available ? (
          <p className="small" style={{ marginTop: 0 }}>
            Nhật ký ghi lại mọi lần xuất dữ liệu. Xem bản ghi mới nhất qua{' '}
            <a href="/api/audit?limit=25">/api/audit</a> hoặc trang <Link href="/reports">Báo cáo</Link>.
          </p>
        ) : (
          <p className="small" style={{ marginTop: 0 }}>
            Nhật ký kiểm toán đang tắt vì chưa có <span className="mono">DATABASE_URL</span>. Không có bản ghi nào được
            tạo và không có bản ghi giả nào được hiển thị.
          </p>
        )}
        <ScopeNote scope="Chế độ chỉ đọc: ứng dụng không tạo commit, tag, release hay chạy workflow." />
      </Panel>
    </Shell>
  );
}
