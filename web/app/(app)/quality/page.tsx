import Link from "next/link";
import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import { getJobs, STATUS_COLOR, STATUS_LABEL } from "@/lib/data/jobs";
import type { JobRow } from "@/lib/data/job-constants";
import { getRecentApprovals } from "@/lib/data/quality";
import { RealtimeRefresh } from "@/components/realtime-refresh";

export const metadata = { title: "ตรวจ QC / QA — PD Monitor" };

function JobQueue({
  status,
  jobs,
}: {
  status: "qc" | "qa";
  jobs: JobRow[];
}) {
  const rows = jobs.filter((j) => j.status === status);
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className="rounded-full px-2.5 py-1 text-xs font-medium text-white"
          style={{ backgroundColor: STATUS_COLOR[status] }}
        >
          {STATUS_LABEL[status]}
        </span>
        <h2 className="font-semibold">
          {status === "qc" ? "รอตรวจ QC" : "รอปล่อยผ่าน QA"}
        </h2>
        <span className="text-xs text-muted-foreground">{rows.length} งาน</span>
      </div>

      {rows.length > 0 ? (
        <ul className="space-y-2">
          {rows.map((j) => (
            <li key={j.id}>
              <Link
                href={`/board/${encodeURIComponent(j.job_no)}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background p-3 text-sm hover:border-primary hover:bg-accent/40"
              >
                <span className="font-semibold text-primary">{j.job_no}</span>
                <span className="font-medium">{j.product_name ?? "—"}</span>
                <span className="text-muted-foreground">{j.customer ?? "—"}</span>
                {j.lot_no && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    Lot {j.lot_no}
                  </span>
                )}
                <span className="ml-auto text-xs text-primary">
                  ลงนาม →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border bg-background p-4 text-center text-sm text-muted-foreground">
          ✅ ไม่มีงานรอ{status === "qc" ? "ตรวจ QC" : "ปล่อยผ่าน QA"}
        </p>
      )}
    </div>
  );
}

export default async function QualityPage() {
  const profile = await getProfile();
  const roles = profile?.roles ?? [];

  if (!hasAnyRole(roles, ["qc", "qa", "manager"])) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 text-2xl font-bold tracking-tight">ตรวจ QC / QA</h1>
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          เฉพาะ QC / QA / ผู้บริหารเข้าหน้านี้ได้ — บัญชีของคุณไม่มีสิทธิ์
        </p>
      </div>
    );
  }

  const [jobs, approvals] = await Promise.all([
    getJobs(),
    getRecentApprovals(30),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <RealtimeRefresh tables={["jobs", "approvals"]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ตรวจ QC / QA</h1>
        <p className="text-sm text-muted-foreground">
          รายการงานที่รอตรวจคุณภาพ — กดที่งานเพื่อเปิดรายละเอียดแล้วลงนามอนุมัติ/ตีกลับ
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <JobQueue status="qc" jobs={jobs} />
        <JobQueue status="qa" jobs={jobs} />
      </div>

      {/* ประวัติการลงนามล่าสุด */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-3 font-semibold">การลงนามล่าสุด</h2>
        {approvals.length > 0 ? (
          <ul className="space-y-2">
            {approvals.map((a) => {
              const ok = a.decision === "approve";
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-l-4 bg-background p-3 text-sm"
                  style={{ borderLeftColor: ok ? "#16a34a" : "#ef4444" }}
                >
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                    style={{ backgroundColor: ok ? "#16a34a" : "#ef4444" }}
                  >
                    {a.stage.toUpperCase()} {ok ? "อนุมัติ" : "ตีกลับ"}
                  </span>
                  {a.job_no ? (
                    <Link
                      href={`/board/${encodeURIComponent(a.job_no)}`}
                      className="font-semibold text-primary hover:underline"
                    >
                      {a.job_no}
                    </Link>
                  ) : (
                    <span className="font-semibold">—</span>
                  )}
                  <span className="font-medium">{a.signer_name ?? "—"}</span>
                  <span className="text-muted-foreground">
                    {new Date(a.signed_at).toLocaleString("th-TH")}
                  </span>
                  {a.reason && (
                    <span className="w-full text-muted-foreground">
                      เหตุผล: {a.reason}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">ยังไม่มีการลงนาม</p>
        )}
      </div>
    </div>
  );
}
