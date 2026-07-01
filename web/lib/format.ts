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
