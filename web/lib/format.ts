// รูปแบบวันเวลากลางของแอป — ล็อก timezone ไทยเสมอ
// กันเวลาเพี้ยนเมื่อ runtime (Vercel serverless) เป็น UTC แต่ผู้ใช้อยู่ไทย (UTC+7)
const TZ = "Asia/Bangkok";

/** วันที่ + เวลา — ใช้กับ timestamp เช่น created_at, signed_at, checked_at */
export function fmtDateTime(
  value: string | number | Date | null | undefined,
): string {
  if (value == null || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("th-TH", { timeZone: TZ });
}

/** วันที่อย่างเดียว (ไม่มีเวลา) */
export function fmtDate(
  value: string | number | Date | null | undefined,
): string {
  if (value == null || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("th-TH", { timeZone: TZ });
}

/**
 * จำนวน + หน่วย ให้อ่านง่าย ("50 kg" · "— ไม่ระบุจำนวน" ถ้าไม่ได้ระบุจำนวน)
 *
 * ⚠️ ต้องอยู่ไฟล์นี้เท่านั้น (ไม่มี "use client") — เดิมอยู่ใน components/job-material-card.tsx
 *    ที่เป็น client module ทำให้ /trace (Server Component) เรียกแล้ว throw
 *    "Attempted to call formatQty() from the server" → หน้าพัง 500 เฉพาะงานที่มีรายการเบิก
 *    กติกา: ไฟล์ "use client" export ได้แต่ Component เท่านั้น
 */
export function formatQty(qty: number | null, unit: string | null): string {
  if (qty == null) return unit ? `— ${unit}` : "— ไม่ระบุจำนวน";
  return `${qty.toLocaleString("th-TH")}${unit ? ` ${unit}` : ""}`;
}

/**
 * วันที่แบบสั้นบนเอกสารกระดาษ: '2027-03-15' → '15/03/27' (วว/ดด/ปป · ค.ศ. 2 หลัก)
 *
 * ใช้กับใบแจ้งผลิต F.PLN.01 ช่อง "กำหนดส่ง" (ฟอร์มกระดาษเขียนสั้นแบบนี้ ช่องแคบมาก)
 * ⚠️ ตัดด้วย string ล้วน ห้ามผ่าน new Date() — timezone ทำให้เลื่อนวันได้ (บทเรียน 0048)
 */
export function fmtDdMmYy(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
}

/**
 * เลขงานที่ "ให้คนอ่าน" — ตัดอักษรนำของบริษัทออก (Part D · 0071)
 *
 * ระบบเก็บ `jobs.job_no` เป็น `690001` (UMEDA) / `P690001` (POND) เพื่อให้คอลัมน์ยัง unique
 * แต่ทีมงานเรียกเลขเดียวกันว่า "690001" ทั้งสองบริษัท → ทุกที่ที่เรนเดอร์ให้คนอ่านต้องผ่านฟังก์ชันนี้
 *
 * 🚨 ห้ามใช้กับ `href` / `revalidatePath` / query — ตรงนั้นต้องเป็นค่าจริงจาก DB เสมอ
 */
export function displayJobNo(jobNo: string | null | undefined): string {
  if (!jobNo) return "—";
  return jobNo.replace(/^[A-Za-z]+/, "");
}

/**
 * แทนเลขงานที่ฝังอยู่ในข้อความสำเร็จรูปด้วยเลขเปล่า
 *
 * ข้อความแจ้งเตือนถูกประกอบใน SQL ตั้งแต่ 0026/0029/0034 (เช่น `'งาน ' || v_job_no || ' ถูกตีกลับ'`)
 * จึงฝังเลขจริง (`P690001`) ไว้ในตัวข้อความ — แทนตอนอ่านถูกกว่าไล่แก้ฟังก์ชันแจ้งเตือนทุกตัว
 */
export function stripJobNo(
  text: string,
  jobNo: string | null | undefined,
): string;
export function stripJobNo(
  text: string | null | undefined,
  jobNo: string | null | undefined,
): string | null;
export function stripJobNo(
  text: string | null | undefined,
  jobNo: string | null | undefined,
): string | null {
  if (!text) return text ?? null;
  if (!jobNo) return text;
  const shown = displayJobNo(jobNo);
  if (shown === jobNo) return text; // ไม่มีอักษรนำ = ไม่ต้องทำอะไร
  return text.split(jobNo).join(shown);
}

/**
 * ค่าว่างบนกระดาษ = "-" (ไม่ใช่ "—" แบบบนจอ) ตามฟอร์มจริงของโรงงาน
 *
 * ใช้กับเอกสารที่พิมพ์ทุกใบ — ใบแจ้งผลิต F.PLN.01 · ตารางบอร์ดงาน F.PLN.10
 */
export function dashOr(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return s === "" ? "-" : s;
}

/**
 * จำนวนบนกระดาษ — คั่นหลักพัน ตัด .00 ทิ้ง (200000 → "200,000")
 *
 * ⚠️ ใช้ locale "en-US" ตั้งใจ ไม่ใช่ "th-TH" — ฟอร์มกระดาษของโรงงานเขียนเลขอารบิกคั่นคอมมา
 *    (ต่างจาก formatQty() ข้างบนที่ใช้บนจอ)
 */
export function fmtQtyPlain(n: number | null | undefined): string {
  if (n == null) return "-";
  return n % 1 === 0
    ? n.toLocaleString("en-US")
    : n.toLocaleString("en-US", { minimumFractionDigits: 2 });
}
