import { getProfile } from "@/lib/auth/dal";
import { hasRole } from "@/lib/auth/roles";
import { listUsers } from "@/lib/data/admin-users";
import { UsersAdmin } from "./users-admin";

export const metadata = { title: "จัดการผู้ใช้ — PD Monitor" };

export default async function AdminUsersPage() {
  const profile = await getProfile();
  const isManager = hasRole(profile?.roles ?? [], "manager");

  if (!isManager) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 text-2xl font-bold tracking-tight">จัดการผู้ใช้</h1>
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          เฉพาะผู้บริหารเข้าหน้านี้ได้ — บัญชีของคุณไม่มีสิทธิ์
        </p>
      </div>
    );
  }

  const users = await listUsers();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">จัดการผู้ใช้</h1>
        <p className="text-sm text-muted-foreground">
          สร้างบัญชี · กำหนดสิทธิ์ (role) · รีเซ็ตรหัสผ่าน · ระงับบัญชี — สำหรับเปิดใช้งานจริงทั้งทีม
        </p>
      </div>
      <UsersAdmin users={users} currentProfileId={profile!.id} />
    </div>
  );
}
