import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/auth/dal";

export type AdminUser = {
  id: string; // profile id
  auth_user_id: string | null; // null = ยังไม่เคยสร้าง/ผูกบัญชี auth (ล็อกอินไม่ได้)
  full_name: string;
  department: string | null;
  email: string | null;
  is_active: boolean;
  roles: AppRole[];
};

/**
 * รายชื่อผู้ใช้ทั้งหมดสำหรับหน้า admin (profiles + roles)
 * อ่านผ่าน RLS ปกติ (authenticated อ่าน profiles/user_roles ได้) — การกันสิทธิ์ manager
 * ทำที่ระดับหน้า/แอ็กชัน
 */
export async function listUsers(): Promise<AdminUser[]> {
  const supabase = await createClient();

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, auth_user_id, full_name, department, email, is_active")
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

  return profiles.map((p) => ({
    id: p.id,
    auth_user_id: p.auth_user_id,
    full_name: p.full_name,
    department: p.department,
    email: p.email,
    is_active: p.is_active,
    roles: rolesByProfile.get(p.id) ?? [],
  }));
}
