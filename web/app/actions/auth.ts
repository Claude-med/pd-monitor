"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isRateLimited, RATE_LIMIT_MESSAGE } from "@/lib/auth/verify-password";

export type LoginState = { error?: string; email?: string } | undefined;

/**
 * Server Action: เข้าสู่ระบบด้วยอีเมล + รหัสผ่าน (Supabase Auth)
 * cookie session ถูกตั้งฝั่ง server ผ่าน createClient()
 */
export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    // คงค่าอีเมลที่กรอกไว้ กันผู้ใช้ต้องพิมพ์ใหม่
    return { error: "กรุณากรอกอีเมลและรหัสผ่าน", email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // ลองถี่เกิน (429) ≠ รหัสผิด — แยกข้อความ ไม่งั้นผู้ใช้กดซ้ำจนโดนล็อกนานขึ้น
    if (isRateLimited(error)) return { error: RATE_LIMIT_MESSAGE, email };
    return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง", email };
  }

  redirect("/");
}

/** Server Action: ออกจากระบบ */
export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
