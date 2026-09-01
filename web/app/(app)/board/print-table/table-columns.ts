import { formatSubStatus, type JobRow } from "@/lib/data/job-constants";
import { dashOr, displayJobNo, fmtDdMmYy, fmtQtyPlain } from "@/lib/format";

/**
 * นิยามคอลัมน์ของ "ตารางบอร์ดงาน" — แหล่งความจริงที่เดียว
 *
 * ใช้ร่วมกัน 3 ที่: ตัวอย่างบนจอ · กระดาษที่ปริ้น · ไฟล์ Excel
 * → หัวตารางกับค่าในช่องของทั้ง 3 ที่ตรงกันเสมอ ไม่มีทางหลุดกัน
 *
 * ถอดสเปกจากไฟล์ต้นแบบที่ทีมส่งมา (ชื่อคอลัมน์ · ลำดับ · ความกว้าง · ขนาดฟอนต์):
 *   production_list_portrait.html · production_list_landscape.html · pending_order_landscape_1.html
 */

/** หน้าตาตาราง — "มีแผนแล้ว" (ไม่มี LOT) · "รอแจ้งผลิต" (มี LOT) */
export type TableFormat = "planned" | "pending";

export const TABLE_FORMATS: { key: TableFormat; label: string }[] = [
  { key: "planned", label: "มีแผนแล้ว" },
  { key: "pending", label: "รอแจ้งผลิต" },
];

export type Orientation = "portrait" | "landscape";

export type TableCol = {
  key: string;
  header: string;
  /** น้ำหนักความกว้าง — normalize รวมเป็น 100% ตอน render (รองรับการตัดคอลัมน์ขนาดบรรจุออก) */
  weight: number;
  /** ชิดซ้าย (ชื่อยา) — ที่เหลือ default = กึ่งกลาง ตามฟอร์มกระดาษ */
  left?: boolean;
  /** ค่าที่พิมพ์ลงกระดาษ — string เสมอ ("-" เมื่อว่าง) */
  value: (job: JobRow) => string;
  /**
   * ค่าดิบสำหรับ Excel — มีเฉพาะคอลัมน์ที่ควรเป็น "ตัวเลขจริง" ในชีต (บวก/เรียงได้)
   * กระดาษยังใช้ value() เหมือนเดิม · null = ช่องว่าง
   */
  raw?: (job: JobRow) => number | null;
};

/* ============================================================
   ช่องข้อมูล — ทุกตัวคืน string พร้อมพิมพ์ ("-" เมื่อว่าง)
   ============================================================ */

const JOB_NO: TableCol = {
  key: "job_no",
  header: "JOB No.",
  weight: 7,
  // ตัดอักษรนำของบริษัททิ้ง (P690001 → 690001) — ทีมเรียกเลขเปล่าเสมอ
  value: (j) => displayJobNo(j.job_no),
};
const LOT_NO: TableCol = {
  key: "lot_no",
  header: "LOT. No.",
  weight: 7,
  value: (j) => dashOr(j.lot_no),
};
const DATE: TableCol = {
  key: "cpo_date",
  header: "DATE",
  weight: 7,
  value: (j) => dashOr(fmtDdMmYy(j.cpo_date)),
};
const CODE: TableCol = {
  key: "product_code",
  header: "CODE",
  weight: 8,
  value: (j) => dashOr(j.product_code),
};
const PRODUCT_NAME: TableCol = {
  key: "product_name",
  header: "PRODUCT NAME",
  weight: 10,
  left: true,
  value: (j) => dashOr(j.product_name),
};
const DOSAGE: TableCol = {
  key: "dosage_form",
  header: "ชนิด",
  weight: 5,
  value: (j) => dashOr(j.dosage_form),
};
const QUANTITY: TableCol = {
  key: "quantity",
  header: "จำนวนผลิต",
  weight: 7,
  value: (j) => fmtQtyPlain(j.quantity),
  raw: (j) => j.quantity,
};
const UNIT: TableCol = {
  key: "unit",
  header: "หน่วย",
  weight: 5,
  value: (j) => dashOr(j.unit),
};
/** ขนาดบรรจุช่องที่ n (1–3) */
const packCol = (n: 1 | 2 | 3, weight: number): TableCol => ({
  key: `pack_${n}`,
  header: `ขนาดบรรจุ (${n})`,
  weight,
  value: (j) => dashOr(j.pack_patterns[n - 1]),
});
const DEPT: TableCol = {
  key: "customer",
  header: "แผนก",
  weight: 5,
  value: (j) => dashOr(j.customer),
};
const REQUEST_NO: TableCol = {
  key: "request_no",
  header: "ใบคำขอ",
  weight: 7,
  value: (j) => dashOr(j.request_no),
};
const DUE_DATE: TableCol = {
  key: "due_date",
  header: "กำหนดส่ง",
  weight: 7,
  value: (j) => dashOr(fmtDdMmYy(j.due_date)),
};
const STATUS: TableCol = {
  key: "sub_status",
  header: "STATUS",
  weight: 5,
  // ช่อง Status ข้อความอิสระ + เดือนแผน → "มีแผน08/26" (ไม่ใช่สถานะ GMP)
  value: (j) => dashOr(formatSubStatus(j.sub_status, j.plan_month)),
};

