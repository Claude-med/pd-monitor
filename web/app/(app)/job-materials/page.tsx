import Link from "next/link";
import { getProfile } from "@/lib/auth/dal";
import {
  canEditJobMaterials,
  canSetJobMaterialStatus,
} from "@/lib/data/role-access";
import { listJobMaterialsAcrossJobs } from "@/lib/data/job-materials";
import type { MaterialReadyStatus } from "@/lib/data/job-material-constants";
import { STATUS_LABEL, STATUS_COLOR } from "@/lib/data/job-constants";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { JobMaterialCard } from "@/components/job-material-card";

export const metadata = { title: "เบิกวัตถุดิบ / บรรจุภัณฑ์ — PD Monitor" };

/**
 * หน้ารวมรายการเบิกของทุกงาน (Part C.2 ก้อน 3)
 *
 * เดิมฝ่ายคลังต้องเปิดหน้างานทีละใบถึงจะกดสถานะได้ ไม่มีที่ไหนเห็นของค้างข้ามงานเลย
 * หน้านี้จึงรวมมาให้กดรวดเดียว — เพิ่ม/แก้/ลบ ยังทำที่หน้างานที่เดียวเหมือนเดิม
 */

const selectCls =
  "rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

export default async function JobMaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; scope?: string }>;
}) {
  const sp = await searchParams;
  const status: MaterialReadyStatus | "all" =
    sp.status === "ready" || sp.status === "all" ? sp.status : "not_ready";
  const scope: "active" | "all" = sp.scope === "all" ? "all" : "active";

  const profile = await getProfile();
  const roles = profile?.roles ?? [];
  const canSetStatus = canSetJobMaterialStatus(roles);
  const canEdit = canEditJobMaterials(roles);

  const groups = await listJobMaterialsAcrossJobs({ status, scope });

  const items = groups.flatMap((g) => g.items);
  const notReady = items.filter((i) => i.status === "not_ready").length;
  const ready = items.filter((i) => i.status === "ready").length;
  const jobsWithPending = groups.filter((g) =>
    g.items.some((i) => i.status === "not_ready"),
  ).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <RealtimeRefresh tables={["job_materials", "jobs"]} />

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          เบิกวัตถุดิบ / บรรจุภัณฑ์
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          รายการที่ทุกงานขอเบิก · ฝ่ายคลังกดสถานะ พร้อม/ไม่พร้อม ได้จากที่นี่เลย
          {canSetStatus
            ? ""
            : " (ดูอย่างเดียว — กดสถานะได้เฉพาะฝ่ายคลัง/ผู้บริหาร)"}
          {canEdit ? " · เพิ่ม/แก้/ลบรายการทำที่หน้างาน" : ""}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">ไม่พร้อม</p>
          <p className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">
            {notReady.toLocaleString("th-TH")}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">พร้อมแล้ว</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {ready.toLocaleString("th-TH")}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">งานที่ยังมีของไม่พร้อม</p>
          <p className="mt-1 text-2xl font-bold">
            {jobsWithPending.toLocaleString("th-TH")}
          </p>
        </div>
      </div>

      {/* ตัวกรอง — form GET ล้วน ไม่มี state ฝั่ง client (แพทเทิร์นเดียวกับหน้ารายงานประจำวัน) */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            สถานะ
          </label>
          <select name="status" defaultValue={status} className={selectCls}>
            <option value="not_ready">ไม่พร้อม</option>
            <option value="ready">พร้อมแล้ว</option>
            <option value="all">ทั้งหมด</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            ขอบเขต
          </label>
          <select name="scope" defaultValue={scope} className={selectCls}>
            <option value="active">เฉพาะงานที่ยังไม่จบ</option>
            <option value="all">ทุกงาน</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          ดูรายการ
        </button>
      </form>

      {groups.length === 0 ? (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          {status === "not_ready"
            ? "✅ ไม่มีรายการที่ไม่พร้อมค้างอยู่"
            : "ยังไม่มีรายการเบิกที่ตรงกับตัวกรอง"}
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.job_id} className="rounded-xl border bg-card p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{g.job_no}</span>
                  <span className="text-sm text-muted-foreground">
                    {g.product_name ?? "—"}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                    style={{
                      backgroundColor: STATUS_COLOR[g.job_status] ?? "#64748b",
                    }}
                  >
                    {STATUS_LABEL[g.job_status] ?? g.job_status}
                  </span>
                </div>
                <Link
                  href={`/board/${encodeURIComponent(g.job_no)}`}
                  className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
                >
                  เปิดหน้างาน →
                </Link>
              </div>

              <div className="space-y-3">
                {g.items.map((item) => (
                  <JobMaterialCard
                    key={item.id}
                    item={item}
                    jobNo={g.job_no}
                    canSetStatus={canSetStatus}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
