// ค่าคงที่ "รายการเบิกวัตถุดิบ/บรรจุภัณฑ์" — ไฟล์นี้ "ไม่มี" server import → ใช้ได้ทั้ง Server/Client
// ตรงกับ check constraint ของตาราง job_materials ใน DB (0056_job_materials.sql)

/** ประเภทของที่เบิก — RM = Raw Material · PM = Packaging Material */
export const MATERIAL_ITEM_TYPES = [
  { key: "RM", label: "วัตถุดิบ (RM)", short: "RM", color: "#0ea5e9" },
  { key: "PM", label: "บรรจุภัณฑ์ (PM)", short: "PM", color: "#a855f7" },
] as const;

export type MaterialItemType = (typeof MATERIAL_ITEM_TYPES)[number]["key"];

export const MATERIAL_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  MATERIAL_ITEM_TYPES.map((t) => [t.key, t.label]),
);
export const MATERIAL_TYPE_SHORT: Record<string, string> = Object.fromEntries(
  MATERIAL_ITEM_TYPES.map((t) => [t.key, t.short]),
);
export const MATERIAL_TYPE_COLOR: Record<string, string> = Object.fromEntries(
  MATERIAL_ITEM_TYPES.map((t) => [t.key, t.color]),
);

/**
 * ความพร้อมของของ — ฝ่ายคลังเป็นคนกด (ฝ่ายผลิตเห็นแต่กดไม่ได้)
 * ⚠️ ไม่ใช่ด่าน GMP — ไม่กั้นการเดินสถานะงาน แค่ขึ้นแถบเตือนบนหน้าจอ
 */
export const MATERIAL_READY_STATUSES = [
  { key: "not_ready", label: "ไม่พร้อม", color: "#f59e0b" },
  { key: "ready", label: "พร้อม", color: "#16a34a" },
] as const;

export type MaterialReadyStatus =
  (typeof MATERIAL_READY_STATUSES)[number]["key"];

export const READY_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  MATERIAL_READY_STATUSES.map((s) => [s.key, s.label]),
);
export const READY_STATUS_COLOR: Record<string, string> = Object.fromEntries(
  MATERIAL_READY_STATUSES.map((s) => [s.key, s.color]),
);

/** ค่าตั้งต้นตอนฝ่ายผลิตเพิ่มรายการ — ต้องตรงกับ default ของคอลัมน์ใน DB */
export const DEFAULT_READY_STATUS: MaterialReadyStatus = "not_ready";
