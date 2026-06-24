import { getProfile } from "@/lib/auth/dal";
import { getInbox } from "@/lib/data/notifications";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { InboxView } from "./inbox-view";

export const metadata = { title: "แจ้งเตือน — PD Monitor" };

export default async function InboxPage() {
  const profile = await getProfile();
  if (!profile) return null;

  const items = await getInbox(profile);
  const hasUnread = items.some((i) => i.source === "stored" && !i.read);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <RealtimeRefresh tables={["notifications", "notification_reads", "jobs"]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">🔔 แจ้งเตือน</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          งานถูกตีกลับ · deviation สำคัญ · งานเกินกำหนด/ค้างนาน (เฉพาะที่เกี่ยวกับหน้าที่คุณ)
        </p>
      </div>
      <InboxView items={items} hasUnread={hasUnread} />
    </div>
  );
}