/* ============================================================
   ประกอบเป็นชุดคอลัมน์
   ============================================================ */

/** ขนาดบรรจุมากสุดที่งานชุดนี้ใช้จริง (1–3) — ตัวตัดคอลัมน์ (2)/(3) ทิ้ง + ตัวเลือกแนวกระดาษ */
export function maxPackOf(jobs: JobRow[]): 1 | 2 | 3 {
  let max = 1;
  for (const j of jobs) {
    if (j.pack_patterns.length > max) max = j.pack_patterns.length;
  }
  return Math.min(3, Math.max(1, max)) as 1 | 2 | 3;
}

/**
 * คอลัมน์ที่จะพิมพ์จริง
 *
 * ความกว้างมี 2 ชุดตามที่ไฟล์ต้นแบบให้มา — แนวตั้งหน้าแคบกว่า จึงต้องเกลี่ยใหม่
 * (ชื่อยา/ขนาดบรรจุกินที่มากขึ้น) ไม่ใช่ย่อชุดเดิมลงมาตรง ๆ
 */
export function columnsFor(format: TableFormat, maxPack: 1 | 2 | 3): TableCol[] {
  const packs: TableCol[] =
    format === "pending"
      ? [packCol(1, 9), packCol(2, 8), packCol(3, 8)]
      : [packCol(1, 9), packCol(2, 9), packCol(3, 9)];

  if (format === "pending") {
    return [
      JOB_NO,
      LOT_NO,
      DATE,
      CODE,
      { ...PRODUCT_NAME, weight: 12 },
      DOSAGE,
      QUANTITY,
      UNIT,
      ...packs.slice(0, maxPack),
      { ...DEPT, weight: 6 },
      { ...REQUEST_NO, weight: 8 },
      DUE_DATE,
      { ...STATUS, weight: 7 },
    ];
  }

  // "มีแผนแล้ว" + ขนาดบรรจุช่องเดียว = แนวตั้ง → ใช้ความกว้างชุดของ production_list_portrait
  if (maxPack === 1) {
    return [
      { ...JOB_NO, weight: 8 },
      { ...DATE, weight: 8 },
      { ...CODE, weight: 9 },
      { ...PRODUCT_NAME, weight: 12 },
      { ...DOSAGE, weight: 6 },
      { ...QUANTITY, weight: 9 },
      { ...UNIT, weight: 6 },
      packCol(1, 13),
      { ...DEPT, weight: 6 },
      { ...REQUEST_NO, weight: 9 },
      { ...DUE_DATE, weight: 8 },
      { ...STATUS, weight: 6 },
    ];
  }

  return [
    JOB_NO,
    DATE,
    CODE,
    PRODUCT_NAME,
    DOSAGE,
    QUANTITY,
    UNIT,
    ...packs.slice(0, maxPack),
    DEPT,
    REQUEST_NO,
    DUE_DATE,
    STATUS,
  ];
}

/**
 * แนวกระดาษ — กติกาจากผู้ใช้:
 *   "มีแผนแล้ว" ขนาดบรรจุ 1 ช่อง → แนวตั้ง · มากกว่านั้น → แนวนอน · "รอแจ้งผลิต" → แนวนอนเสมอ
 */
export function orientationFor(
  format: TableFormat,
  maxPack: 1 | 2 | 3,
): Orientation {
  return format === "planned" && maxPack === 1 ? "portrait" : "landscape";
}

/** ขนาดฟอนต์ในตาราง (pt) — ค่าจากไฟล์ต้นแบบแต่ละใบ */
export function fontPtFor(format: TableFormat, maxPack: 1 | 2 | 3): number {
  if (format === "pending") return 7.3;
  return maxPack === 1 ? 9 : 10;
}

/** ท้ายกระดาษ — มีเฉพาะฟอร์ม "รอแจ้งผลิต" (ต้นแบบ production_list ไม่มีบรรทัดนี้) */
export function footerFor(
  format: TableFormat,
): { left: string; right: string } | null {
  return format === "pending"
    ? { left: "วันที่มีผลบังคับใช้ 12/10/2552", right: "F.PLN.10 REV.03" }
    : null;
}
