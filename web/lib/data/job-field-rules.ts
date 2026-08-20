import type { AppRole } from "@/lib/auth/dal";
import { STATUS_INDEX } from "@/lib/data/job-constants";
import { canEditJobPlanFields, canEditJobProductionFields } from "@/lib/data/role-access";

// ไฟล์นี้ "ไม่มี" server import → ใช้ได้ทั้ง Server และ Client Components

/**
 * กติกาสิทธิ์ + ด่านล็อกของแต่ละช่องในการ์ด "ข้อมูลงาน" (Part C)
 *
 * ⚠️ ต้องตรงกับฟังก์ชัน public.job_field_rules() ใน DB (migration 0054) เสมอ
 *    DB เป็นด่านบังคับจริง · ไฟล์นี้ใช้ตัดสินว่าจะ "แสดงช่องกรอกหรือแสดงเป็นข้อความ"
 *
 * perm:     plan = ฝ่ายวางแผน+ผู้บริหาร · prod = ฝ่ายผลิต+ผู้บริหาร · both = ทั้งสองฝ่าย
 *           lot  = วันผลิต/วันหมดอายุ (ทั้งสองฝ่าย แต่ต้องมีเลขล็อตแล้ว)
 * lockFrom: ลำดับสถานะ (1-based เหมือน array_position ใน SQL) ที่เริ่มล็อก
 *           3 = กำลังผลิต · 6 = FG · null = ไม่ล็อกด้วยกติกานี้
 *           (lot_no/mfg_date/exp_date คุมด้วยด่านของ set_job_lot ต่างหาก — ดู lotLocked)
 */
export type JobFieldKey =
  | "sub_status"
  | "plan_month"
  | "due_date"
  | "customer_id"
  | "cpo_date"
  | "request_no"
  | "planned_start"
  | "planned_end"
  | "quantity"
  | "pack_type"
  | "pack_pattern_1"
  | "pack_pattern_2"
  | "pack_pattern_3"
  | "lot_no"
  | "mfg_date"
  | "exp_date";

export type JobFieldPerm = "plan" | "prod" | "both" | "lot";

export type JobFieldRule = {
  key: JobFieldKey;
  label: string;
  perm: JobFieldPerm;
  lockFrom: number | null;
};

export const JOB_FIELD_RULES: Record<JobFieldKey, JobFieldRule> = {
  sub_status:     { key: "sub_status",     label: "Status",           perm: "both", lockFrom: null },
  plan_month:     { key: "plan_month",     label: "เดือนแผน",           perm: "both", lockFrom: null },
  due_date:       { key: "due_date",       label: "กำหนดส่ง",           perm: "plan", lockFrom: null },
  customer_id:    { key: "customer_id",    label: "ลูกค้า",             perm: "plan", lockFrom: 6 },
  cpo_date:       { key: "cpo_date",       label: "C.P.O DATE",       perm: "plan", lockFrom: 6 },
  request_no:     { key: "request_no",     label: "ใบคำขอ",            perm: "both", lockFrom: 6 },
  planned_start:  { key: "planned_start",  label: "แผนเริ่ม",           perm: "prod", lockFrom: 6 },
  planned_end:    { key: "planned_end",    label: "แผนเสร็จ",           perm: "prod", lockFrom: 6 },
  quantity:       { key: "quantity",       label: "Batch Size",       perm: "plan", lockFrom: 3 },
  pack_type:      { key: "pack_type",      label: "รูปแบบบรรจุ",         perm: "plan", lockFrom: 3 },
  pack_pattern_1: { key: "pack_pattern_1", label: "Packing Size (1)", perm: "plan", lockFrom: 3 },
  pack_pattern_2: { key: "pack_pattern_2", label: "Packing Size (2)", perm: "plan", lockFrom: 3 },
  pack_pattern_3: { key: "pack_pattern_3", label: "Packing Size (3)", perm: "plan", lockFrom: 3 },
  lot_no:         { key: "lot_no",         label: "LOT No.",          perm: "prod", lockFrom: null },
  mfg_date:       { key: "mfg_date",       label: "วันผลิต",            perm: "lot",  lockFrom: null },
  exp_date:       { key: "exp_date",       label: "วันหมดอายุ",          perm: "lot",  lockFrom: null },
};

/** ฝ่ายนี้มีสิทธิ์แก้ช่องนี้ไหม (ยังไม่นับด่านล็อกตามสถานะ) */
export function canEditField(key: JobFieldKey, roles: AppRole[]): boolean {
  const plan = canEditJobPlanFields(roles);
  const prod = canEditJobProductionFields(roles);
  switch (JOB_FIELD_RULES[key].perm) {
    case "plan":
      return plan;
    case "prod":
      return prod;
    case "both":
    case "lot":
      return plan || prod;
  }
}

/** ลำดับสถานะแบบ 1-based ให้ตรงกับ array_position() ฝั่ง SQL */
export function statusStep(status: string): number {
  return (STATUS_INDEX[status] ?? 0) + 1;
}

/** ช่องนี้ถูกล็อกด้วยสถานะงานแล้วหรือยัง (ไม่รวมด่านของเลขล็อต) */
export function isFieldLocked(key: JobFieldKey, status: string): boolean {
  const from = JOB_FIELD_RULES[key].lockFrom;
  return from != null && statusStep(status) >= from;
}

/**
 * ด่านของ LOT No. / วันผลิต / วันหมดอายุ — ล็อกเมื่อพ้น "มีแผนแล้ว"
 * (ด่านเดิมของ set_job_lot ใน 0049 · ผู้บริหารก็ข้ามไม่ได้)
 */
export function isLotLocked(status: string): boolean {
  return statusStep(status) > 2;
}
