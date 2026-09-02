import { redirect } from "next/navigation";
import { getProfile, getUser } from "@/lib/auth/dal";
import { logout } from "@/app/actions/auth";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "ตั้งรหัสผ่านใหม่ — PD Monitor" };

/**
 * หน้าตั้งรหัสผ่านใหม่ (Part E — ก้อน 3)
 *
 * ⚠️ อยู่ "นอก" route group (app) โดยตั้งใจ — layout ของ (app) เป็นตัวเด้งผู้ใช้มาที่นี่
 *    ถ้าหน้านี้อยู่ใต้ layout เดียวกันจะ redirect วนไม่รู้จบ
 */
export default async function ChangePasswordPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const profile = await getProfile();
  const forced = profile?.must_change_password ?? false;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">ตั้งรหัสผ่านใหม่</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {forced
              ? "บัญชีนี้ยังใช้รหัสผ่านที่ผู้ดูแลตั้งให้ — ตั้งรหัสของคุณเองก่อนเริ่มใช้งาน"
              : "เปลี่ยนรหัสผ่านของบัญชีคุณ"}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <ChangePasswordForm />
        </div>

        {forced && (
          <p className="mt-6 rounded-md bg-muted/50 px-3 py-2 text-center text-xs text-muted-foreground">
            ทำไมต้องเปลี่ยน: คนที่ตั้งรหัสเริ่มต้นให้คุณรู้รหัสนั้น
            การบันทึกงานในระบบนี้ถือเป็นลายเซ็นของคุณ จึงต้องเป็นรหัสที่คุณรู้คนเดียว
          </p>
        )}

        <form action={logout} className="mt-4 text-center">
          <button
            type="submit"
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            ออกจากระบบ
          </button>
        </form>
      </div>
    </main>
  );
}
