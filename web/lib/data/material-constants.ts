// ค่าคงที่วัตถุดิบ/คลัง — ไฟล์นี้ "ไม่มี" server import → ใช้ได้ทั้ง Server/Client
// ตรงกับ enum material_type / material_lot_status ใน DB (0016_materials.sql)

export const MATERIAL_TYPES = [
  { key: "rm", label: "วัตถุดิบ (RM)" },
  { key: "pm", label: "บรรจุภัณฑ์ (PM)" },
] as const;

export type MaterialType = (typeof MATERIAL_TYPES)[number]["key"];

export const MATERIAL_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  MATERIAL_TYPES.map((t) => [t.key, t.label]),
);

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
