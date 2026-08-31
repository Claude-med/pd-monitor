import type { AppRole } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";

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
  { from: "pending_announce", to: "planned", label: "ยืนยันแผนผลิต", roles: ["planner", "manager"], kind: "forward" },
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
    (t) => t.from === status && hasAnyRole(roles, t.roles),
  );
}

/** จำนวนใบสูงสุดต่อการสร้าง 1 ครั้ง — ต้องตรงกับด่านใน create_production_jobs (0048) */
export const MAX_JOBS_PER_CREATE = 50;

/**
 * ค่าเริ่มต้นของช่อง "Status" (sub_status) ตอนสร้างงานใหม่ (Part 3.1)
 * — ฝ่ายวางแผนไม่ต้องพิมพ์เองแล้ว งานที่เพิ่งสร้างยังไม่มีแผนเสมอ
 * ⚠️ ไม่เกี่ยวกับด่าน GMP · flow จริงคุมด้วย JobStatus (enum) เท่านั้น
 */
export const DEFAULT_JOB_SUB_STATUS = "ไม่มีแผน";

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
  /** รหัสยา — products.code (แก้ที่หน้าผลิตภัณฑ์เท่านั้น ห้ามแก้ที่งาน) */
  product_code: string | null;
  /** ชนิด — products.dosage_form (TAB/CAP/CRM …) · ⚠️ ไม่ใช่ products.type ที่ถูกเลิกใช้ไปแล้วใน 0044 */
  dosage_form: string | null;
  /** เลขทะเบียนตำรับยา — มาจากทะเบียนผลิตภัณฑ์ (แก้ที่หน้าผลิตภัณฑ์เท่านั้น ห้ามแก้ที่งาน) */
  reg_no: string | null;
  /** ลักษณะยา — products.appearance · ช่อง "รูปร่างลักษณะยา" บนใบแจ้งผลิต (แก้ที่หน้าผลิตภัณฑ์เท่านั้น) */
  appearance: string | null;
  /** บริษัทเจ้าของงาน (Part D · 0071) — ผูกกับเลขงานที่ออกไปแล้ว แก้ทีหลังไม่ได้ */
  company_id: string | null;
  /** ชื่อบริษัท snapshot ตอนสร้างงาน */
  company: string | null;
  /** หมายเหตุของงาน — บริษัท POND ใช้เป็นหลัก */
  note: string | null;
  quantity: number | null;
  unit: string | null;
  /** กำหนดส่ง (orders.due_date) — Part C ยกมาแสดง/แก้ในหน้ารายละเอียดงาน */
  due_date: string | null;
  /** ลูกค้าในทะเบียน (orders.customer_id) — customer เป็น snapshot ชื่อ ณ วันสั่ง (0047) */
  customer_id: string | null;
  /** ใบคำขอ — เลขที่ใบสั่งผลิตจากลูกค้า (Part 3) · ใบที่สร้างพร้อมกันใช้เลขนี้ร่วมกัน */
  request_no: string | null;
  /** C.P.O DATE — วันที่ลูกค้าสั่งผลิต (Part 3) */
  cpo_date: string | null;
  /** Status ข้อความอิสระ (Part 3) — ⚠️ ไม่เกี่ยวกับด่าน GMP · flow จริงคุมด้วย status (enum) */
  sub_status: string | null;
  /** เดือนที่ลงแผนผลิต (Part C) — วันที่ 1 ของเดือน · คู่กับ sub_status ที่ requires_plan_month */
  plan_month: string | null;
  /** รูปแบบบรรจุของงานนี้ (Part 2 — ย้ายจากระดับยามาระดับงาน) */
  pack_type: string | null;
  /** ขนาดบรรจุ 1–3 ช่อง — ตรงกับใบแจ้งผลิต F.PLN.01 */
  pack_patterns: string[];
  /** งานถูกรับเข้าคลัง FG แล้ว (มีรายการใน fg_inventory) — ใช้ซ่อนออกจากบอร์ด */
  fg_received?: boolean;
};

/**
 * แสดงเดือนแผนแบบที่ทีมเขียนในใบงาน: '2026-08-01' → '08/26' (ค.ศ. 2 หลัก)
 * ⚠️ ตัดด้วย string ล้วน ห้ามผ่าน new Date() — timezone ทำให้เลื่อนวัน/เดือนได้ (บทเรียน 0048)
 */
export function formatPlanMonth(planMonth: string | null): string | null {
  if (!planMonth || planMonth.length < 7) return null;
  return `${planMonth.slice(5, 7)}/${planMonth.slice(2, 4)}`;
}

/** ค่าที่โผล่บนจอของช่อง Status — 'มีแผน' + '2026-08-01' → 'มีแผน08/26' */
export function formatSubStatus(
  subStatus: string | null,
  planMonth: string | null,
): string | null {
  if (!subStatus) return null;
  const mm = formatPlanMonth(planMonth);
  return mm ? `${subStatus}${mm}` : subStatus;
}

/** ค่าที่ input type="month" ต้องการ: '2026-08-01' → '2026-08' */
export function toMonthInput(planMonth: string | null): string {
  return planMonth ? planMonth.slice(0, 7) : "";
}

/** ค่าที่ DB ต้องการ (วันที่ 1 ของเดือน): '2026-08' → '2026-08-01' */
export function fromMonthInput(value: string): string | null {
  return value && value.length >= 7 ? `${value.slice(0, 7)}-01` : null;
}
