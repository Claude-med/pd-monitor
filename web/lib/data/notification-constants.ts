// ค่าคงที่ Notification (B4) — ไม่มี server import → ใช้ได้ทั้ง client/server

/** งานที่ "ค้างสถานะ" เกินกี่วันถือว่าควรเตือน */
export const STUCK_DAYS = 3;

export type InboxItem = {
  id: string;
  kind:
    | "reject"
    | "deviation"
    | "overdue"
    | "stuck"
    | "arrival"
    | "edit_request"
    | "edit_reviewed";
  title: string;
  body: string | null;
  job_no: string | null;
  created_at: string | null;
  read: boolean; // derived = ถือว่าอ่านแล้ว (ไม่นับใน badge)
  source: "stored" | "derived";
};

export const KIND_META: Record<
  InboxItem["kind"],
  { label: string; icon: string; color: string }
> = {
  reject: { label: "งานถูกตีกลับ", icon: "↩️", color: "#ef4444" },
  deviation: { label: "Deviation", icon: "⚠️", color: "#f59e0b" },
  overdue: { label: "เกินกำหนด", icon: "⏰", color: "#ef4444" },
  stuck: { label: "ค้างนาน", icon: "🐢", color: "#f59e0b" },
  arrival: { label: "งานมาถึงคุณ", icon: "📥", color: "#0ea5e9" },
  edit_request: { label: "คำขอแก้ไข", icon: "✏️", color: "#f59e0b" },
  edit_reviewed: { label: "ผลคำขอแก้ไข", icon: "📝", color: "#0ea5e9" },
};
