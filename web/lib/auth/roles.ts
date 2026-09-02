import type { AppRole } from "@/lib/auth/dal";

/**
 * Helper เช็คสิทธิ์ฝั่งแอป (pure — ไม่มี import server, ใช้ได้ทั้ง client/server)
 *
 * กติกา 2 ข้อ — ต้องตรงกับ has_role() ใน DB เป๊ะ (migration 0013 · 0078):
 *   1. role "admin"        = ทำได้ทุกอย่าง → ถือว่ามีทุก role เสมอ
 *   2. role "<ฝ่าย>_lead"  = หัวหน้าฝ่ายนั้น → มีสิทธิ์ของลูกน้องในฝ่ายตัวเองด้วย
 *      (production_lead มีสิทธิ์ของ production · qa_lead มีสิทธิ์ของ qa ฯลฯ)
 *
 * 🚨 การสืบทอดเป็น "ทางเดียว: lead → base" เท่านั้น
 *    hasRole(roles, "production")      → true ถ้าถือ production หรือ production_lead
 *    hasRole(roles, "production_lead") → true เฉพาะผู้ที่ถือ production_lead จริง ๆ
 *    ⇒ กฎ "สองลายเซ็น" ยังอยู่: พนักงานฝ่ายผลิตยังยืนยัน Line Clearance เองไม่ได้
 *      และ QC พนักงานยังอนุมัติผลตรวจ in-process เองไม่ได้
 *
 * ⚠️ ห้ามใช้ 3 ฟังก์ชันนี้ตัดสิน "ผู้ใช้อยู่ฝ่ายไหน" (Incident Case) —
 *    ตรงนั้นต้องใช้ roleGroupOf() ใน lib/data/deviation-constants.ts ซึ่งเทียบ role แบบตรงตัว
 *    ให้ตรงกับ has_exact_role() ใน DB (admin และ lead ไม่สืบทอดที่นั่น)
 */

/** ต่อท้ายชื่อฝ่ายเพื่อให้ได้ชื่อ role หัวหน้าของฝ่ายนั้น — ตรงกับสูตรใน has_role() (0078) */
const LEAD_SUFFIX = "_lead";

export function isAdmin(roles: AppRole[]): boolean {
  return roles.includes("admin");
}

/** ผู้ใช้มีสิทธิ์ role นี้ไหม (admin ผ่านเสมอ · หัวหน้าฝ่ายผ่านสิทธิ์ของฝ่ายตัวเอง) */
export function hasRole(roles: AppRole[], role: AppRole): boolean {
  if (roles.includes("admin")) return true;
  if (roles.includes(role)) return true;
  return roles.includes((role + LEAD_SUFFIX) as AppRole);
}

/** ผู้ใช้มีสิทธิ์อย่างน้อยหนึ่งใน wanted ไหม (กติกาเดียวกับ hasRole) */
export function hasAnyRole(roles: AppRole[], wanted: AppRole[]): boolean {
  if (roles.includes("admin")) return true;
  return wanted.some((r) => hasRole(roles, r));
}
