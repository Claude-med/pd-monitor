import type { AppRole } from "@/lib/auth/dal";

/**
 * ยืนยันตัวตน 2 ชั้น (MFA · รหัส 6 หลักจากแอปในมือถือ) — บังคับเฉพาะผู้บริหาร/ผู้ดูแลระบบ
 * เพราะสองบทบาทนี้สร้างบัญชี รีเซ็ตรหัสคนอื่น และยกเลิกงานได้ทุกสถานะ
 *
 * ด่านมี 3 ชั้น (ต้องตรงกัน):
 *   1. getProfile() (lib/auth/dal.ts) — session ยังไม่ถึง aal2 = ตัด role manager/admin ทิ้ง
 *      ⇒ ทุกหน้า/ทุก server action (รวมงานที่ใช้ secret key) ไม่เห็นสิทธิ์ผู้บริหาร
 *   2. (app)/layout.tsx — เด้งไปหน้า /mfa
 *   3. DB has_role()/has_exact_role() (0110) — role manager/admin นับเฉพาะเมื่อ JWT มี aal = aal2
 *
 * ⚠️ เช็กแบบ "ถือ role นี้ตรง ๆ" ไม่ใช้ hasRole() — hasRole ให้ admin ผ่านทุก role อยู่แล้ว
 */
export const MFA_ROLES: AppRole[] = ["manager", "admin"];

export function requiresMfa(roles: AppRole[]): boolean {
  return roles.some((r) => MFA_ROLES.includes(r));
}

/** ตัด role ที่ต้องใช้ MFA ออก (ใช้ตอน session ยังไม่ยืนยันรหัส 6 หลัก) */
export function withoutMfaRoles(roles: AppRole[]): AppRole[] {
  return roles.filter((r) => !MFA_ROLES.includes(r));
}

/** ชื่อที่แสดงในแอป Authenticator ของผู้ใช้ */
export const MFA_ISSUER = "PD Monitor";
