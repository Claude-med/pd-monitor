import { createClient } from "@/lib/supabase/server";
import { STATUS_LABEL } from "@/lib/data/job-constants";
import { hasAnyRole } from "@/lib/auth/roles";
import type { Profile } from "@/lib/auth/dal";
import { STUCK_DAYS, type InboxItem } from "@/lib/data/notification-constants";

// B4 — Notification (in-app inbox)
//   stored  = แจ้งเตือนถาวรจาก event (reject / deviation) เก็บใน notifications + อ่าน/ยังไม่อ่าน
//   derived = คำนวณสด (งานเกินกำหนด / ค้างสถานะนาน) — ไม่เก็บตาราง
export type { InboxItem };

/** จำนวนแจ้งเตือน (stored) ที่ยังไม่อ่านของผู้ใช้ปัจจุบัน — สำหรับกระดิ่ง */
export async function getUnreadCount(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unread_notification_count");
  if (error || data == null) return 0;
  return Number(data);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** คำนวณงานเกินกำหนด/ค้างนาน (เฉพาะคนที่เกี่ยว = ฝ่ายผลิต/ผู้บริหาร) */
async function getDerivedAlerts(profile: Profile): Promise<InboxItem[]> {
  if (!hasAnyRole(profile.roles, ["production", "manager"])) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("id, job_no, status, planned_end, updated_at")
    .neq("status", "finished_goods");

  const today = todayISO();
  const stuckBefore = new Date(
    Date.now() - STUCK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const out: InboxItem[] = [];
  for (const j of (data ?? []) as any[]) {
    if (j.planned_end && j.planned_end < today) {
      out.push({
        id: `overdue-${j.id}`,
        kind: "overdue",
        title: `งาน ${j.job_no} เลยกำหนดเสร็จแล้ว`,
        body: `แผนเสร็จ ${j.planned_end} · สถานะปัจจุบัน: ${STATUS_LABEL[j.status] ?? j.status}`,
        job_no: j.job_no,
        created_at: j.planned_end,
        read: true,
        source: "derived",
      });
    } else if (j.updated_at && j.updated_at < stuckBefore) {
      // เตือน "ค้างนาน" เฉพาะงานที่ยังไม่ overdue (กันซ้ำ)
      out.push({
        id: `stuck-${j.id}`,
        kind: "stuck",
        title: `งาน ${j.job_no} ค้างสถานะนานเกิน ${STUCK_DAYS} วัน`,
        body: `สถานะ "${STATUS_LABEL[j.status] ?? j.status}" ไม่ขยับตั้งแต่ ${new Date(
          j.updated_at,
        ).toLocaleDateString("th-TH")}`,
        job_no: j.job_no,
        created_at: j.updated_at,
        read: true,
        source: "derived",
      });
    }
  }
  return out;
}

/** กล่องแจ้งเตือนรวม (stored + derived) เรียงใหม่สุดก่อน */
export async function getInbox(profile: Profile): Promise<InboxItem[]> {
  const supabase = await createClient();

  const [{ data: notifs }, { data: reads }, derived] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, kind, title, body, job_no, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("notification_reads").select("notification_id"),
    getDerivedAlerts(profile),
  ]);

  const readSet = new Set(
    ((reads ?? []) as any[]).map((r) => r.notification_id),
  );

  const stored: InboxItem[] = ((notifs ?? []) as any[]).map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    job_no: n.job_no,
    created_at: n.created_at,
    read: readSet.has(n.id),
    source: "stored",
  }));

  return [...stored, ...derived].sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
