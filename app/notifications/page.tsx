import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { GitHubErrorNotice, SetupRequired } from '@/components/errors';
import { Badge, Empty, Notice, Panel, ScopeNote } from '@/components/ui';
import { fetchNotifications, type NotificationItem } from '@/lib/queries';
import { databaseStatus, safeViewer } from '@/lib/page';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const REASON_LABELS: Record<string, string> = {
  assign: 'được gán',
  author: 'bạn là tác giả',
  ci_activity: 'hoạt động CI',
  comment: 'bình luận',
  invitation: 'lời mời',
  manual: 'thủ công',
  mention: 'được nhắc',
  review_requested: 'được yêu cầu review',
  security_alert: 'cảnh báo bảo mật',
  state_change: 'đổi trạng thái',
  subscribed: 'theo dõi',
  team_mention: 'nhắc nhóm',
};

function Group({ title, items }: { title: string; items: NotificationItem[] }) {
  if (items.length === 0) return null;
  return (
    <Panel title={`${title} (${items.length})`}>
      <ul className="plain-list">
        {items.map((item) => (
          <li key={item.id}>
            {item.subjectUrl ? (
              <a href={item.subjectUrl} target="_blank" rel="noreferrer noopener">
                {item.subjectTitle}
              </a>
            ) : (
              item.subjectTitle
            )}
            <div className="muted small">
              {item.repository} · {item.subjectType} · {REASON_LABELS[item.reason] ?? item.reason} ·{' '}
              {relativeTime(item.updatedAt)}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default async function NotificationsPage() {
  const [viewer, db] = await Promise.all([safeViewer(), Promise.resolve(databaseStatus())]);

  let data: Awaited<ReturnType<typeof fetchNotifications>> | null = null;
  let error: unknown = null;
  try {
    data = await fetchNotifications();
  } catch (err) {
    error = err;
  }

  const unread = data?.items.filter((item) => item.unread) ?? [];
  const byReason = new Map<string, NotificationItem[]>();
  for (const item of unread) {
    const list = byReason.get(item.reason) ?? [];
    list.push(item);
    byReason.set(item.reason, list);
  }

  return (
    <Shell active="/notifications" viewer={viewer} databaseAvailable={db.available}>
      <div className="page-head">
        <h1>Thông báo</h1>
        <p className="lede">
          Thông báo chưa đọc của tài khoản. Ứng dụng chỉ đọc: không có thao tác đánh dấu đã đọc hay tắt thông báo.
        </p>
      </div>

      <SetupRequired />
      {error ? <GitHubErrorNotice error={error} /> : null}

      {data?.permissionLimited ? (
        <Notice tone="warn" title="Không đọc được thông báo.">
          Token hiện tại thiếu scope <span className="mono">notifications</span> (hoặc là fine-grained token không có
          quyền Notifications). Đây là hạn chế quyền, không phải “không có thông báo”.
        </Notice>
      ) : null}

      {data && !data.permissionLimited ? (
        unread.length === 0 ? (
          <Panel>
            <Empty>Không có thông báo chưa đọc nào — GitHub trả về danh sách rỗng.</Empty>
            <ScopeNote scope={data.scope} fetchedAt={data.fetchedAt} />
          </Panel>
        ) : (
          <>
            {[...byReason.entries()]
              .sort((a, b) => b[1].length - a[1].length)
              .map(([reason, items]) => (
                <Group key={reason} title={REASON_LABELS[reason] ?? reason} items={items} />
              ))}
            <Panel>
              <ScopeNote
                scope={`${data.scope} ${unread.length} thông báo chưa đọc đã tải.`}
                fetchedAt={data.fetchedAt}
              />
              <p className="muted small" style={{ marginBottom: 0 }}>
                Đây là ảnh chụp tại thời điểm tải, không phải luồng thời gian thực. Không có webhook nào được cấu hình
                nên không có cập nhật đẩy.
              </p>
            </Panel>
          </>
        )
      ) : null}

      {data && data.permissionLimited ? (
        <Panel>
          <p className="muted small" style={{ margin: 0 }}>
            Để bật: tạo token classic với scope <span className="mono">notifications</span> và cập nhật{' '}
            <span className="mono">GITHUB_TOKEN</span>. Xem <Link href="/health">Tình trạng</Link>.
          </p>
        </Panel>
      ) : null}
    </Shell>
  );
}
