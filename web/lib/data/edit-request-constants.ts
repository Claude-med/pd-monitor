// F1 — ค่าคงที่ระบบขอแก้ไขย้อนหลัง (ไม่มี server import — client ก็ import ได้)

import type { AppRole } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";

export type EditTargetType =
  | "production_record"
  | "material_requisition"
  | "inprocess_check";

export type EditRequestStatus = "pending" | "applied" | "rejected";

export const EDIT_TARGET_LABEL: Record<EditTargetType, string> = {
  production_record: "บันทึกผลผลิต",
  // ระบบเบิกเดิมถูกยกเลิกใน Part C.2 — คงค่าไว้เพราะ enum edit_target_type ใน DB
  // ลบค่าทิ้งไม่ได้ (Postgres ไม่มี ALTER TYPE ... DROP VALUE) และแถวเก่ายังอ้างถึง
  material_requisition: "ใบเบิกผลิตภัณฑ์ (ระบบเดิม — ยกเลิกแล้ว)",
  inprocess_check: "ผลตรวจ QC ระหว่างผลิต",
};

/** ป้ายฟิลด์ (ใช้แสดง diff ในหน้ารีวิว/ประวัติ) */
export const EDIT_FIELD_LABEL: Record<string, string> = {
  input_qty: "ยอดที่ต้องการ",
  output_qty: "ผลิตได้",
  loss_qty: "ของเสีย",
  minutes: "นาทีทำงาน",
  shift: "กะ",
  work_period: "ช่วงเวลา/OT",
  input_unit: "หน่วยยอดที่ต้องการ",
  output_unit: "หน่วยผลิตได้",
  loss_unit: "หน่วยของเสีย",
  headcount: "จำนวนคน",
  record_date: "วันที่",
  // Part C.3 ก้อน 2: เลิกใช้ field "station" (กลุ่มหลัก) แล้ว เหลือ station_id อย่างเดียว
  station_id: "สถานี",
  machine_id: "เครื่องจักร",
  qty: "จำนวน",
  param: "หัวข้อที่ตรวจ",
  value: "ค่าที่วัดได้",
  unit: "หน่วย",
  result: "ผล",
  // Part C.4: เปิดให้แก้ valid date ของผลตรวจ in-process ได้ (whitelist ใน request_edit · 0065)
  valid_date: "Valid date (ใช้ได้ถึง)",
  note: "หมายเหตุ",
};

export const EDIT_STATUS_META: Record<
  EditRequestStatus,
  { label: string; color: string }
> = {
  pending: { label: "รออนุมัติ", color: "#f59e0b" },
  applied: { label: "อนุมัติ + แก้แล้ว", color: "#16a34a" },
  rejected: { label: "ปฏิเสธ", color: "#ef4444" },
};

export function fieldLabel(key: string): string {
  return EDIT_FIELD_LABEL[key] ?? key;
}

/**
 * ผู้ใช้อนุมัติ/ปฏิเสธคำขอแก้ไขชนิดนี้ได้ไหม — สะท้อนกติกา server RPC review_edit_request
 * (manager/admin อนุมัติได้ทุกชนิด · qa + qc_lead เฉพาะผลตรวจ QC ระหว่างผลิต
 *  · production_lead เฉพาะบันทึกผลผลิต)
 *
 * Part D (0073): เพิ่ม qc_lead — เดิมคนที่ "กดขอแก้" ผลตรวจ in-process ได้คือ qc/qc_lead/manager
 * แต่คนที่ "อนุมัติ" ได้มีแค่ manager/qa → หัวหน้า QC ยื่นเองแล้วไม่มีใครในสายงานกดอนุมัติได้
 * 0083: เพิ่ม production_lead ด้วยเหตุผลเดียวกัน — 0080 ตั้งให้หัวหน้าฝ่ายผลิตเป็นผู้อนุมัติ
 * บันทึกผลผลิตตัวจริง (can_approve_production_record) แต่กลับอนุมัติ "คำขอแก้" ของมันไม่ได้
 *
 * ⚠️ ค่ากลาง 2 ตัวนี้คุมทั้งเมนู (lib/nav.ts) · guard หน้า (edit-requests/page.tsx)
 *    · badge (app/(app)/layout.tsx) · ปุ่มในหน้ารีวิว · guard ของ server action
 *    แก้ที่นี่ที่เดียว ห้ามก็อปรายชื่อ role ไปไว้ที่อื่น
 */
export const EDIT_REVIEWER_ROLES: AppRole[] = [
  "manager",
  "qa",
  "qc_lead",
  "production_lead",
];

/** ชนิดคำขอที่ role นี้อนุมัติได้จริง — ใช้กรอง badge ให้ตรงกับปุ่มที่กดได้ */
export const EDIT_REVIEWER_TARGETS: {
  targetType: EditTargetType;
  roles: AppRole[];
}[] = [
  { targetType: "inprocess_check", roles: ["qa", "qc_lead"] },
  { targetType: "production_record", roles: ["production_lead"] },
];

export function canReviewEdit(
  roles: AppRole[],
  targetType: EditTargetType,
): boolean {
  if (hasAnyRole(roles, ["manager", "admin"])) return true;
  return EDIT_REVIEWER_TARGETS.some(
    (t) => t.targetType === targetType && hasAnyRole(roles, t.roles),
  );
}
