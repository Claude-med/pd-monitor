import { redirect } from "next/navigation";
import { getUser, getProfile } from "@/lib/auth/dal";
import { AppShell } from "@/components/app-shell";

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

  return <AppShell profile={profile}>{children}</AppShell>;
}
