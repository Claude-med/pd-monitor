import Link from "next/link";
import { getProfile } from "@/lib/auth/dal";
import { hasRole } from "@/lib/auth/roles";
import { getProducts } from "@/lib/data/products";
import { NewJobForm } from "./new-job-form";

export const metadata = { title: "สร้างงานผลิตใหม่ — PD Monitor" };

export default async function NewJobPage() {
  const profile = await getProfile();
  const isManager = hasRole(profile?.roles ?? [], "manager");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/board"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับบอร์ดงาน
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">สร้างงานผลิตใหม่</h1>
        <p className="text-sm text-muted-foreground">
          ลงออเดอร์ + เปิดงานผลิต (Job) เข้าระบบ — งานจะเริ่มที่สถานะ “รอแจ้งผลิต”
        </p>
      </div>

      {isManager ? (
        <NewJobForm products={await getProducts()} />
      ) : (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          เฉพาะผู้บริหาร/ฝ่ายวางแผนสร้างงานผลิตได้ — บัญชีของคุณไม่มีสิทธิ์นี้
        </p>
      )}
    </div>
  );
}
