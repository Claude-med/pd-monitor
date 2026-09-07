import { createClient } from "@/lib/supabase/server";
import { STATUS_LABEL } from "@/lib/data/job-constants";
import { hasAnyRole } from "@/lib/auth/roles";
import type { Profile } from "@/lib/auth/dal";
import { STUCK_DAYS, type InboxItem } from "@/lib/data/notification-constants";
import { fmtDate, displayJobNo, stripJobNo } from "@/lib/format";

// B4 + Part Notification — Notification (in-app inbox)
//   stored  = แจ้งเตือนถาวรจาก event ใน DB — อ่านผ่าน RPC get_inbox() (0087)
//   derived = คำนวณสด (งานเกินกำหนด / ค้างสถานะนาน) — ไม่เก็บตาราง ไม่นับใน badge
export type { InboxItem };

/** จำนวนรายการ stored ที่ดึงมาแสดงต่อหนึ่งหน้า */
export const INBOX_PAGE_SIZE = 30;

/** จำนวนรายการ stored สูงสุดที่ดึงได้ — ต้องไม่เกินเพดานใน get_inbox() (0087) */
export const INBOX_MAX = 200;

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
        title: `งาน ${displayJobNo(j.job_no)} เลยกำหนดเสร็จแล้ว`,
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
        title: `งาน ${displayJobNo(j.job_no)} ค้างสถานะนานเกิน ${STUCK_DAYS} วัน`,
        body: `สถานะ "${STATUS_LABEL[j.status] ?? j.status}" ไม่ขยับตั้งแต่ ${fmtDate(
          j.updated_at,
        )}`,
        job_no: j.job_no,
        created_at: j.updated_at,
        read: true,
        source: "derived",
      });
    }
  }
  return out;
}

export type Inbox = {
  items: InboxItem[];
  /** ยังมี stored เก่ากว่านี้ให้โหลดต่อไหม (ใช้โชว์ปุ่ม "โหลดเพิ่ม") */
  hasMore: boolean;
};

/**
 * กล่องแจ้งเตือนรวม (stored + derived) เรียงใหม่สุดก่อน
 *
 * 🔑 การกรอง "ใครเห็นใบไหน" และ "ใบไหนหมดหน้าที่แล้ว" ทำที่ SQL ทั้งหมด (RPC get_inbox · 0087)
 *    ของเดิมดึง 50 แถวแล้วค่อยกรองในหน่วยความจำ ⇒ เห็นน้อยกว่าเลขบนกระดิ่งเสมอ
 *    และตรรกะ stale ถูกเขียนซ้ำ 2 ภาษา · ตอนนี้เหลือแหล่งเดียวคือ SQL
 *
 * derived (overdue/stuck) ไม่มีการแบ่งหน้า — คำนวณจากงานที่ยังไม่เข้าคลังทั้งหมดในครั้งเดียว
 */
export async function getInbox(
  profile: Profile,
  limit: number = INBOX_PAGE_SIZE,
): Promise<Inbox> {
  const supabase = await createClient();
  const capped = Math.min(Math.max(limit, 1), INBOX_MAX);

  const [{ data: rows }, derived] = await Promise.all([
    // ขอเกินมา 1 แถวเพื่อรู้ว่ายังมีของเก่ากว่านี้อีกไหม โดยไม่ต้องยิง count แยก
    supabase.rpc("get_inbox", { p_limit: capped + 1, p_before: null }),
    getDerivedAlerts(profile),
  ]);

  const all = (rows ?? []) as any[];
  const hasMore = all.length > capped && capped < INBOX_MAX;

  const stored: InboxItem[] = all.slice(0, capped).map((n) => ({
    id: n.id,
    kind: n.kind,
    // หัวข้อจาก SQL ฝังเลขงานจริงไว้ในข้อความ (เช่น "งาน P690001 ถูกตีกลับ")
    // แทนที่ตอนอ่านให้เหลือเลขเปล่า — ถูกกว่าไปแก้ฟังก์ชันแจ้งเตือนทุกตัวใน migration เก่า
    title: stripJobNo(n.title, n.job_no),
    body: stripJobNo(n.body, n.job_no),
    job_no: n.job_no,
    created_at: n.created_at,
    read: n.read === true,
    source: "stored",
  }));

  const items = [...stored, ...derived].sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );

  return { items, hasMore };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
