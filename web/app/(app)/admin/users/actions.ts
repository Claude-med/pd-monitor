"use server";

import { revalidatePath } from "next/cache";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile, getUser, type AppRole } from "@/lib/auth/dal";
import { hasRole } from "@/lib/auth/roles";
import { ALL_ROLES } from "@/lib/nav";
import {
  DEPT_LABEL,
  assignableRolesForHead,
  headDeptsOf,
  headMayManage,
  type UserAdminScope,
} from "@/lib/data/dept-constants";

export type ActionResult = { ok?: boolean; error?: string };

type Actor = { profileId: string; scope: UserAdminScope };

/**
 * กันสิทธิ์เข้าหน้าจัดการผู้ใช้ — ผู้บริหาร/admin (เห็นทุกคน) หรือหัวหน้าแผนก (เฉพาะฝ่ายตัวเอง)
 * ⚠️ เช็ก manager ก่อนเสมอ — ผู้บริหารที่ถือ role หัวหน้าด้วยต้องได้ขอบเขตเต็ม
 */
async function requireUserAdmin(): Promise<Actor | null> {
  const profile = await getProfile();
  if (!profile) return null;
  if (hasRole(profile.roles, "manager"))
    return { profileId: profile.id, scope: { kind: "manager" } };
  const depts = headDeptsOf(profile.roles);
  if (depts.length > 0)
    return { profileId: profile.id, scope: { kind: "head", depts } };
  return null;
}

/** role ปัจจุบันของโปรไฟล์เป้าหมาย (ใช้ตัดสินขอบเขตของหัวหน้าแผนกฝั่ง server) */
async function rolesOfProfile(profileId: string): Promise<AppRole[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("profile_id", profileId);
  return (data ?? []).map((r) => r.role as AppRole);
}

/**
 * ผู้ใช้ปัจจุบันจัดการโปรไฟล์เป้าหมายนี้ได้ไหม — คืนข้อความ error ถ้าไม่ได้
 * สะท้อนกติกา head_may_manage() ใน DB (0079) ซึ่งเป็นด่านบังคับจริง
 */
async function denyIfOutOfScope(
  actor: Actor,
  targetProfileId: string,
): Promise<string | null> {
  if (actor.scope.kind === "manager") return null;
  const targetRoles = await rolesOfProfile(targetProfileId);
  const ok = headMayManage(actor.scope.depts, {
    roles: targetRoles,
    isSelf: targetProfileId === actor.profileId,
  });
  return ok
    ? null
    : "ไม่มีสิทธิ์จัดการบัญชีนี้ — หัวหน้าแผนกดูแลได้เฉพาะพนักงานในฝ่ายตัวเอง";
}

/**
 * กรองเฉพาะ role ที่มีจริง (กันค่าแปลกปลอม + กันซ้ำ)
 * ⚠️ ใช้ ALL_ROLES จาก lib/nav เป็นรายชื่อเดียวของทั้งระบบ —
 *    ห้ามก็อปรายชื่อ role มาไว้ที่นี่ซ้ำ ไม่งั้นเพิ่ม role ใหม่แล้วจะถูกคัดทิ้งเงียบๆ
 */
function cleanRoles(roles: string[]): AppRole[] {
  return ALL_ROLES.filter((r) => roles.includes(r));
}

/**
 * หัวหน้าแผนกแจก role ชุดนี้ได้ไหม — ต้องอยู่ใน role พื้นของฝ่ายตัวเองทั้งหมด
 * (ห้ามแจกสิทธิ์ระดับหัวหน้า/ผู้บริหาร/ผู้ดูแลระบบ = ข้อห้าม "ลูกน้องไม่มีสิทธิ์อนุมัติ")
 */
function denyIfRolesNotAssignable(
  scope: UserAdminScope,
  roles: AppRole[],
): string | null {
  if (scope.kind === "manager") return null;
  const allowed = assignableRolesForHead(scope.depts);
  return roles.every((r) => allowed.includes(r))
    ? null
    : "หัวหน้าแผนกกำหนดได้เฉพาะสิทธิ์ของพนักงานในฝ่ายตัวเอง — ให้สิทธิ์ระดับหัวหน้า/ผู้บริหารไม่ได้";
}

/** แผนกที่จะเขียนลงโปรไฟล์ — หัวหน้าถูกล็อกเป็นฝ่ายตัวเอง ไม่รับค่าจากฟอร์ม */
function resolveDepartment(scope: UserAdminScope, raw: string): string {
  if (scope.kind === "manager") return raw.trim();
  return scope.depts.map((d) => DEPT_LABEL[d]).join(" / ");
}

