// ค่าคงที่ของ "ผลตรวจระหว่างผลิต (in-process QC)" — Part C.3 ก้อน 6
//
// ⚠️ ไฟล์นี้ "ไม่มี" server import โดยตั้งใจ → ใช้ได้ทั้ง Server และ Client Components
//    ห้ามย้ายกลับไปไว้ใน lib/data/quality-checks.ts เพราะไฟล์นั้น import
//    lib/supabase/server (next/headers) — client component ที่ import ค่าคงที่จากที่นั่น
//    จะลาก server client เข้า bundle แล้ว build ล้มทันที

/** ตรงกับ enum inprocess_status ใน DB (0064) */
export type InprocessStatus = "pending" | "approved" | "rejected";

export const INPROCESS_STATUS_META: Record<
  InprocessStatus,
  { label: string; color: string }
> = {
  pending: { label: "รอหัวหน้า QC อนุมัติ", color: "#f59e0b" },
  approved: { label: "อนุมัติแล้ว", color: "#16a34a" },
  rejected: { label: "ไม่อนุมัติ", color: "#dc2626" },
};
