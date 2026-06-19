import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client ฝั่ง browser — ใช้เฉพาะส่วนที่ต้องทำงานบน client เท่านั้น
 * (ดีฟอลต์ให้ใช้ server client ก่อน ตาม server-first) ใช้ publishable key ที่เปิดเผยได้
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