/** สร้างบัญชีผู้ใช้ใหม่ (auth + โปรไฟล์ + role) */
export async function createUser(v: {
  email: string;
  password: string;
  full_name: string;
  department: string;
  roles: string[];
}): Promise<ActionResult> {
  const actor = await requireUserAdmin();
  if (!actor) return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร/หัวหน้าแผนก)" };

  const email = v.email.trim().toLowerCase();
  const full_name = v.full_name.trim();
  if (!email) return { error: "กรุณาระบุอีเมล" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { error: "รูปแบบอีเมลไม่ถูกต้อง" };
  if (!v.password || v.password.length < 6)
    return { error: "รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร" };
  if (!full_name) return { error: "กรุณาระบุชื่อ-สกุล" };

  const roles = cleanRoles(v.roles);
  const roleErr = denyIfRolesNotAssignable(actor.scope, roles);
  if (roleErr) return { error: roleErr };

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

  /**
   * ล้างบัญชีที่สร้างค้างไว้เมื่อขั้นถัดไปล้มเหลว
   * (เดิมไม่มี rollback → fail กลางทางแล้วเหลือ auth user + profile ที่ไม่มี role
   *  ค้างในระบบ สร้างซ้ำด้วยอีเมลเดิมก็ไม่ได้เพราะติด "อีเมลนี้มีบัญชีอยู่แล้ว")
   */
  const rollback = async (message: string): Promise<ActionResult> => {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: message };
  };

  // 2) trigger handle_new_user ผูก/สร้าง profile ตามอีเมลแล้ว → หา profile id
  const { data: profileRow } = await admin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", created.user.id)
    .maybeSingle();
  if (!profileRow?.id) {
    return rollback(
      "สร้างบัญชีแล้วแต่ผูกโปรไฟล์ไม่สำเร็จ — ตรวจว่ารัน migration 0004 (trigger handle_new_user) แล้ว",
    );
  }

  // 3) ตั้งชื่อ/แผนก + role ผ่าน RPC (audit เก็บ "ใครทำ")
  const supabase = await createClient();
  const { error: pErr } = await supabase.rpc("admin_update_profile", {
    p_profile_id: profileRow.id,
    p_full_name: full_name,
    p_department: resolveDepartment(actor.scope, v.department) || null,
  });
  if (pErr) return rollback(pErr.message);

  const { error: rErr } = await supabase.rpc("admin_set_roles", {
    p_profile_id: profileRow.id,
    p_roles: roles,
  });
  if (rErr) return rollback(rErr.message);

  // 4) บังคับให้เจ้าตัวตั้งรหัสผ่านใหม่เอง — คนสร้างบัญชีรู้รหัสเริ่มต้น
  //    ถ้าไม่บังคับ จะล็อกอินแทนลูกน้องได้ = ทำลายกฎ "สองลายเซ็นต้องคนละคน" (GMP)
  const { error: mErr } = await supabase.rpc("admin_mark_password_reset", {
    p_profile_id: profileRow.id,
  });
  if (mErr) return rollback(mErr.message);

  revalidatePath("/admin/users");
  return { ok: true };
}

/** แก้สิทธิ์ (role) ของผู้ใช้ */
export async function setRoles(
  profileId: string,
  roles: string[],
): Promise<ActionResult> {
  const actor = await requireUserAdmin();
  if (!actor) return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร/หัวหน้าแผนก)" };
  const scopeErr = await denyIfOutOfScope(actor, profileId);
  if (scopeErr) return { error: scopeErr };

  const clean = cleanRoles(roles);
  const roleErr = denyIfRolesNotAssignable(actor.scope, clean);
  if (roleErr) return { error: roleErr };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_roles", {
    p_profile_id: profileId,
    p_roles: clean,
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
  const actor = await requireUserAdmin();
  if (!actor) return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร/หัวหน้าแผนก)" };
  const scopeErr = await denyIfOutOfScope(actor, profileId);
  if (scopeErr) return { error: scopeErr };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_profile", {
    p_profile_id: profileId,
    p_full_name: full_name,
    p_department: resolveDepartment(actor.scope, department) || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/users");
  return { ok: true };
}

/**
 * รีเซ็ตรหัสผ่าน (ตั้งใหม่ — ไม่ใช่ดูของเดิม)
 * เขียน audit + ตั้งธงบังคับเปลี่ยนรหัสผ่านผ่าน RPC ก่อนเสมอ
 * (เดิมคุยกับ Auth Admin API ตรง ๆ อย่างเดียว → ไม่มีร่องรอยใน audit_log เลย)
 */
