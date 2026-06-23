"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile, type AppRole } from "@/lib/auth/dal";
import { hasRole } from "@/lib/auth/roles";

export type ActionResult = { ok?: boolean; error?: string };

const VALID_ROLES: AppRole[] = [
  "production",
  "qc",
  "qa",
  "warehouse",
  "manager",
  "admin",
];

/** กันสิทธิ์: เฉพาะ manager หรือ admin ที่ login เท่านั้น */
async function requireManager(): Promise<string | null> {
  const profile = await getProfile();
  if (!profile || !hasRole(profile.roles, "manager")) return null;
  return profile.id;
}

function cleanRoles(roles: string[]): AppRole[] {
  return VALID_ROLES.filter((r) => roles.includes(r));
}

/** สร้างบัญชีผู้ใช้ใหม่ (auth + โปรไฟล์ + role) */
export async function createUser(v: {
  email: string;
  password: string;
  full_name: string;
  department: string;
  roles: string[];
}): Promise<ActionResult> {
  if (!(await requireManager())) return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร)" };

  const email = v.email.trim().toLowerCase();
  const full_name = v.full_name.trim();
  if (!email) return { error: "กรุณาระบุอีเมล" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { error: "รูปแบบอีเมลไม่ถูกต้อง" };
  if (!v.password || v.password.length < 6)
    return { error: "รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร" };
  if (!full_name) return { error: "กรุณาระบุชื่อ-สกุล" };

  const admin = createAdminClient();

  // 1) สร้าง auth user (ยืนยันอีเมลให้เลย — โรงงานไม่ต้องกดลิงก์ยืนยัน)
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password: v.password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (authErr || !created?.user) {
    const msg = authErr?.message ?? "สร้างบัญชีไม่สำเร็จ";
    if (/already been registered|already exists/i.test(msg))
      return { error: "อีเมลนี้มีบัญชีอยู่แล้ว" };
    return { error: msg };
  }

  // 2) trigger handle_new_user ผูก/สร้าง profile ตามอีเมลแล้ว → หา profile id
  const { data: profileRow } = await admin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", created.user.id)
    .maybeSingle();
  if (!profileRow?.id) {
    return {
      error:
        "สร้างบัญชีแล้วแต่ผูกโปรไฟล์ไม่สำเร็จ — ตรวจว่ารัน migration 0004 (trigger handle_new_user) แล้ว",
    };
  }

  // 3) ตั้งชื่อ/แผนก + role ผ่าน RPC (audit เก็บ "ใครทำ")
  const supabase = await createClient();
  const { error: pErr } = await supabase.rpc("admin_update_profile", {
    p_profile_id: profileRow.id,
    p_full_name: full_name,
    p_department: v.department.trim() || null,
  });
  if (pErr) return { error: pErr.message };

  const { error: rErr } = await supabase.rpc("admin_set_roles", {
    p_profile_id: profileRow.id,
    p_roles: cleanRoles(v.roles),
  });
  if (rErr) return { error: rErr.message };

  revalidatePath("/admin/users");
  return { ok: true };
}

/** แก้สิทธิ์ (role) ของผู้ใช้ */
export async function setRoles(
  profileId: string,
  roles: string[],
): Promise<ActionResult> {
  if (!(await requireManager())) return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร)" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_roles", {
    p_profile_id: profileId,
    p_roles: cleanRoles(roles),
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/users");
  return { ok: true };
}

/** แก้ชื่อ/แผนกของผู้ใช้ */
export async function updateProfile(
  profileId: string,
  full_name: string,
  department: string,
): Promise<ActionResult> {
  if (!(await requireManager())) return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร)" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_profile", {
    p_profile_id: profileId,
    p_full_name: full_name,
    p_department: department.trim() || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/users");
  return { ok: true };
}

/** รีเซ็ตรหัสผ่าน (admin ตั้งใหม่ — ไม่ใช่ดูของเดิม) */
export async function resetPassword(
  authUserId: string,
  newPassword: string,
): Promise<ActionResult> {
  if (!(await requireManager())) return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร)" };
  if (!authUserId) return { error: "ผู้ใช้นี้ยังไม่มีบัญชีล็อกอิน" };
  if (!newPassword || newPassword.length < 6)
    return { error: "รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร" };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(authUserId, {
    password: newPassword,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

/** เปิด/ระงับบัญชี — ธง is_active (RPC) + บล็อกล็อกอินจริง (ban/unban auth) */
export async function setActive(
  profileId: string,
  authUserId: string | null,
  active: boolean,
): Promise<ActionResult> {
  if (!(await requireManager())) return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร)" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_active", {
    p_profile_id: profileId,
    p_is_active: active,
  });
  if (error) return { error: error.message };

  // บล็อก/ปลดบล็อกการล็อกอินจริงที่ชั้น auth (ถ้ามีบัญชีล็อกอิน)
  if (authUserId) {
    const admin = createAdminClient();
    const { error: banErr } = await admin.auth.admin.updateUserById(authUserId, {
      ban_duration: active ? "none" : "876000h", // ~100 ปี = ระงับถาวรจนกว่าจะเปิด
    });
    if (banErr) return { error: banErr.message };
  }

  revalidatePath("/admin/users");
  return { ok: true };
}
