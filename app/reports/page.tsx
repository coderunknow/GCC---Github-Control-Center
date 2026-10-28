import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { GitHubErrorNotice } from '@/components/errors';
import { Badge, Empty, Notice, Panel, ScopeNote } from '@/components/ui';
import { getStore } from '@/lib/db';
import { listReportHistory } from '@/lib/db/history';
import { fetchRepositories } from '@/lib/queries';
import { databaseStatus, safeViewer } from '@/lib/page';
import { formatNumber, timestampWithRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

const EXPORTS = [
  { id: 'repos', label: 'Repository', description: 'Tên, hiển thị, ngôn ngữ, số sao, issue mở, lần push cuối.' },
  { id: 'issues', label: 'Issue', description: 'Issue đang mở hoặc đã đóng trong phạm vi tài khoản.' },
  { id: 'pulls', label: 'Pull request', description: 'PR kèm trạng thái nháp và thời điểm cập nhật.' },
  { id: 'actions', label: 'Workflow run', description: 'Run gần đây của các repository hoạt động tích cực nhất.' },
  { id: 'releases', label: 'Release', description: 'Release gần đây, gồm nháp và prerelease.' },
];

export default async function ReportsPage() {
  const [viewer, db] = await Promise.all([safeViewer(), Promise.resolve(databaseStatus())]);

  const store = getStore();
  const history = await listReportHistory(store, 20);

  let repoCount: number | null = null;
  let scopeNote = '';
  let repoError: unknown = null;
  try {
    const repos = await fetchRepositories(2);
    repoCount = repos.repos.length;
    scopeNote = repos.pageInfo.scope;
  } catch (err) {
    repoError = err;
  }

  return (
    <Shell active="/reports" viewer={viewer} databaseAvailable={db.available}>
      <div className="page-head">
        <h1>Báo cáo &amp; xuất dữ liệu</h1>
        <p className="lede">
          Tải dữ liệu thật dưới dạng CSV hoặc JSON. CSV được làm sạch để chặn công thức độc hại; không có token hay
          thông tin xác thực nào trong tệp xuất.
        </p>
      </div>

      {repoError ? <GitHubErrorNotice error={repoError} /> : null}

      <Panel title="Xuất dữ liệu" id="exports">
        {repoCount !== null ? (
          <p className="muted small" style={{ marginTop: 0 }}>
            Phạm vi: {scopeNote} {formatNumber(repoCount)} repository được xem xét.
          </p>
        ) : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Loại</th>
                <th>Nội dung</th>
                <th>Tải về</th>
              </tr>
            </thead>
            <tbody>
              {EXPORTS.map((item) => (
                <tr key={item.id}>
                  <td>{item.label}</td>
                  <td className="muted small">{item.description}</td>
                  <td className="nowrap">
                    <a className="button secondary" href={`/api/export/${item.id}?format=csv`}>
                      CSV
                    </a>{' '}
                    <a className="button secondary" href={`/api/export/${item.id}?format=json`}>
                      JSON
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Tệp xuất phản ánh đúng phạm vi đã tải. Nếu GitHub chỉ trả về một phần dữ liệu, tệp JSON ghi rõ điều đó trong
          trường <span className="mono">scope</span> thay vì trình bày như số liệu đầy đủ.
        </p>
      </Panel>

      <Panel title="Lịch sử xuất báo cáo" id="history">
        {!db.available ? (
          <Notice tone="warn" title="Lịch sử đang tắt.">
            {db.detail} Không có bản ghi lịch sử nào được tạo — và không có bản ghi giả nào để lấp chỗ trống. Xuất dữ
            liệu vẫn hoạt động bình thường, chỉ không được lưu lại.
          </Notice>
        ) : history.length === 0 ? (
          <Empty>Chưa có báo cáo nào được xuất trên hệ thống này.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Thời điểm</th>
                  <th>Loại</th>
                  <th>Định dạng</th>
                  <th className="num">Số dòng</th>
                  <th>SHA-256</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id}>
                    <td className="nowrap muted small">{timestampWithRelative(entry.createdAt)}</td>
                    <td>{entry.kind}</td>
                    <td>
                      <Badge tone="info">{entry.format}</Badge>
                    </td>
                    <td className="num">{formatNumber(entry.rowCount)}</td>
                    <td className="mono small">{entry.sha256Short}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {db.available ? <ScopeNote scope={db.detail} /> : null}
      </Panel>

      <Panel title="Giới hạn đã biết">
        <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>GitHub Search chỉ trả tối đa 1000 kết quả cho mỗi truy vấn.</li>
          <li>Số liệu tổng hợp theo repository chỉ tính trên các repository đã tải, không phải toàn bộ GitHub.</li>
          <li>
            Không truy cập được log hay artifact của Actions qua giao diện này. Mọi liên kết đều dẫn về GitHub.
          </li>
          <li>
            Nhật ký kiểm toán yêu cầu <span className="mono">DATABASE_URL</span>; khi thiếu, ứng dụng nói rõ là đang
            tắt thay vì giả vờ đã ghi.
          </li>
        </ul>
      </Panel>

      <p className="muted small">
        <Link href="/health">Xem tình trạng hệ thống</Link>
      </p>
    </Shell>
  );
}
