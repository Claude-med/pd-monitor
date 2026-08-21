// ค่าคงที่สถานะล็อตในคลัง — ไฟล์นี้ "ไม่มี" server import → ใช้ได้ทั้ง Server/Client
// ตรงกับ enum material_lot_status ใน DB (0016_materials.sql)
//
// Part 2.1 (0046): ยุบเหลือ 2 ค่า — พร้อมใช้ / ไม่พร้อมใช้
//   ข้อมูลเก่าถูกแปลงแล้ว (released→available · testing/rejected/expired→quarantine)
//   enum ใน DB ยังมี 6 ค่าเพราะ Postgres ลบค่า enum ทิ้งไม่ได้ แต่ไม่มีใครเขียน 4 ค่าที่เหลือแล้ว

export const MATERIAL_LOT_STATUSES = [
  { key: "available", label: "พร้อมใช้", color: "#16a34a" },
  { key: "quarantine", label: "ไม่พร้อมใช้", color: "#94a3b8" },
] as const;

export type MaterialLotStatus = (typeof MATERIAL_LOT_STATUSES)[number]["key"];

/**
 * ป้ายของค่าเก่าที่เลิกใช้แล้ว — เผื่อมีแถวหลุดรอดการแปลงข้อมูล
 * จะได้ไม่โชว์เป็นภาษาอังกฤษดิบบนหน้าจอ
 */
const LEGACY_STATUS_LABEL: Record<string, string> = {
  released: "ไม่พร้อมใช้ (ค่าเดิม: ผ่าน)",
  testing: "ไม่พร้อมใช้ (ค่าเดิม: รอตรวจ)",
  rejected: "ไม่พร้อมใช้ (ค่าเดิม: ไม่ผ่าน)",
  expired: "ไม่พร้อมใช้ (ค่าเดิม: หมดอายุ)",
};

export const MATERIAL_LOT_STATUS_LABEL: Record<string, string> = {
  ...LEGACY_STATUS_LABEL,
  ...Object.fromEntries(MATERIAL_LOT_STATUSES.map((s) => [s.key, s.label])),
};
export const MATERIAL_LOT_STATUS_COLOR: Record<string, string> = {
  released: "#94a3b8",
  testing: "#94a3b8",
  rejected: "#94a3b8",
  expired: "#94a3b8",
  ...Object.fromEntries(MATERIAL_LOT_STATUSES.map((s) => [s.key, s.color])),
};

/**
 * สถานะล็อตที่ "พร้อมใช้" — ต้องตรงกับด่านใน upsert_product_lot (0046)
 * (Part C.2 ตัดระบบเบิกที่ตัดสต็อกออกแล้ว ค่านี้จึงเหลือไว้ใช้กับหน้าคลังอย่างเดียว)
 */
export const USABLE_LOT_STATUSES = new Set<string>(["available"]);
