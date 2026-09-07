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
  | "missing_data";

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
};

/** ลำดับชิปตัวกรองในหน้า 🔔 แจ้งเตือน — เรียงตาม "ต้องลงมือทำ" ก่อน "รับทราบ" */
export const KIND_FILTER_ORDER: InboxKind[] = [
  "approval_request",
  "edit_request",
  "reject",
  "deviation",
  "missing_data",
  "overdue",
  "stuck",
  "arrival",
  "station",
  "job_new",
  "job_plan",
  "approval_result",
  "edit_reviewed",
];
