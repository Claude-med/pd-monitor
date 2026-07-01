// F1 — ค่าคงที่ระบบขอแก้ไขย้อนหลัง (ไม่มี server import — client ก็ import ได้)

export type EditTargetType =
  | "production_record"
  | "material_requisition"
  | "inprocess_check";

export type EditRequestStatus = "pending" | "applied" | "rejected";

export const EDIT_TARGET_LABEL: Record<EditTargetType, string> = {
  production_record: "บันทึกผลผลิต",
  material_requisition: "ใบเบิกวัตถุดิบ",
  inprocess_check: "ผลตรวจ QC ระหว่างผลิต",
};

/** ป้ายฟิลด์ (ใช้แสดง diff ในหน้ารีวิว/ประวัติ) */
export const EDIT_FIELD_LABEL: Record<string, string> = {
  input_qty: "จำนวนตั้งต้น",
  output_qty: "ผลิตได้",
  loss_qty: "ของเสีย",
  hours: "ชั่วโมง",
  headcount: "จำนวนคน",
  record_date: "วันที่",
  station: "สถานี",
  machine_id: "เครื่องจักร",
  qty: "จำนวน",
  param: "หัวข้อที่ตรวจ",
  value: "ค่าที่วัดได้",
  unit: "หน่วย",
  result: "ผล",
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
