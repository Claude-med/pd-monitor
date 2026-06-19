import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client ฝั่ง server — ใช้ใน Server Components / Server Actions / Route Handlers
 * (server-first ตาม recommendations.md B3) อ่าน/เขียน session ผ่าน cookies
 * ใช้ publishable key เท่านั้น (key ลับ SUPABASE_SECRET_KEY ใช้เฉพาะงาน admin แยกต่างหาก)
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // ถูกเรียกจาก Server Component — ตั้ง cookie ไม่ได้ ปล่อยผ่าน
            // (session จะถูก refresh ที่ middleware ในเฟสถัดไป)
          }
        },
      },
    },
  );
}
