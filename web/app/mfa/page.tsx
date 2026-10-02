import { redirect } from "next/navigation";
import { getProfile, getUser } from "@/lib/auth/dal";
import { logout } from "@/app/actions/auth";
import { MfaForm } from "./mfa-form";

export const metadata = { title: "ยืนยันตัวตน 2 ชั้น — PD Monitor" };

/**
 * ยืนยันตัวตน 2 ชั้น (MFA) สำหรับผู้บริหาร/ผู้ดูแลระบบ — ดูกติกาใน lib/auth/mfa.ts
 *   setup  = ยังไม่เคยตั้ง → สแกน QR ด้วยแอป Authenticator แล้วกรอกรหัส 6 หลักครั้งแรก
 *   verify = ตั้งแล้ว → กรอกรหัส 6 หลักทุกครั้งที่ล็อกอิน
 *
 * ⚠️ อยู่ "นอก" route group (app) เหมือน /change-password — layout ของ (app) เป็นตัวเด้งมาที่นี่
 */
export default async function MfaPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const profile = await getProfile();
  if (!profile?.mfa_pending) redirect("/");
  const mode = profile.mfa_pending;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">ยืนยันตัวตน 2 ชั้น</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "setup"
              ? "บัญชีผู้บริหาร/ผู้ดูแลระบบ ต้องตั้งรหัสจากแอปในมือถือก่อนใช้งาน (ทำครั้งเดียว)"
              : "กรอกรหัส 6 หลักจากแอป Authenticator ในมือถือของคุณ"}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <MfaForm mode={mode} accountLabel={user.email ?? profile.full_name} />
        </div>

        <p className="mt-6 rounded-md bg-muted/50 px-3 py-2 text-center text-xs text-muted-foreground">
          ทำไมต้องมี: บัญชีนี้สร้างบัญชีผู้อื่น รีเซ็ตรหัสผ่าน และยกเลิกงานได้ —
          ถ้ารหัสผ่านหลุด คนอื่นก็ยังเข้าไม่ได้ถ้าไม่มีมือถือของคุณ ·
          มือถือหาย/เปลี่ยนเครื่อง → ให้ผู้ดูแลระบบอีกคนกด “รีเซ็ต MFA” ให้
        </p>

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
