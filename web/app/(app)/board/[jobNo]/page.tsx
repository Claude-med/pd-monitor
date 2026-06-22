import { notFound } from "next/navigation";
import Link from "next/link";
import { getJobByNo } from "@/lib/data/jobs";
import {
  JOB_STATUS,
  STATUS_INDEX,
  STATUS_LABEL,
  STATUS_COLOR,
  PROBLEM_FLAGS,
} from "@/lib/data/job-constants";
import { getProfile } from "@/lib/auth/dal";
import { JobActions } from "./job-actions";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value ?? "—"}</dd>
    </div>
  );
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ jobNo: string }>;
}) {
  const { jobNo } = await params;
  const job = await getJobByNo(decodeURIComponent(jobNo));
  if (!job) notFound();

  const profile = await getProfile();
  const roles = profile?.roles ?? [];
  const curIdx = STATUS_INDEX[job.status] ?? 0;
  const flag = job.problem ? PROBLEM_FLAGS[job.problem] : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/board"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        ← กลับบอร์ดงาน
      </Link>

      {/* หัวเรื่อง */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{job.job_no}</h1>
        <span
          className="rounded-full px-2.5 py-1 text-xs font-medium text-white"
          style={{ backgroundColor: STATUS_COLOR[job.status] }}
        >
          {STATUS_LABEL[job.status]}
        </span>
        {flag && (
          <span
            className="rounded-full px-2.5 py-1 text-xs font-medium text-white"
            style={{ backgroundColor: flag.color }}
          >
            {flag.icon} {flag.label}
          </span>
        )}
      </div>

      {/* แถบสถานะ (stepper) */}
      <div className="flex flex-wrap gap-2">
        {JOB_STATUS.map((s, i) => {
          const done = i < curIdx;
          const current = i === curIdx;
          return (
            <div
              key={s.key}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                current
                  ? "border-transparent font-semibold text-white"
                  : done
                    ? "text-foreground"
                    : "text-muted-foreground"
              }`}
              style={
                current
                  ? { backgroundColor: s.color }
                  : done
                    ? { borderColor: s.color }
                    : undefined
              }
            >
              <span>{done ? "✓" : i + 1}</span>
              {s.label}
            </div>
          );
        })}
      </div>

      {/* ข้อมูลงาน */}
      <dl className="grid grid-cols-2 gap-4 rounded-xl border bg-card p-5 sm:grid-cols-3">
        <Field label="ลูกค้า" value={job.customer} />
        <Field label="ออเดอร์" value={job.order_no} />
        <Field label="ผลิตภัณฑ์" value={job.product_name} />
        <Field
          label="จำนวน"
          value={
            job.quantity != null
              ? `${job.quantity.toLocaleString("th-TH")} ${job.unit ?? ""}`.trim()
              : null
          }
        />
        <Field label="Lot / Batch" value={job.lot_no} />
        <Field label="แผนเริ่ม–เสร็จ" value={
          job.planned_start || job.planned_end
            ? `${job.planned_start ?? "—"} → ${job.planned_end ?? "—"}`
            : null
        } />
        <Field label="วันผลิต" value={job.mfg_date} />
        <Field label="วันหมดอายุ" value={job.exp_date} />
      </dl>

      {flag && job.problem_note && (
        <div className="rounded-xl border border-l-4 bg-card p-4" style={{ borderLeftColor: flag.color }}>
          <p className="text-xs text-muted-foreground">หมายเหตุปัญหา</p>
          <p className="mt-0.5 text-sm">{job.problem_note}</p>
        </div>
      )}

      {/* การดำเนินการตามสถานะ + สิทธิ์ */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-3 font-semibold">ดำเนินการ</h2>
        <JobActions
          jobId={job.id}
          jobNo={job.job_no}
          status={job.status}
          roles={roles}
        />
      </div>
    </div>
  );
}
