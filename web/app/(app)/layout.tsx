import { redirect } from "next/navigation";
import { getUser, getProfile } from "@/lib/auth/dal";
import { getUnreadCount } from "@/lib/data/notifications";
import { getPendingEditCount } from "@/lib/data/edit-requests";
import { hasAnyRole } from "@/lib/auth/roles";
import { AppShell } from "@/components/app-shell";
import { EDIT_REVIEWER_ROLES } from "@/lib/data/edit-request-constants";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) redirect("/login");

  const profile = await getProfile();

  // มี auth user แต่ยังไม่ถูกผูกโปรไฟล์ (ปกติ trigger ผูกให้แล้ว) — กัน loop ไม่ redirect กลับ /login
  if (!profile) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-bold">บัญชียังไม่ถูกตั้งค่า</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            อีเมล <span className="font-medium">{user.email}</span>{" "}
            เข้าสู่ระบบได้ แต่ยังไม่ถูกผูกกับโปรไฟล์พนักงาน
            กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดสิทธิ์
          </p>
        </div>
      </main>
    );
  }

  // ---- ด่านที่ 1: บัญชีถูกระงับ (Part E) ----
  // เดิมการ "ระงับบัญชี" พึ่ง ban_duration ของ Supabase Auth อย่างเดียว →
  // โปรไฟล์ที่ยังไม่มี auth_user_id (มาจากข้อมูลตั้งต้น) ระงับแล้วไม่มีผลจริง
  if (!profile.is_active) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-bold">บัญชีถูกระงับ</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            บัญชี <span className="font-medium">{profile.full_name}</span>{" "}
            ถูกระงับการใช้งาน กรุณาติดต่อผู้บริหารหรือหัวหน้าแผนกของคุณ
          </p>
        </div>
      </main>
    );
  }

  // ---- ด่านที่ 2: บังคับตั้งรหัสผ่านใหม่ครั้งแรก (Part E) ----
  // /change-password อยู่นอก route group (app) จึงไม่วนกลับมาที่ layout นี้
  if (profile.must_change_password) redirect("/change-password");

  const unreadCount = await getUnreadCount();
  const pendingEditCount = hasAnyRole(profile.roles, EDIT_REVIEWER_ROLES)
    ? await getPendingEditCount(profile.roles)
    : 0;

  return (
    <AppShell
      profile={profile}
      unreadCount={unreadCount}
      pendingEditCount={pendingEditCount}
    >
      {children}
    </AppShell>
  );
}
