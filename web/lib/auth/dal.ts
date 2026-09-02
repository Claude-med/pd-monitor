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
  // ---- role หัวหน้าแผนก ----
  // ⚠️ ชื่อต้องเป็น "<ฝ่าย>_lead" เสมอ — has_role() ใน DB (0078) และ hasRole() ใน
  //    lib/auth/roles.ts ใช้สูตรต่อท้าย "_lead" ตัดสินว่าหัวหน้าได้สิทธิ์ของฝ่ายไหน
  | "production_lead" // หัวหน้าฝ่ายผลิต — ยืนยัน Line Clearance (Part C.3)
  | "qc_lead" // หัวหน้า QC — อนุมัติผลตรวจ in-process (Part C.3)
  | "planner_lead" // หัวหน้าฝ่ายวางแผน (Part E)
  | "qa_lead" // หัวหน้า QA (Part E)
  | "warehouse_lead" // หัวหน้าคลังสินค้า (Part E)
  | "engineering_lead"; // หัวหน้าฝ่ายวิศวกรรม (Part E)

export type Profile = {
  id: string;
  full_name: string;
  department: string | null;
  email: string | null;
  /** false = บัญชีถูกระงับ — layout กันไม่ให้ใช้งานต่อ (0079) */
  is_active: boolean;
  /** true = ต้องตั้งรหัสผ่านใหม่เองก่อนใช้งาน — layout เด้งไป /change-password (0079) */
  must_change_password: boolean;
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
    .select("id, full_name, department, email, is_active, must_change_password")
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
    is_active: profile.is_active ?? true,
    must_change_password: profile.must_change_password ?? false,
    roles: (roles ?? []).map((r) => r.role as AppRole),
  };
});
