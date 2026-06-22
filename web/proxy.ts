import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy-session";

/**
 * Proxy (Next.js 16 — เดิมชื่อ middleware) รันก่อนทุก request:
 * รีเฟรช session Supabase + กันหน้า protected (ดู lib/supabase/proxy-session.ts)
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * รันทุก path ยกเว้น static/asset:
     * - _next/static, _next/image
     * - favicon, manifest, ไฟล์รูป/ไอคอน
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
