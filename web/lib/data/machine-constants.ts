// ค่าคงที่ "สถานะเครื่องจักร" — ไฟล์นี้ "ไม่มี" server import → ใช้ได้ทั้ง Server/Client
// ตรงกับ enum machine_status ใน DB (0014_machines.sql)

export const MACHINE_STATUSES = [
  { key: "available", label: "พร้อมใช้", color: "#16a34a" },
  { key: "in_use", label: "กำลังใช้งาน", color: "#6366f1" },
  { key: "cleaning", label: "ทำความสะอาด", color: "#0ea5e9" },
  { key: "maintenance", label: "ซ่อมบำรุง", color: "#dc2626" },
  { key: "calibration_due", label: "ถึงกำหนดสอบเทียบ", color: "#f59e0b" },
] as const;

export type MachineStatus = (typeof MACHINE_STATUSES)[number]["key"];

export const MACHINE_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  MACHINE_STATUSES.map((s) => [s.key, s.label]),
);
export const MACHINE_STATUS_COLOR: Record<string, string> = Object.fromEntries(
  MACHINE_STATUSES.map((s) => [s.key, s.color]),
);

/** สถานะที่ "ห้ามเริ่มใช้เครื่อง" (ใช้ตอนผูกกับการบันทึกผลผลิตในก้อนถัดไป) */
export const MACHINE_BLOCKED_STATUSES = new Set<MachineStatus>([
  "maintenance",
  "calibration_due",
]);

/** อีกกี่วันจะถึงวันที่กำหนด (ติดลบ = เลยมาแล้ว) — null ถ้าไม่ได้ตั้งวันที่ */
export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const d = new Date(date + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}
