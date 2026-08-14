// ค่าคงที่สถานะล็อตในคลัง — ไฟล์นี้ "ไม่มี" server import → ใช้ได้ทั้ง Server/Client
// ตรงกับ enum material_lot_status ใน DB (0016_materials.sql)
//
// Part 2 ก้อน 3: ประเภท RM/PM ย้ายไปอยู่ที่ products.type แล้ว (ดู product-constants.ts)
// ตาราง material_lots ยังใช้ชื่อเดิม แต่ผูกกับ products แทน materials

export const MATERIAL_LOT_STATUSES = [
  { key: "available", label: "พร้อมใช้", color: "#16a34a" },
  { key: "released", label: "ผ่าน (ปล่อยใช้)", color: "#0ea5e9" },
  { key: "quarantine", label: "กักกัน", color: "#f59e0b" },
  { key: "testing", label: "รอตรวจ (QC)", color: "#6366f1" },
  { key: "rejected", label: "ไม่ผ่าน", color: "#dc2626" },
  { key: "expired", label: "หมดอายุ", color: "#991b1b" },
] as const;

export type MaterialLotStatus = (typeof MATERIAL_LOT_STATUSES)[number]["key"];

export const MATERIAL_LOT_STATUS_LABEL: Record<string, string> =
  Object.fromEntries(MATERIAL_LOT_STATUSES.map((s) => [s.key, s.label]));
export const MATERIAL_LOT_STATUS_COLOR: Record<string, string> =
  Object.fromEntries(MATERIAL_LOT_STATUSES.map((s) => [s.key, s.color]));

/** สถานะล็อตที่ "เบิกไปใช้ได้" (ใช้ตอนทำใบเบิกในก้อนถัดไป) */
export const USABLE_LOT_STATUSES = new Set<MaterialLotStatus>([
  "available",
  "released",
]);
