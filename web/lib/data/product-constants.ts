/**
 * ค่าคงที่ของ "ผลิตภัณฑ์" — ไม่มี server import → ใช้ได้ทั้ง Server และ Client Components
 * ต้องตรงกับ check constraint products_type_chk ใน migration 0040
 */

export const PRODUCT_TYPES = [
  { key: "fg", label: "ยา / สินค้าสำเร็จรูป", short: "ยา", color: "#0ea5e9" },
  { key: "rm", label: "วัตถุดิบ (RM)", short: "RM", color: "#16a34a" },
  { key: "pm", label: "บรรจุภัณฑ์ (PM)", short: "PM", color: "#f59e0b" },
] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number]["key"];

export const PRODUCT_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  PRODUCT_TYPES.map((t) => [t.key, t.label]),
);
export const PRODUCT_TYPE_SHORT: Record<string, string> = Object.fromEntries(
  PRODUCT_TYPES.map((t) => [t.key, t.short]),
);
export const PRODUCT_TYPE_COLOR: Record<string, string> = Object.fromEntries(
  PRODUCT_TYPES.map((t) => [t.key, t.color]),
);

/** หน่วยนับมาตรฐาน — ตรงกับ "ตารางรหัสผลิตภัณฑ์และเลขทะเบียนตำรับยา" ของโรงงาน */
export const PRODUCT_UNITS = ["TAB", "CAP", "LT.", "KG."] as const;
