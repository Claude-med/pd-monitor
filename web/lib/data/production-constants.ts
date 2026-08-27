// ค่าคงที่ + ตัวตรวจความถูกต้องของฟอร์ม "บันทึกผลผลิตรายวัน"
// ไฟล์นี้ "ไม่มี" server import → ใช้ได้ทั้ง Server และ Client Components
// ตรรกะ validate ตรงกับฟังก์ชัน add_production_record() ใน DB (DB เป็นด่านตัดสินจริง)
//
// Part C.3 ก้อน 5: เปลี่ยนชื่อไฟล์มาจาก station-constants.ts — ไม่เหลือค่าคงที่ของ
// "สถานี" อยู่ในนี้แล้วตั้งแต่เลิกใช้กลุ่มหลัก (0059) ชื่อเดิมจึงชวนเข้าใจผิด

/** กะทำงาน — ตรงกับ enum work_shift ใน DB (0063) */
export const WORK_SHIFTS = [
  { key: "morning", label: "กะเช้า" },
  { key: "night", label: "กะดึก" },
] as const;
export type WorkShift = (typeof WORK_SHIFTS)[number]["key"];
export const WORK_SHIFT_LABEL: Record<string, string> = Object.fromEntries(
  WORK_SHIFTS.map((s) => [s.key, s.label]),
);

/** ช่วงเวลา — ตรงกับ enum work_period ใน DB (0063) */
export const WORK_PERIODS = [
  { key: "normal", label: "ช่วงเวลาปกติ" },
  { key: "ot", label: "OT" },
] as const;
export type WorkPeriod = (typeof WORK_PERIODS)[number]["key"];
export const WORK_PERIOD_LABEL: Record<string, string> = Object.fromEntries(
  WORK_PERIODS.map((p) => [p.key, p.label]),
);

/**
 * หน่วยของยอด (ที่ต้องการ / ผลิตได้ / ของเสีย) — ตามที่ทีมผลิตระบุ
 * เก็บใน DB เป็น text ไม่ใช่ enum (บทเรียน 0040: enum ลบค่าทิ้งไม่ได้)
 */
export const QTY_UNITS = ["กล่อง", "แผง", "kg.", "ซอง"] as const;

/** บันทึกผลผลิตได้เฉพาะงานที่ "กำลังผลิต" เท่านั้น (B3) — ต้องตรงกับ add_production_record ใน DB
 *  ถ้า QC/QA ตีกลับ งานจะกลับมา in_production เอง จึงบันทึกต่อได้ตามปกติ */
export const RECORDABLE_STATUSES = new Set(["in_production"]);

/** สถานะ QC ของแถวบันทึกผลผลิต — คำนวณจาก inprocess_checks ที่ผูกกับแถวนั้น (ไม่เก็บคอลัมน์) */
export type RecordQcStatus = "waiting" | "pass" | "fail";

export const QC_STATUS_META: Record<
  RecordQcStatus,
  { label: string; color: string }
> = {
  waiting: { label: "รอ QC ตรวจสอบ", color: "#f59e0b" },
  pass: { label: "ผ่าน", color: "#16a34a" },
  fail: { label: "ไม่ผ่าน", color: "#dc2626" },
};

export type ProductionRecordRow = {
  id: string;
  job_route_id: string | null;
  station_id: string | null;
  station_name: string | null;
  record_date: string;
  shift: WorkShift | null;
  work_period: WorkPeriod | null;
  input_qty: number | null;
  input_unit: string | null;
  output_qty: number | null;
  output_unit: string | null;
  loss_qty: number | null;
  loss_unit: string | null;
  /** เวลาทำงานเป็น "นาที" (เดิมเป็นชั่วโมง — เปลี่ยนใน 0063) */
  minutes: number | null;
  note: string | null;
  operator_name: string | null;
  machine_id: string | null;
  machine_label: string | null;
  headcount: number | null;
  created_at: string;
};

/** ค่าดิบจากฟอร์ม (ทุกช่องเป็น string) */
export type RecordFormValues = {
  record_date: string;
  shift: string;
  work_period: string;
  input_qty: string;
  input_unit: string;
  output_qty: string;
  output_unit: string;
  loss_qty: string;
  loss_unit: string;
  minutes: string;
  note: string;
  machine_id: string;
  headcount: string;
};

