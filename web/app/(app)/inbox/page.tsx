import { getProfile } from "@/lib/auth/dal";
import { getInbox, INBOX_PAGE_SIZE } from "@/lib/data/notifications";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { InboxView } from "./inbox-view";

export const metadata = { title: "แจ้งเตือน — PD Monitor" };

/**
 * จำนวนรายการที่โหลดมาแสดง คุมด้วย searchParam `?n=` — ปุ่ม "โหลดเพิ่ม" เป็นลิงก์ธรรมดา
 * (ไม่ต้องมี client state · ทำงานร่วมกับ RealtimeRefresh ที่สั่ง router.refresh() ได้เลย)
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ n?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) return null;

  const { n } = await searchParams;
  const parsed = Number(n);
  const limit =
    Number.isFinite(parsed) && parsed > 0 ? parsed : INBOX_PAGE_SIZE;

  const { items, hasMore } = await getInbox(profile, limit);
  const hasUnread = items.some((i) => i.source === "stored" && !i.read);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <RealtimeRefresh
        tables={["notifications", "notification_reads", "jobs", "fg_inventory"]}
      />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">🔔 แจ้งเตือน</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          เรื่องที่เกี่ยวกับหน้าที่ของคุณ — ของรออนุมัติ · งานถูกตีกลับ · Incident Case ·
          งานเข้าสถานี · แผนเปลี่ยน · งานเกินกำหนด/ค้างนาน
        </p>
      </div>
      <InboxView
        items={items}
        hasUnread={hasUnread}
        hasMore={hasMore}
        nextLimit={limit + INBOX_PAGE_SIZE}
      />
    </div>
  );
}