export async function resetPassword(
  profileId: string,
  authUserId: string,
  newPassword: string,
): Promise<ActionResult> {
  const actor = await requireUserAdmin();
  if (!actor) return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร/หัวหน้าแผนก)" };
  const scopeErr = await denyIfOutOfScope(actor, profileId);
  if (scopeErr) return { error: scopeErr };
  if (!authUserId) return { error: "ผู้ใช้นี้ยังไม่มีบัญชีล็อกอิน" };
  if (!newPassword || newPassword.length < 6)
    return { error: "รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร" };

  const supabase = await createClient();
  const { error: mErr } = await supabase.rpc("admin_mark_password_reset", {
    p_profile_id: profileId,
  });
  if (mErr) return { error: mErr.message };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(authUserId, {
    password: newPassword,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/users");
  return { ok: true };
}

/** เปิด/ระงับบัญชี — ธง is_active (RPC) + บล็อกล็อกอินจริง (ban/unban auth) */
export async function setActive(
  profileId: string,
  authUserId: string | null,
  active: boolean,
): Promise<ActionResult> {
  const actor = await requireUserAdmin();
  if (!actor) return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร/หัวหน้าแผนก)" };
  const scopeErr = await denyIfOutOfScope(actor, profileId);
  if (scopeErr) return { error: scopeErr };

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

/**
 * ลบบัญชีผู้ใช้ (ทีละบัญชี) — ผู้บริหาร/admin ลบได้ทุกบัญชี · หัวหน้าแผนกเฉพาะลูกน้องในฝ่ายตัวเอง
 *
 * ต้องยืนยันรหัสผ่านของผู้กดซ้ำก่อนเสมอ (แบบเดียวกับปุ่ม "ลบงาน" — board/actions.ts:41)
 * = พิสูจน์ว่า "คนหน้าจอ = เจ้าของบัญชีจริง" ตอนทำสิ่งที่ย้อนกลับไม่ได้
 *
 * ⚠️ ลำดับสำคัญ: เรียก RPC ก่อน แล้วค่อยลบบัญชีล็อกอิน
 *    RPC ตั้ง is_active = false ให้แล้ว ⇒ ด่านใน (app)/layout.tsx บล็อกการใช้งานทันที
 *    ถ้าลบ auth ก่อนแล้ว RPC พัง จะได้บัญชีที่ล็อกอินไม่ได้แต่ยังอยู่ในรายชื่อ (แย่กว่า)
 */
export async function deleteUser(
  profileId: string,
  authUserId: string | null,
  password: string,
): Promise<ActionResult & { action?: "deleted" | "archived" }> {
  const actor = await requireUserAdmin();
  if (!actor) return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร/หัวหน้าแผนก)" };
  if (profileId === actor.profileId) return { error: "ลบบัญชีตัวเองไม่ได้" };
  const scopeErr = await denyIfOutOfScope(actor, profileId);
  if (scopeErr) return { error: scopeErr };
  if (!password.trim()) return { error: "กรุณากรอกรหัสผ่านเพื่อยืนยันการลบ" };

  const user = await getUser();
  if (!user?.email) return { error: "ยังไม่ได้เข้าสู่ระบบ" };

  // ยืนยันรหัสผ่านด้วย client แยก (publishable key, ไม่เก็บ session) → ไม่กระทบ session ปัจจุบัน
  const verifier = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { error: authError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (authError) return { error: "รหัสผ่านไม่ถูกต้อง — ลบบัญชีไม่สำเร็จ" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_delete_user", {
    p_profile_id: profileId,
  });
  if (error) return { error: error.message || "ลบบัญชีไม่สำเร็จ" };

  const action =
    (data as { action?: string } | null)?.action === "deleted"
      ? "deleted"
      : "archived";

  // ลบบัญชีล็อกอินจริงที่ชั้น auth — ถ้าลบไม่ได้ ให้แบนถาวรไว้ก่อน แล้วบอกผู้ใช้ตรง ๆ
  if (authUserId) {
    const admin = createAdminClient();
    const { error: delErr } = await admin.auth.admin.deleteUser(authUserId);
    if (delErr) {
      const { error: banErr } = await admin.auth.admin.updateUserById(
        authUserId,
        { ban_duration: "876000h" },
      );
      revalidatePath("/admin/users");
      return {
        ok: true,
        action,
        error: banErr
          ? "ลบบัญชีในระบบแล้ว แต่ลบบัญชีล็อกอินไม่สำเร็จ — บัญชีนี้ถูกระงับไว้ กรุณาแจ้งผู้ดูแลระบบ"
          : "ลบบัญชีในระบบแล้ว (บัญชีล็อกอินถูกระงับถาวรแทนการลบ)",
      };
    }
  }

  revalidatePath("/admin/users");
  return { ok: true, action };
}
