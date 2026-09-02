import { getProfile } from "@/lib/auth/dal";
import { hasRole } from "@/lib/auth/roles";
import { listUsers } from "@/lib/data/admin-users";
import {
  DEPT_LABEL,
  headDeptsOf,
  type UserAdminScope,
} from "@/lib/data/dept-constants";
import { UsersAdmin } from "./users-admin";

export const metadata = { title: "จัดการผู้ใช้ — PD Monitor" };

export default async function AdminUsersPage() {
  const profile = await getProfile();
  const roles = profile?.roles ?? [];

  // ผู้บริหาร/admin เห็นทุกคน · หัวหน้าแผนกเห็นเฉพาะลูกน้องในฝ่ายตัวเอง (Part E)
  // ⚠️ เช็ก manager ก่อนเสมอ — ผู้บริหารที่บังเอิญถือ role หัวหน้าด้วยต้องได้ขอบเขตเต็ม
  const headDepts = headDeptsOf(roles);
  const scope: UserAdminScope | null = hasRole(roles, "manager")
    ? { kind: "manager" }
    : headDepts.length > 0
      ? { kind: "head", depts: headDepts }
      : null;

  if (!scope) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 text-2xl font-bold tracking-tight">จัดการผู้ใช้</h1>
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          เฉพาะผู้บริหารและหัวหน้าแผนกเข้าหน้านี้ได้ — บัญชีของคุณไม่มีสิทธิ์
        </p>
      </div>
    );
  }

  const users = await listUsers(scope);
  const deptNames =
    scope.kind === "head"
      ? scope.depts.map((d) => DEPT_LABEL[d]).join(" · ")
      : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">จัดการผู้ใช้</h1>
        <p className="text-sm text-muted-foreground">
          {scope.kind === "manager"
            ? "สร้างบัญชี · กำหนดสิทธิ์ (role) · รีเซ็ตรหัสผ่าน · ระงับบัญชี — สำหรับเปิดใช้งานจริงทั้งทีม"
            : `สร้างและดูแลบัญชีพนักงานใน${deptNames} — เห็นและแก้ได้เฉพาะคนในฝ่ายของคุณ`}
        </p>
      </div>
      <UsersAdmin
        users={users}
        currentProfileId={profile!.id}
        scope={scope}
      />
    </div>
  );
}
