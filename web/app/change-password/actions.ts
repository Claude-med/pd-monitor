"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/dal";

export type ChangePasswordState = { error?: string } | undefined;

/**
 * Server Action: ผู้ใช้ตั้งรหัสผ่านใหม่ด้วยตัวเอง (Part E — ก้อน 3)
 *
 * ใช้กับกรณี "บังคับเปลี่ยนรหัสผ่านครั้งแรก" — บัญชีที่ผู้บริหาร/หัวหน้าแผนกสร้างหรือรีเซ็ตให้
 * จะถูกตั้งธง profiles.must_change_password = true (0079) และ layout จะเด้งมาหน้านี้จนกว่าจะเปลี่ยน
 *
 * ทำไมต้องบังคับ: คนที่ตั้งรหัสเริ่มต้นให้ "รู้รหัสนั้น" → ถ้าไม่บังคับเปลี่ยน จะล็อกอินแทนกันได้
 * ซึ่งทำลายกฎ "สองลายเซ็นต้องคนละคน" ของ Line Clearance และ in-process QC (หัวใจ GMP ของระบบนี้)
 */
export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8)
    return { error: "รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร" };
  if (password !== confirm) return { error: "รหัสผ่านทั้งสองช่องไม่ตรงกัน" };

  const user = await getUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  // 1) เปลี่ยนรหัสจริงที่ชั้น Auth (ทำกับ session ของเจ้าตัว ไม่ใช้ service key)
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    // Supabase ปฏิเสธเมื่อรหัสใหม่ซ้ำกับรหัสเดิม — บอกเป็นภาษาคนแทนข้อความดิบ
    if (/should be different|same as the old/i.test(error.message))
      return { error: "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม" };
    return { error: error.message };
  }

  // 2) ปลดธงบังคับเปลี่ยนรหัส — RPC ปลดได้เฉพาะบัญชีตัวเอง + เขียน audit ให้ (0079)
  const { error: rpcErr } = await supabase.rpc("clear_must_change_password");
  if (rpcErr) return { error: rpcErr.message };

  redirect("/");
}
