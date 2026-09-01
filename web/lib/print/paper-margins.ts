/**
 * ขนาดขอบกระดาษที่ผู้ใช้ปรับเองได้ 4 ด้าน — ของกลางของทุกหน้าที่ปริ้น
 *
 * ใช้ร่วมกัน: ใบแจ้งผลิต F.PLN.01 (`board/print-notice`) · ตารางบอร์ดงาน (`board/print-table`)
 * แยกออกมาไว้ที่เดียวเพราะเป็นเลขที่ต้องตรงกันเป๊ะกับสูตร calc() ใน CSS ของแต่ละหน้า —
 * ถ้าปล่อยให้ก๊อปกันไว้คนละไฟล์ วันหนึ่งจะแก้ที่เดียวแล้วอีกหน้าเพี้ยนเงียบ ๆ
 *
 * ⚠️ ไฟล์นี้ต้องไม่มี JSX / ไม่มี "use client" — เป็นตัวเลขล้วน ใช้ได้ทั้ง Server และ Client
 */

export type Side = "top" | "right" | "bottom" | "left";

/** 0.32 นิ้ว = 8.13mm — ค่าเดิมที่เคย hard-code ไว้เป็น @page { margin: 8mm } (ใบแจ้งผลิต) */
export const DEFAULT_MARGIN_IN = 0.32;

/**
 * 0.2 นิ้ว = 5.08mm — ค่าเริ่มต้นของ "ตารางบอร์ดงาน" ที่ตั้งใจให้ขอบบางที่สุดเท่าที่ปลอดภัย
 * 🚨 อย่าลดต่ำกว่านี้เป็นค่าเริ่มต้น: เครื่องพิมพ์ทั่วไปพิมพ์ในระยะ ~4mm จากขอบกระดาษไม่ได้
 *    ตั้งต่ำกว่านั้นแล้ว Chrome จะย่อทั้งหน้าลงให้พอดีพื้นที่พิมพ์ ระยะที่ตั้งไว้จะไม่ตรงของจริง
 */
export const TABLE_DEFAULT_MARGIN_IN = 0.2;

export const MAX_MARGIN_IN = 1.5;

/**
 * เก็บเป็น string ไม่ใช่ number โดยตั้งใจ — ถ้าเก็บเป็น number แล้ว parse ทุกครั้งที่พิมพ์
 * ผู้ใช้จะพิมพ์ "0." ไม่ได้เลย (มันจะถูกแปลงกลับเป็น "0" ทันที)
 */
export type Margins = Record<Side, string>;

/** ขอบเท่ากันทั้ง 4 ด้าน */
export function makeMargins(inch: number): Margins {
  const v = String(inch);
  return { top: v, right: v, bottom: v, left: v };
}

export const DEFAULT_MARGINS: Margins = makeMargins(DEFAULT_MARGIN_IN);
export const TABLE_DEFAULT_MARGINS: Margins = makeMargins(TABLE_DEFAULT_MARGIN_IN);

export const MARGIN_SIDES: { key: Side; label: string }[] = [
  { key: "top", label: "บน" },
  { key: "right", label: "ขวา" },
  { key: "bottom", label: "ล่าง" },
  { key: "left", label: "ซ้าย" },
];

/**
 * string จากช่องกรอก → นิ้วที่ใช้ได้จริง
 * 🚨 ห้ามคืน NaN — NaN หลุดเข้า calc() แล้วทั้งกฎจะถูกทิ้งเงียบ ๆ แผ่นกระดาษจะเสียรูปทันที
 */
export function marginIn(raw: string): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_MARGIN_IN, Math.max(0, n));
}

/** นิ้ว → มิลลิเมตร */
export const mm = (inch: number) => inch * 25.4;

/** มิลลิเมตรที่โชว์ให้ผู้ใช้อ่าน (ทศนิยม 1 ตำแหน่งพอ) */
export const fmtMm = (v: number) => v.toFixed(1);

/** ขอบทั้ง 4 ด้านเป็นตัวเลขที่ปลอดภัยแล้ว (clamp 0–1.5 นิ้ว ไม่มี NaN) */
export function toInches(m: Margins): Record<Side, number> {
  return {
    top: marginIn(m.top),
    right: marginIn(m.right),
    bottom: marginIn(m.bottom),
    left: marginIn(m.left),
  };
}

/** ทุกด้านยังเป็นค่าเริ่มต้นของหน้านั้นอยู่ไหม — ใช้ปิดปุ่ม "รีเซ็ต" */
export function isDefaultMargins(
  m: Margins,
  base: number = DEFAULT_MARGIN_IN,
): boolean {
  return MARGIN_SIDES.every(({ key }) => marginIn(m[key]) === base);
}
