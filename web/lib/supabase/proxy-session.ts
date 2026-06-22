import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** หน้าที่เปิดได้โดยไม่ต้อง login */
const PUBLIC_PATHS = ["/login"];

/**
 * รีเฟรช session ของ Supabase ในชั้น proxy (Next.js 16) + กันหน้า protected
 * อิงแพตเทิร์น Supabase SSR — สำคัญ: อย่าใส่ logic คั่นระหว่าง createServerClient กับ getUser()
 * (เสี่ยง session หลุดแบบหา bug ยาก)
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some(
    (p) => path === p || path.startsWith(p + "/"),
  );

  // ยังไม่ login + เข้าหน้า protected → ไป /login
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // login แล้วแต่ยังอยู่หน้า /login → ส่งกลับหน้าแรก
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}
