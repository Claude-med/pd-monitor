// Part E — แผนที่ "role ↔ แผนก" สำหรับหน้าจัดการผู้ใช้ของหัวหน้าแผนก
// ไฟล์นี้ "ไม่มี" server import → ใช้ได้ทั้ง Server และ Client Components
//
// ⚠️ ทุกฟังก์ชันในไฟล์นี้ต้อง "ตรงกับ guard ใน DB" เสมอ (migration 0079):
//      deptOfRole()            ↔ public.dept_of_role(app_role)
//      headDeptsOf()           ↔ public.current_head_depts()
//      deptsOfRoles()          ↔ public.profile_depts(uuid)
//      assignableRolesForHead()↔ public.head_assignable_roles()
//      headMayManage()         ↔ public.head_may_manage(uuid)
//    DB เป็นด่านบังคับจริง · ฝั่งแอปใช้ตัดสินว่าจะ "แสดงอะไร / เปิดช่องไหนให้กรอก"
//
// 🔑 ชื่อ role หัวหน้าต้องเป็น "<ฝ่าย>_lead" เสมอ — ทั้ง DB และแอปใช้สูตรตัดคำต่อท้ายนี้
//    (ดู lib/auth/dal.ts และ has_role() ใน 0078)

import type { AppRole } from "@/lib/auth/dal";
import { ALL_ROLES } from "@/lib/nav";

/** คำต่อท้ายชื่อ role ของหัวหน้าฝ่าย */
const LEAD_SUFFIX = "_lead";

/** role ที่ไม่สังกัดฝ่ายใด — ไม่มีหัวหน้า และหัวหน้าแจกให้ใครไม่ได้ */
const NO_DEPT_ROLES: readonly string[] = ["manager", "admin", "cost"];

export type DeptKey =
  | "planner"
  | "production"
  | "qc"
  | "qa"
  | "warehouse"
  | "engineering";

/** แผนกทั้งหมดที่มีหัวหน้าได้ — ป้ายชื่อนี้คือค่าที่เขียนลง profiles.department ตอนหัวหน้าสร้างบัญชี */
export const DEPARTMENTS: { key: DeptKey; label: string }[] = [
  { key: "planner", label: "ฝ่ายวางแผน" },
  { key: "production", label: "ฝ่ายผลิต" },
  { key: "qc", label: "ฝ่าย QC" },
  { key: "qa", label: "ฝ่าย QA" },
  { key: "warehouse", label: "ฝ่ายคลังสินค้า" },
  { key: "engineering", label: "ฝ่ายวิศวกรรม" },
];

export const DEPT_LABEL: Record<DeptKey, string> = Object.fromEntries(
  DEPARTMENTS.map((d) => [d.key, d.label]),
) as Record<DeptKey, string>;

/**
 * ฝ่ายของ role หนึ่ง ๆ — ตัด "_lead" ออก · manager/admin/cost คืน null
 * ตรงกับ public.dept_of_role() ใน 0079
 */
export function deptOfRole(role: AppRole): DeptKey | null {
  if (NO_DEPT_ROLES.includes(role)) return null;
  const base = role.endsWith(LEAD_SUFFIX)
    ? role.slice(0, -LEAD_SUFFIX.length)
    : role;
  return DEPARTMENTS.some((d) => d.key === base) ? (base as DeptKey) : null;
}

/** ฝ่ายที่ชุด role นี้สังกัด (ใช้ทั้งกับผู้ใช้ปัจจุบันและกับเป้าหมาย) */
export function deptsOfRoles(roles: AppRole[]): DeptKey[] {
  const out = new Set<DeptKey>();
  for (const r of roles) {
    const d = deptOfRole(r);
    if (d) out.add(d);
  }
  return [...out];
}

/** ฝ่ายที่ผู้ใช้เป็น "หัวหน้า" (ถือหลาย *_lead พร้อมกันได้) — ตรงกับ current_head_depts() */
export function headDeptsOf(roles: AppRole[]): DeptKey[] {
  const out = new Set<DeptKey>();
  for (const r of roles) {
    if (!r.endsWith(LEAD_SUFFIX)) continue;
    const d = deptOfRole(r);
    if (d) out.add(d);
  }
  return [...out];
}

/**
 * role ที่หัวหน้าแผนก "ติ๊กให้ลูกน้องได้" — role พื้นของฝ่ายตัวเองเท่านั้น
 * 🔒 ไม่มี *_lead / manager / admin → บัญชีที่หัวหน้าสร้างจึงไม่มีสิทธิ์อนุมัติระดับหัวหน้า
 * ตรงกับ public.head_assignable_roles() ใน 0079
 *
 * ⚠️ วนจาก ALL_ROLES (รายชื่อ role เดียวของทั้งระบบ) — ห้ามก็อปรายชื่อมาไว้ที่นี่ซ้ำ
 */
export function assignableRolesForHead(depts: DeptKey[]): AppRole[] {
  return ALL_ROLES.filter((r) => {
    if (r.endsWith(LEAD_SUFFIX)) return false;
    const d = deptOfRole(r);
    return d !== null && depts.includes(d);
  });
}

/** เป้าหมายถือสิทธิ์ระดับหัวหน้า/ผู้บริหารอยู่ไหม (หัวหน้าแผนกห้ามแตะ) */
export function isPrivilegedProfile(roles: AppRole[]): boolean {
  return roles.some(
    (r) => r === "manager" || r === "admin" || r.endsWith(LEAD_SUFFIX),
  );
}

/**
 * หัวหน้าแผนก (ที่ดูแลฝ่าย headDepts) จัดการโปรไฟล์เป้าหมายนี้ได้ไหม
 * ตรงกับ public.head_may_manage() ใน 0079 — DB ยังตรวจซ้ำเป็นด่านจริง
 */
export function headMayManage(
  headDepts: DeptKey[],
  target: { roles: AppRole[]; isSelf: boolean },
): boolean {
  if (headDepts.length === 0) return false;
  if (target.isSelf) return false; // กันยกระดับสิทธิ์ตัวเอง
  if (isPrivilegedProfile(target.roles)) return false;

  const targetDepts = deptsOfRoles(target.roles);
  // บัญชีที่ยังไม่มีสิทธิ์เลย → หัวหน้ารับเข้าฝ่ายตัวเองได้ (จำเป็นตอนสร้างบัญชีใหม่)
  if (targetDepts.length === 0) return true;
  return targetDepts.every((d) => headDepts.includes(d));
}

/**
 * ขอบเขตของผู้ใช้ในหน้า "จัดการผู้ใช้"
 *   manager = เห็น/จัดการทุกคน · head = เฉพาะลูกน้องในฝ่ายตัวเอง
 */
export type UserAdminScope =
  | { kind: "manager" }
  | { kind: "head"; depts: DeptKey[] };
