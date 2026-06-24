import type { AppRole } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";

// ค่าคงที่ของ Deviation (B3) — ไม่มี server import → ใช้ได้ทั้ง client/server
// ตรงกับ enum deviation_severity / deviation_status ใน migration 0025

/** ระดับความรุนแรง */
export const DEVIATION_SEVERITY = [
  { key: "minor", label: "เล็กน้อย", color: "#16a34a" },
  { key: "major", label: "ปานกลาง", color: "#f59e0b" },
  { key: "critical", label: "ร้ายแรง", color: "#ef4444" },
] as const;

/** สถานะของ deviation */
export const DEVIATION_STATUS = [
  { key: "open", label: "เปิด", color: "#ef4444" },
  { key: "investigating", label: "กำลังสอบสวน", color: "#f59e0b" },
  { key: "closed", label: "ปิดแล้ว", color: "#16a34a" },
] as const;

/** ประเภทเหตุผิดปกติ */
export const DEVIATION_TYPES = [
  { key: "in_process_fail", label: "ผลตรวจระหว่างผลิตไม่ผ่าน" },
  { key: "equipment", label: "เครื่องจักร/อุปกรณ์" },
  { key: "material", label: "วัตถุดิบ/บรรจุภัณฑ์" },
  { key: "process", label: "กระบวนการผลิต" },
  { key: "other", label: "อื่นๆ" },
] as const;

export type DeviationSeverity = (typeof DEVIATION_SEVERITY)[number]["key"];
export type DeviationStatus = (typeof DEVIATION_STATUS)[number]["key"];

export const SEVERITY_LABEL: Record<string, string> = Object.fromEntries(
  DEVIATION_SEVERITY.map((s) => [s.key, s.label]),
);
export const SEVERITY_COLOR: Record<string, string> = Object.fromEntries(
  DEVIATION_SEVERITY.map((s) => [s.key, s.color]),
);
export const DEV_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  DEVIATION_STATUS.map((s) => [s.key, s.label]),
);
export const DEV_STATUS_COLOR: Record<string, string> = Object.fromEntries(
  DEVIATION_STATUS.map((s) => [s.key, s.color]),
);
export const DEV_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  DEVIATION_TYPES.map((t) => [t.key, t.label]),
);

/** เปิด deviation ได้: production/qc/qa/manager (admin ผ่านเสมอ) */
export function canOpenDeviation(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["production", "qc", "qa", "manager"]);
}

/** ปิด deviation ได้เฉพาะ: qa/manager (admin ผ่านเสมอ) */
export function canCloseDeviation(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["qa", "manager"]);
}
