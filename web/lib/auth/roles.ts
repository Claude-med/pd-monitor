import type { AppRole } from "@/lib/auth/dal";

/**
 * Helper เช็คสิทธิ์ฝั่งแอป (pure — ไม่มี import server, ใช้ได้ทั้ง client/server)
 * กติกา: role "admin" = ทำได้ทุกอย่าง → ถือว่ามีทุก role เสมอ
 * (ฝั่ง DB ก็ทำแบบเดียวกันใน has_role() — ดู migration 0013)
 */

export function isAdmin(roles: AppRole[]): boolean {
  return roles.includes("admin");
}

/** ผู้ใช้มีสิทธิ์ role นี้ไหม (admin ผ่านเสมอ) */
export function hasRole(roles: AppRole[], role: AppRole): boolean {
  return roles.includes("admin") || roles.includes(role);
}

/** ผู้ใช้มีสิทธิ์อย่างน้อยหนึ่งใน wanted ไหม (admin ผ่านเสมอ) */
export function hasAnyRole(roles: AppRole[], wanted: AppRole[]): boolean {
  return roles.includes("admin") || wanted.some((r) => roles.includes(r));
}
