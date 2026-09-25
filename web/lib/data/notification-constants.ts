// ค่าคงที่ Notification (B4 + Part Notification) — ไม่มี server import → ใช้ได้ทั้ง client/server

/** งานที่ "ค้างสถานะ" เกินกี่วันถือว่าควรเตือน */
export const STUCK_DAYS = 3;

export type InboxItem = {
  id: string;
  kind: InboxKind;
  title: string;
  body: string | null;
  job_no: string | null;
  created_at: string | null;
  read: boolean; // derived = ถือว่าอ่านแล้ว (ไม่นับใน badge)
  source: "stored" | "derived";
};

export type InboxKind =
  | "reject"
  | "deviation"
  | "overdue"
  | "stuck"
  | "arrival"
  | "edit_request"
  | "edit_reviewed"
  // Part Notification (0084–0086)
  | "approval_request"
  | "approval_result"
  | "job_new"
  | "job_plan"
  | "station"
  | "missing_data"
  // Part F (0092)
  | "material_request"
  | "qc_due"
  | "product_new"
  | "machine_due";

/**
 * ป้าย/ไอคอน/สีของแจ้งเตือนแต่ละชนิด
 *
 * ⚠️ key ต้องตรงกับค่าที่ SQL ใส่ลง notifications.kind (เป็น text ไม่มี CHECK constraint)
 *    เพิ่ม kind ใหม่ = เพิ่มที่นี่ที่เดียว · แถวที่ไม่รู้จักจะ fallback เป็นสีเทาใน inbox-view
 * ⚠️ ห้ามเปลี่ยน key "deviation" — เป็นค่าที่ลงในแถวเก่าไปแล้ว
 *    เปลี่ยนได้แค่ label ที่ผู้ใช้เห็น (Part C.4 เปลี่ยนชื่อเป็น Incident Case)
 */
export const KIND_META: Record<
  InboxKind,
  { label: string; icon: string; color: string }
> = {
  reject: { label: "งานถูกตีกลับ", icon: "↩️", color: "#ef4444" },
  deviation: { label: "Incident Case", icon: "⚠️", color: "#f59e0b" },
  overdue: { label: "เกินกำหนด", icon: "⏰", color: "#ef4444" },
  stuck: { label: "ค้างนาน", icon: "🐢", color: "#f59e0b" },
  arrival: { label: "งานมาถึงคุณ", icon: "📥", color: "#0ea5e9" },
  edit_request: { label: "คำขอแก้ไข", icon: "✏️", color: "#f59e0b" },
  edit_reviewed: { label: "ผลคำขอแก้ไข", icon: "📝", color: "#0ea5e9" },
  approval_request: { label: "รออนุมัติ", icon: "⏳", color: "#f59e0b" },
  approval_result: { label: "ผลการอนุมัติ", icon: "✅", color: "#16a34a" },
  job_new: { label: "งานใหม่", icon: "🆕", color: "#6366f1" },
  job_plan: { label: "แผนเปลี่ยน", icon: "📅", color: "#a855f7" },
  station: { label: "งานเข้าสถานี", icon: "🏭", color: "#0ea5e9" },
  missing_data: { label: "ข้อมูลไม่ครบ", icon: "📋", color: "#ef4444" },
  material_request: { label: "ขอเบิกวัตถุดิบ", icon: "🧾", color: "#f59e0b" },
  qc_due: { label: "รอตรวจ In-process", icon: "🔬", color: "#f59e0b" },
  product_new: { label: "ผลิตภัณฑ์ใหม่", icon: "🧪", color: "#6366f1" },
  machine_due: { label: "เครื่องถึงกำหนด", icon: "🛠️", color: "#f59e0b" },
};

/** ลำดับชิปตัวกรองในหน้า 🔔 แจ้งเตือน — เรียงตาม "ต้องลงมือทำ" ก่อน "รับทราบ" */
export const KIND_FILTER_ORDER: InboxKind[] = [
  "approval_request",
  "edit_request",
  "material_request",
  "qc_due",
  "machine_due",
  "reject",
  "deviation",
  "missing_data",
  "overdue",
  "stuck",
  "arrival",
  "station",
  "job_new",
  "job_plan",
  "product_new",
  "approval_result",
  "edit_reviewed",
];

/** ส่วนในหน้างานที่รายการรออนุมัติอยู่ — ใช้เป็นทั้ง ?pending= และ #anchor (Part H) */
export type PendingFocus = "records" | "inprocess" | "qa-sample" | "lc";

export const PENDING_FOCUS: PendingFocus[] = ["records", "inprocess", "qa-sample", "lc"];

/**
 * ลิงก์ของแจ้งเตือนหนึ่งใบ — Part H: พาไป "ตรงจุด" แทนหน้างานเฉย ๆ
 *   · คำขอแก้ไข (edit_request) → แท็บ คำขอแก้ไข (Amendment)
 *   · รออนุมัติ (approval_request) → /board/X?pending=<ส่วน>#<ส่วน> (หน้างานเลือกขั้นตอนที่มีของรอให้เอง)
 *   · ผลอนุมัติ / ผลคำขอ → /board/X#<ส่วน>
 *
 * ⚠️ ตารางแจ้งเตือนไม่มีคอลัมน์ลิงก์/สถานี — แยกส่วนจาก "คำขึ้นต้นหัวข้อ" ที่ SQL เขียนไว้
 *    (0085 · 0092 · 0096 · 0099) ถ้าเพิ่มแจ้งเตือนชนิดใหม่ ให้เพิ่มคำขึ้นต้นที่นี่ด้วย
 *    หัวข้อที่ไม่ตรงแบบไหนเลย → ตกกลับเป็นลิงก์หน้างานเฉย ๆ เหมือนเดิม (ไม่พัง)
 */
export function notificationHref(item: InboxItem): string | null {
  if (item.kind === "edit_request") return "/edit-requests";
  if (!item.job_no) return null;
  const base = `/board/${encodeURIComponent(item.job_no)}`;
  const t = item.title;
  const focus: PendingFocus | null = t.startsWith("บันทึกผลผลิต")
    ? "records"
    : t.startsWith("ผลตรวจ")
      ? "inprocess"
      : t.startsWith("จุดเก็บตัวอย่าง")
        ? "qa-sample"
        : t.startsWith("Line Clearance")
          ? "lc"
          : null;
  if (!focus) return base;
  if (item.kind === "approval_request") return `${base}?pending=${focus}#${focus}`;
  if (item.kind === "approval_result") return `${base}#${focus}`;
  return base;
}
