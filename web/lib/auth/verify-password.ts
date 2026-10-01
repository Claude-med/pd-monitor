import { createClient } from "@supabase/supabase-js";
import { getUser } from "@/lib/auth/dal";

/**
 * ยืนยันรหัสผ่านซ้ำก่อนทำสิ่งสำคัญ (ลงนาม QC/QA · ลบงาน · ลบบัญชี · ลบผลิตภัณฑ์ถาวร)
 * = พิสูจน์ว่า "คนหน้าจอ = เจ้าของบัญชี" ตอนตัดสินใจ
 *
 * ใช้ client แยก (publishable key, ไม่เก็บ session) → ไม่แตะ cookie/session ที่ล็อกอินอยู่
 * ใช้ได้เฉพาะฝั่ง server (Server Actions) เท่านั้น
 *
 * คืน null = ผ่าน · คืนข้อความ = ไม่ผ่าน (ส่งต่อให้ผู้ใช้ได้เลย)
 * `action` = ชื่อสิ่งที่กำลังทำ ใช้ต่อท้ายข้อความ เช่น "ลบงาน" → "รหัสผ่านไม่ถูกต้อง — ลบงานไม่สำเร็จ"
 */
export async function verifyPassword(
  password: string,
  action: string,
): Promise<string | null> {
  const user = await getUser();
  if (!user?.email) return "ยังไม่ได้เข้าสู่ระบบ";

  const verifier = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { error } = await verifier.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (!error) return null;
  if (isRateLimited(error)) return RATE_LIMIT_MESSAGE;
  return `รหัสผ่านไม่ถูกต้อง — ${action}ไม่สำเร็จ`;
}

/** ข้อความเมื่อ Supabase Auth ให้รอ (ลองรหัสถี่เกินไป) — ใช้ร่วมกับหน้าล็อกอิน */
export const RATE_LIMIT_MESSAGE =
  "ลองบ่อยเกินไป ระบบให้รอสักครู่ — รอประมาณ 1 นาทีแล้วลองใหม่ (ไม่ใช่รหัสผ่านผิดเสมอไป)";

/**
 * Supabase Auth ตอบ 429 เมื่อยิงถี่เกิน (rate limit)
 * เดิมทุกจุดแสดง "รหัสผ่านไม่ถูกต้อง" ทั้งที่รหัสอาจถูก → ผู้ใช้สับสนแล้วลองซ้ำจนโดนล็อกนานขึ้น
 */
export function isRateLimited(
  error: { status?: number; code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  return (
    error.status === 429 ||
    (error.code ?? "").startsWith("over_") ||
    /rate limit/i.test(error.message ?? "")
  );
}
