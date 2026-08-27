import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Data Access Layer สำหรับ auth — ตรวจ session/โปรไฟล์/role ฝั่ง server
 * ใช้ React cache() กันยิง query ซ้ำใน render รอบเดียว
 */

export type AppRole =
  | "production"
  | "qc"
  | "qa"
  | "warehouse"
  | "manager"
  | "admin"
  | "planner" // ฝ่ายวางแผน (PLN) — สร้างงาน/ยืนยันแผน
  | "cost" // บัญชีต้นทุน (COST) — ดูต้นทุนค่าแรง
  | "engineering" // วิศวกรรม (ENG) — กำหนดซ่อมบำรุง/สอบเทียบ
  | "production_lead" // หัวหน้าฝ่ายผลิต — ยืนยัน Line Clearance (Part C.3)
  | "qc_lead"; // หัวหน้า QC — อนุมัติผลตรวจ in-process (Part C.3)

export type Profile = {
  id: string;
  full_name: string;
  department: string | null;
  email: string | null;
  roles: AppRole[];
};

/** ผู้ใช้ที่ login อยู่ (จาก Supabase Auth) หรือ null */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** โปรไฟล์ + role ของผู้ใช้ปัจจุบัน (null ถ้ายังไม่ login หรือยังไม่ผูกโปรไฟล์) */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, department, email")
    .eq("auth_user_id", user.id)
    .single();

  if (!profile) return null;

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("profile_id", profile.id);

  return {
    id: profile.id,
    full_name: profile.full_name,
    department: profile.department,
    email: profile.email,
    roles: (roles ?? []).map((r) => r.role as AppRole),
  };
});
