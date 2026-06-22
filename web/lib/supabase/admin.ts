import { createClient } from "@supabase/supabase-js";

/**
 * Supabase admin client — ใช้ SECRET key (ข้าม RLS) สำหรับงาน admin ฝั่ง server เท่านั้น
 * ⚠️ ห้าม import จาก Client Component เด็ดขาด (คีย์ลับจะรั่ว)
 * ใช้เช่น: สร้าง/จัดการผู้ใช้, งานเบื้องหลังที่ต้องข้ามสิทธิ์ RLS
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
