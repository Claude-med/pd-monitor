import { getProfile } from "@/lib/auth/dal";
import { canSetJobNo } from "@/lib/data/role-access";
import { listJobNoConfig } from "@/lib/data/companies";
import { CompaniesAdmin } from "./companies-admin";

export const metadata = { title: "บริษัท / เลขงาน — PD Monitor" };

export default async function AdminCompaniesPage() {
  const profile = await getProfile();
  // Part F — ฝ่ายวางแผนตั้งเลขงานเองได้ (ตรงกับ can_set_job_no() ใน 0090)
  const canEdit = canSetJobNo(profile?.roles ?? []);

  if (!canEdit) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 text-2xl font-bold tracking-tight">บริษัท / เลขงาน</h1>
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          เฉพาะฝ่ายวางแผน/ผู้บริหารเข้าหน้านี้ได้ — บัญชีของคุณไม่มีสิทธิ์
        </p>
      </div>
    );
  }

  const companies = await listJobNoConfig();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">บริษัท / เลขงาน</h1>
        <p className="text-sm text-muted-foreground">
          ตั้งเลข Job No. ที่ระบบจะออกให้แต่ละบริษัท — ใช้ตอนย้ายข้อมูลมาจากกระดาษ
          หรือตอนขึ้นปี พ.ศ. ใหม่
        </p>
      </div>
      <CompaniesAdmin companies={companies} />
    </div>
  );
}