/** ค่าที่ parse + ผ่าน validate แล้ว (พร้อมส่งเข้า rpc) */
export type ParsedRecord = {
  record_date: string;
  shift: string | null;
  work_period: string | null;
  input_qty: number;
  input_unit: string | null;
  output_qty: number;
  output_unit: string | null;
  loss_qty: number;
  loss_unit: string | null;
  minutes: number | null;
  note: string;
  machine_id: string | null;
  headcount: number | null;
};

/** parse ตัวเลขทศนิยมจาก string · คืน null ถ้าว่าง · คืน NaN ถ้ารูปแบบผิด */
function num(s: string): number | null | typeof NaN {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * ตรวจความถูกต้องของฟอร์มบันทึกผลผลิต — ใช้ทั้งฝั่ง client (feedback ทันที)
 * และ server action (กันส่งค่าพังเข้า rpc) · DB ยังตรวจซ้ำเป็นด่านสุดท้าย
 *
 * Part C.3 ก้อน 5: ไม่มีช่อง "สถานี" แล้ว — ขั้นตอนมาจากแท็บที่เลือกอยู่
 */
export function validateRecord(v: RecordFormValues): {
  errors: Partial<Record<keyof RecordFormValues, string>>;
  parsed?: ParsedRecord;
} {
  const errors: Partial<Record<keyof RecordFormValues, string>> = {};

  const date = v.record_date.trim();
  if (date === "") {
    errors.record_date = "ระบุวันที่บันทึก";
  } else if (date > todayISO()) {
    errors.record_date = "วันที่บันทึกเป็นวันในอนาคตไม่ได้";
  }

  const input = num(v.input_qty);
  const output = num(v.output_qty);
  const loss = num(v.loss_qty);
  const minutes = num(v.minutes);

  if (input === null) errors.input_qty = "กรอกยอดที่ต้องการ";
  else if (Number.isNaN(input)) errors.input_qty = "ตัวเลขไม่ถูกต้อง";
  else if (input < 0) errors.input_qty = "ห้ามติดลบ";

  if (output === null) errors.output_qty = "กรอกยอดผลิตได้";
  else if (Number.isNaN(output)) errors.output_qty = "ตัวเลขไม่ถูกต้อง";
  else if (output < 0) errors.output_qty = "ห้ามติดลบ";

  let lossVal = 0;
  if (loss !== null) {
    if (Number.isNaN(loss)) errors.loss_qty = "ตัวเลขไม่ถูกต้อง";
    else if (loss < 0) errors.loss_qty = "ห้ามติดลบ";
    else lossVal = loss;
  }

  let minutesVal: number | null = null;
  if (minutes !== null) {
    if (Number.isNaN(minutes)) errors.minutes = "ตัวเลขไม่ถูกต้อง";
    else if (minutes < 0 || minutes > 1440)
      errors.minutes = "ต้องอยู่ระหว่าง 0–1440 นาที";
    else minutesVal = minutes;
  }

  let headcountVal: number | null = null;
  const hc = (v.headcount ?? "").trim();
  if (hc !== "") {
    const n = Number(hc);
    if (!Number.isInteger(n) || n < 1)
      errors.headcount = "จำนวนคนต้องเป็นจำนวนเต็มตั้งแต่ 1";
    else headcountVal = n;
  }

  const inOk = typeof input === "number" && !Number.isNaN(input) && input >= 0;
  const outOk =
    typeof output === "number" && !Number.isNaN(output) && output >= 0;
  if (inOk && outOk) {
    if (output > input) {
      errors.output_qty = "ผลิตได้มากกว่ายอดที่ต้องการไม่ได้";
    } else if (!errors.loss_qty && output + lossVal > input) {
      errors.loss_qty = "ผลิตได้ + ของเสีย มากกว่ายอดที่ต้องการ";
    }
  }

  if (Object.keys(errors).length > 0) return { errors };

  return {
    errors,
    parsed: {
      record_date: date,
      shift: v.shift.trim() || null,
      work_period: v.work_period.trim() || null,
      input_qty: input as number,
      input_unit: v.input_unit.trim() || null,
      output_qty: output as number,
      output_unit: v.output_unit.trim() || null,
      loss_qty: lossVal,
      loss_unit: v.loss_unit.trim() || null,
      minutes: minutesVal,
      note: v.note.trim(),
      machine_id: (v.machine_id ?? "").trim() || null,
      headcount: headcountVal,
    },
  };
}
