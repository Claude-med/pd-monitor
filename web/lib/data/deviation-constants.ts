import type { AppRole } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";

// ค่าคงที่ของ Incident Case (เดิมชื่อ Deviation — B3) — ไม่มี server import → ใช้ได้ทั้ง client/server
//
// ℹ️ ชื่อไฟล์/ตาราง/ฟังก์ชันฝั่ง DB ยังเป็น "deviation" ทั้งหมดโดยตั้งใจ (Part C.4)
//    เพราะ audit_log.table_name ของแถวประวัติเก่าเก็บค่า 'deviations' ไว้ —
//    เปลี่ยนชื่อแล้วประวัติจะขาดตอน · "Incident Case" เป็นชื่อที่ผู้ใช้เห็นเท่านั้น
//
// ตรงกับ enum deviation_severity / incident_status ใน migration 0025 · 0067

/** ระดับความรุนแรง */
export const DEVIATION_SEVERITY = [
  { key: "minor", label: "เล็กน้อย", color: "#16a34a" },
  { key: "major", label: "ปานกลาง", color: "#f59e0b" },
  { key: "critical", label: "ร้ายแรง", color: "#ef4444" },
] as const;

/**
 * สถานะของ Incident Case — flow ใหม่ Part C.4 (0067)
 *   เปิด → QA ตรวจสอบ → ส่งแผนกที่เกี่ยวข้องแก้ไข → ส่งกลับ QA → QA อนุมัติ
 * แทนที่ชุดเดิม 3 ค่า (open / investigating / closed) ทั้งหมด
 */
export const DEVIATION_STATUS = [
  { key: "qa_review", label: "รอ QA ตรวจสอบ", color: "#f59e0b" },
  { key: "in_progress", label: "ส่งแผนกแก้ไข", color: "#0ea5e9" },
  { key: "qa_verify", label: "รอ QA อนุมัติ", color: "#a855f7" },
  { key: "closed", label: "ปิดแล้ว", color: "#16a34a" },
  { key: "cancelled", label: "ยกเลิก", color: "#64748b" },
] as const;

/** ประเภทเหตุผิดปกติ (สาเหตุ) — คนละแกนกับประเภทเอกสาร DEV/OOS/NC ที่ QA คัดแยกในก้อน 5 */
export const DEVIATION_TYPES = [
  { key: "in_process_fail", label: "ผลตรวจระหว่างผลิตไม่ผ่าน" },
  { key: "qa_sample_fail", label: "ตรวจ Finished product ไม่ผ่าน" },
  { key: "equipment", label: "เครื่องจักร/อุปกรณ์" },
  { key: "material", label: "วัตถุดิบ/บรรจุภัณฑ์" },
  { key: "process", label: "กระบวนการผลิต" },
  { key: "other", label: "อื่นๆ" },
] as const;

export type DeviationSeverity = (typeof DEVIATION_SEVERITY)[number]["key"];
export type DeviationStatus = (typeof DEVIATION_STATUS)[number]["key"];

/** สถานะที่ถือว่า "จบแล้ว" — ต้องตรงกับ has_open_deviation() ใน DB (ด่าน QA→FG ใช้ตัวนั้น) */
export const DEVIATION_DONE_STATUSES: readonly string[] = ["closed", "cancelled"];

export function isDeviationOpen(status: string): boolean {
  return !DEVIATION_DONE_STATUSES.includes(status);
}

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

/**
 * ป้ายฝ่ายของหมายเหตุ Incident Case — ต้องมีครบทุกค่าที่ current_role_group() คืนได้ (0067)
 * ก่อน Part C.4 ฟังก์ชันนั้นรู้จักแค่ 4 ฝ่าย ที่เหลือคอมเมนต์ไม่ได้เลย
 */
export const NOTE_ROLE_META: Record<string, { label: string; color: string }> = {
  production: { label: "ฝ่ายผลิต", color: "#f59e0b" },
  qc: { label: "QC", color: "#0ea5e9" },
  qa: { label: "QA", color: "#a855f7" },
  engineering: { label: "วิศวกรรม", color: "#0f766e" },
  warehouse: { label: "คลัง", color: "#7c3aed" },
  planner: { label: "ฝ่ายวางแผน", color: "#2563eb" },
  cost: { label: "บัญชีต้นทุน", color: "#a16207" },
  manager: { label: "ผู้บริหาร", color: "#64748b" },
  other: { label: "อื่นๆ", color: "#94a3b8" },
};

/**
 * เปิด Incident Case ได้ = ทุกคนที่ล็อกอิน (Part C.4)
 * ตรงกับ guard ใน open_deviation() ที่เช็กแค่ current_profile_id() is not null
 * (แพทเทิร์นเดียวกับ canManageJobSubStatuses ใน role-access.ts)
 */
export function canOpenDeviation(roles: AppRole[]): boolean {
  return roles.length > 0;
}

/**
 * เพิ่มหมายเหตุ / ส่งเคสกลับให้ QA — ทุกคนที่ล็อกอิน
 * ตรงกับ current_role_group() ที่คืน 'other' แทน null แล้ว (0067)
 */
export function canCommentDeviation(roles: AppRole[]): boolean {
  return roles.length > 0;
}

/**
 * ตรวจสอบ / ปิด / ยกเลิก Incident Case — ตรงกับ can_review_incident() ใน DB (0067)
 *
 * ⚠️ ห้าม or รวมกับ canOpenDeviation() — ทุกฝ่ายเปิดเคสได้ แต่ QA เท่านั้นที่ตัดสิน
 */
export function canReviewIncident(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["qa", "manager"]);
}

/** ชื่อเดิม — ยังใช้อยู่หลายที่ · ความหมายเดียวกับ canReviewIncident */
export const canCloseDeviation = canReviewIncident;
