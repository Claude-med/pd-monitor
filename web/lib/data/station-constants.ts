// ค่าคงที่ "สถานีผลิต" + ตัวตรวจความถูกต้องของฟอร์มบันทึกผลผลิต
// ไฟล์นี้ "ไม่มี" server import → ใช้ได้ทั้ง Server และ Client Components
// ตรรกะ validate ตรงกับฟังก์ชัน add_production_record() ใน DB (DB เป็นด่านตัดสินจริง)

/** สถานีผลิตตามลำดับ flow (PRD: เตรียม → ผสม → ตอก → บรรจุ) */
export const STATIONS = [
  { key: "prep", label: "เตรียมวัตถุดิบ", icon: "🧪", color: "#64748b" },
  { key: "mixing", label: "ผสม", icon: "🌀", color: "#6366f1" },
  { key: "tableting", label: "ตอกเม็ด", icon: "⚙️", color: "#f59e0b" },
  { key: "packing", label: "บรรจุ", icon: "📦", color: "#16a34a" },
] as const;

export type StationKey = (typeof STATIONS)[number]["key"];

export const STATION_LABEL: Record<string, string> = Object.fromEntries(
  STATIONS.map((s) => [s.key, s.label]),
);
export const STATION_ICON: Record<string, string> = Object.fromEntries(
  STATIONS.map((s) => [s.key, s.icon]),
);

/** บันทึกผลผลิตได้เฉพาะงานที่ "กำลังผลิต" เท่านั้น (B3) — ต้องตรงกับ add_production_record ใน DB
 *  ถ้า QC/QA ตีกลับ งานจะกลับมา in_production เอง จึงบันทึกต่อได้ตามปกติ */
export const RECORDABLE_STATUSES = new Set(["in_production"]);

export type ProductionRecordRow = {
  id: string;
  station: StationKey;
  record_date: string;
  input_qty: number | null;
  output_qty: number | null;
  loss_qty: number | null;
  hours: number | null;
  note: string | null;
  operator_name: string | null;
  machine_id: string | null; // id เครื่องที่ใช้ (สำหรับ prefill ตอนขอแก้ไข)
  machine_label: string | null; // "code · name" ของเครื่องที่ใช้ (ถ้ามี)
  headcount: number | null; // จำนวนคน (A5)
  created_at: string;
};

/** ค่าดิบจากฟอร์ม (ทุกช่องเป็น string) */
export type RecordFormValues = {
  station: string;
  record_date: string;
  input_qty: string;
  output_qty: string;
  loss_qty: string;
  hours: string;
  note: string;
  machine_id: string; // เครื่องจักรที่ใช้ (ออปชัน) — A1 ก้อน 2
  headcount: string; // จำนวนคน (ออปชัน) — A5
};

/** ค่าที่ parse + ผ่าน validate แล้ว (พร้อมส่งเข้า rpc) */
export type ParsedRecord = {
  station: StationKey;
  record_date: string;
  input_qty: number;
  output_qty: number;
  loss_qty: number;
  hours: number | null;
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
 * คืน errors แยกตามช่อง + parsed ถ้าผ่านครบ
 */
export function validateRecord(v: RecordFormValues): {
  errors: Partial<Record<keyof RecordFormValues, string>>;
  parsed?: ParsedRecord;
} {
  const errors: Partial<Record<keyof RecordFormValues, string>> = {};

  // station
  const station = v.station as StationKey;
  if (!STATIONS.some((s) => s.key === station)) {
    errors.station = "เลือกสถานีผลิต";
  }

  // record_date
  const date = v.record_date.trim();
  if (date === "") {
    errors.record_date = "ระบุวันที่บันทึก";
  } else if (date > todayISO()) {
    errors.record_date = "วันที่บันทึกเป็นวันในอนาคตไม่ได้";
  }

  // ตัวเลข
  const input = num(v.input_qty);
  const output = num(v.output_qty);
  const loss = num(v.loss_qty);
  const hours = num(v.hours);

  if (input === null) errors.input_qty = "กรอกยอดตั้งต้น";
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

  let hoursVal: number | null = null;
  if (hours !== null) {
    if (Number.isNaN(hours)) errors.hours = "ตัวเลขไม่ถูกต้อง";
    else if (hours < 0 || hours > 24) errors.hours = "ต้องอยู่ระหว่าง 0–24";
    else hoursVal = hours;
  }

  // headcount (จำนวนคน) — ออปชัน ถ้ากรอกต้องเป็นจำนวนเต็ม ≥ 1
  let headcountVal: number | null = null;
  const hc = (v.headcount ?? "").trim();
  if (hc !== "") {
    const n = Number(hc);
    if (!Number.isInteger(n) || n < 1) errors.headcount = "จำนวนคนต้องเป็นจำนวนเต็มตั้งแต่ 1";
    else headcountVal = n;
  }

  // ความสัมพันธ์ระหว่างช่อง (ตรวจเมื่อ input/output เป็นตัวเลขที่ใช้ได้)
  const inOk = typeof input === "number" && !Number.isNaN(input) && input >= 0;
  const outOk = typeof output === "number" && !Number.isNaN(output) && output >= 0;
  if (inOk && outOk) {
    if (output > input) {
      errors.output_qty = "ผลิตได้มากกว่ายอดตั้งต้นไม่ได้";
    } else if (!errors.loss_qty && output + lossVal > input) {
      errors.loss_qty = "ผลิตได้ + ของเสีย มากกว่ายอดตั้งต้น";
    }
  }

  if (Object.keys(errors).length > 0) return { errors };

  return {
    errors,
    parsed: {
      station,
      record_date: date,
      input_qty: input as number,
      output_qty: output as number,
      loss_qty: lossVal,
      hours: hoursVal,
      note: v.note.trim(),
      machine_id: (v.machine_id ?? "").trim() || null,
      headcount: headcountVal,
    },
  };
}
