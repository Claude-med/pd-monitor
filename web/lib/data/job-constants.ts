import type { AppRole } from "@/lib/auth/dal";

// ไฟล์นี้ "ไม่มี" server import → ใช้ได้ทั้ง Server และ Client Components

/** สถานะงาน เรียงตามลำดับ flow + สี (อิงดีไซน์ prototype ที่ทีมอนุมัติ) */
export const JOB_STATUS = [
  { key: "pending_announce", label: "รอแจ้งผลิต", color: "#64748b" },
  { key: "planned", label: "มีแผนแล้ว", color: "#6366f1" },
  { key: "in_production", label: "กำลังผลิต", color: "#f59e0b" },
  { key: "qc", label: "QC", color: "#0ea5e9" },
  { key: "qa", label: "QA", color: "#a855f7" },
  { key: "finished_goods", label: "FG (เข้าคลัง)", color: "#16a34a" },
] as const;

export type JobStatus = (typeof JOB_STATUS)[number]["key"];

export const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  JOB_STATUS.map((s) => [s.key, s.label]),
);
export const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  JOB_STATUS.map((s) => [s.key, s.color]),
);
export const STATUS_INDEX: Record<string, number> = Object.fromEntries(
  JOB_STATUS.map((s, i) => [s.key, i]),
);

/** ป้ายปัญหา (แยกจาก flow หลัก) */
export const PROBLEM_FLAGS: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  blocked: { label: "ติดปัญหา", color: "#ef4444", icon: "🔴" },
  waiting_fix: { label: "รอแก้ไข", color: "#eab308", icon: "🟡" },
  delayed: { label: "ล่าช้า", color: "#f97316", icon: "🟠" },
};

/**
 * ตารางการเปลี่ยนสถานะที่อนุญาต — ต้องตรงกับฟังก์ชัน advance_job_status() ใน DB
 * (DB เป็นด่านบังคับจริง · ตารางนี้ใช้ตัดสินว่าจะ "แสดงปุ่ม" ไหนให้ผู้ใช้)
 */
export type Transition = {
  from: JobStatus;
  to: JobStatus;
  label: string;
  roles: AppRole[];
  kind: "forward" | "reject";
  /** การตัดสินคุณภาพ QC/QA → ต้องลงนาม (ยืนยันรหัสผ่านซ้ำ) ตาม A3 */
  esign?: boolean;
  /** ขั้นที่ลงนาม (qc/qa) — ใช้ส่งให้ rpc sign_job_decision */
  stage?: "qc" | "qa";
};

export const TRANSITIONS: Transition[] = [
  { from: "pending_announce", to: "planned", label: "ยืนยันแผนผลิต", roles: ["manager"], kind: "forward" },
  { from: "planned", to: "in_production", label: "เริ่มผลิต", roles: ["production", "manager"], kind: "forward" },
  { from: "in_production", to: "qc", label: "ส่งตรวจ QC", roles: ["production"], kind: "forward" },
  { from: "qc", to: "qa", label: "QC ผ่าน → ส่ง QA", roles: ["qc"], kind: "forward", esign: true, stage: "qc" },
  { from: "qc", to: "in_production", label: "QC ตีกลับ", roles: ["qc"], kind: "reject", esign: true, stage: "qc" },
  { from: "qa", to: "finished_goods", label: "QA ปล่อยผ่าน → FG", roles: ["qa"], kind: "forward", esign: true, stage: "qa" },
  { from: "qa", to: "in_production", label: "QA ตีกลับ", roles: ["qa"], kind: "reject", esign: true, stage: "qa" },
];

/** การเปลี่ยนสถานะที่ผู้ใช้ (role ชุดนี้) ทำได้จากสถานะปัจจุบัน */
export function availableTransitions(
  status: string,
  roles: AppRole[],
): Transition[] {
  return TRANSITIONS.filter(
    (t) => t.from === status && t.roles.some((r) => roles.includes(r)),
  );
}

export type JobRow = {
  id: string;
  job_no: string;
  status: JobStatus;
  problem: string | null;
  problem_note: string | null;
  planned_start: string | null;
  planned_end: string | null;
  lot_no: string | null;
  mfg_date: string | null;
  exp_date: string | null;
  order_no: string | null;
  customer: string | null;
  product_name: string | null;
  quantity: number | null;
  unit: string | null;
};
