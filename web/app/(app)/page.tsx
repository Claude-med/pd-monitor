import { getProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

const STATUS_LABELS: Record<string, string> = {
  pending_announce: "รอแจ้งผลิต",
  planned: "มีแผนแล้ว",
  in_production: "กำลังผลิต",
  qc: "รอ/อยู่ QC",
  qa: "รอ/อยู่ QA",
  finished_goods: "เสร็จ (FG)",
};

const STATUS_ORDER = [
  "pending_announce",
  "planned",
  "in_production",
  "qc",
  "qa",
  "finished_goods",
];

export default async function DashboardPage() {
  const profile = await getProfile();
  const supabase = await createClient();

  // อ่านงานทั้งหมด (RLS: ผู้ใช้ที่ login อ่านได้) — พิสูจน์ auth→DB ครบวงจร
  const { data: jobs } = await supabase.from("jobs").select("status, problem");

  const counts: Record<string, number> = {};
  let problemCount = 0;
  for (const j of jobs ?? []) {
    counts[j.status] = (counts[j.status] ?? 0) + 1;
    if (j.problem) problemCount += 1;
  }
  const total = jobs?.length ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          สวัสดี {profile?.full_name ?? ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ภาพรวมงานผลิตทั้งหมด {total} งาน
          {problemCount > 0 && (
            <>
              {" · "}
              <span className="font-medium text-destructive">
                ติดปัญหา {problemCount} งาน
              </span>
            </>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STATUS_ORDER.map((s) => (
          <div key={s} className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums">{counts[s] ?? 0}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {STATUS_LABELS[s]}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border bg-muted/30 p-5">
        <h2 className="font-semibold">เฟส 3 — ระบบล็อกอิน + สิทธิ์ พร้อมแล้ว</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          คุณเข้าสู่ระบบด้วยบัญชีจริง และเห็นเมนูตามสิทธิ์ของแผนกแล้ว
          หน้าจอใช้งานจริง (บอร์ดงาน, บันทึกการผลิต, ตรวจ QC/QA)
          จะทยอยเปิดในเฟสถัดไปตาม roadmap
        </p>
      </div>
    </div>
  );
}
