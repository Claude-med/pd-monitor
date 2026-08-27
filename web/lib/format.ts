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
