import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/auth/dal";
import {
  deptsOfRoles,
  type UserAdminScope,
} from "@/lib/data/dept-constants";

export type AdminUser = {
  id: string; // profile id
  auth_user_id: string | null; // null = ยังไม่เคยสร้าง/ผูกบัญชี auth (ล็อกอินไม่ได้)
  full_name: string;
  department: string | null;
  email: string | null;
  is_active: boolean;
  /** true = ยังไม่ได้ตั้งรหัสผ่านของตัวเองหลังถูกสร้าง/รีเซ็ต (0079) */
  must_change_password: boolean;
  roles: AppRole[];
};

/**
 * รายชื่อผู้ใช้สำหรับหน้า admin (profiles + roles)
 *
 * อ่านผ่าน RLS ปกติ (authenticated อ่าน profiles/user_roles ได้) — การกันสิทธิ์
 * "ใครเข้าหน้านี้ได้" ทำที่ระดับหน้า/แอ็กชัน และ "ใครแก้ใครได้" ทำที่ RPC ใน DB (0079)
 *
 * `scope` = ตัวกรองรายชื่อ:
 *   manager → เห็นทุกคน
 *   head    → เห็นเฉพาะลูกน้องในฝ่ายตัวเอง + บัญชีที่ยังไม่มีสิทธิ์ (ยังไม่ถูกจัดฝ่าย)
 *
 * ⚠️ การกรองนี้เป็น "การจัดหน้าจอ ไม่ใช่กำแพงความปลอดภัย" — RLS ของ profiles/user_roles
 *    เปิดให้ทุกคนที่ล็อกอินอ่านได้อยู่แล้ว (0003:30-35) กำแพงจริงคือ head_may_manage() ใน DB
 */
export async function listUsers(scope: UserAdminScope): Promise<AdminUser[]> {
  const supabase = await createClient();

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select(
      "id, auth_user_id, full_name, department, email, is_active, must_change_password",
    )
    .order("full_name", { ascending: true });
  if (error || !profiles) return [];

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("profile_id, role");

  const rolesByProfile = new Map<string, AppRole[]>();
  for (const r of roleRows ?? []) {
    const list = rolesByProfile.get(r.profile_id) ?? [];
    list.push(r.role as AppRole);
    rolesByProfile.set(r.profile_id, list);
  }

  const all: AdminUser[] = profiles.map((p) => ({
    id: p.id,
    auth_user_id: p.auth_user_id,
    full_name: p.full_name,
    department: p.department,
    email: p.email,
    is_active: p.is_active,
    must_change_password: p.must_change_password ?? false,
    roles: rolesByProfile.get(p.id) ?? [],
  }));

  if (scope.kind === "manager") return all;

  return all.filter((u) => {
    const depts = deptsOfRoles(u.roles);
    // บัญชีที่ยังไม่มีสิทธิ์ = ยังไม่ถูกจัดฝ่าย → ให้หัวหน้าเห็นเพื่อรับเข้าฝ่ายตัวเองได้
    if (depts.length === 0) return !u.roles.some((r) => r === "manager" || r === "admin");
    return depts.some((d) => scope.depts.includes(d));
  });
}
