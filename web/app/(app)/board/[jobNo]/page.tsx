import { Fragment } from "react";
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
import { getRecordsForJob } from "@/lib/data/production";
import {
  STATION_LABEL,
  STATION_ICON,
  RECORDABLE_STATUSES,
} from "@/lib/data/station-constants";
import { getApprovalsForJob } from "@/lib/data/approvals";
import { listMachines } from "@/lib/data/machines";
import {
  getRequisitionsForJob,
  getSelectableLots,
} from "@/lib/data/requisitions";
import { getLineClearance } from "@/lib/data/line-clearance";
import { getInprocessChecks, getQaSamples } from "@/lib/data/quality-checks";
import { getDeviationsByJob } from "@/lib/data/deviations";
import { canOpenDeviation, canCloseDeviation } from "@/lib/data/deviation-constants";
import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import { fmtDateTime } from "@/lib/format";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { JobActions } from "./job-actions";
import { RecordForm } from "./record-form";
import { Requisitions } from "./requisitions";
import { LineClearancePanel } from "./line-clearance";
import { QualityChecks } from "./quality-checks";
import { Deviations } from "./deviations";

function fmtQty(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("th-TH");
}

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

  const records = await getRecordsForJob(job.id);
  const approvals = await getApprovalsForJob(job.id);
  const canRecord =
    hasAnyRole(roles, ["production", "manager"]) &&
    RECORDABLE_STATUSES.has(job.status);
  const machines = canRecord ? await listMachines() : [];
  const requisitions = await getRequisitionsForJob(job.id);
  const canRequestMat = hasAnyRole(roles, ["production", "warehouse", "manager"]);
  const canIssueMat = hasAnyRole(roles, ["warehouse", "manager"]);
  const selectableLots = canRequestMat ? await getSelectableLots() : [];
  const lineClearance = await getLineClearance(job.id);
  const canPerformLc = hasAnyRole(roles, ["production", "manager"]);
  const canCheckLc = hasAnyRole(roles, ["production", "qc", "qa", "manager"]);
  const inprocessChecks = await getInprocessChecks(job.id);
  const qaSamples = await getQaSamples(job.id);
  const canInprocess = hasAnyRole(roles, ["qc", "manager"]);
  const canSample = hasAnyRole(roles, ["qa", "manager"]);
  const deviations = await getDeviationsByJob(job.id);
  // ผลตรวจระหว่างผลิตที่ "ไม่ผ่าน" และยังไม่ได้เปิด deviation → เสนอเปิดด่วน
  const linkedCheckIds = new Set(
    deviations.map((d) => d.inprocess_check_id).filter(Boolean) as string[],
  );
  const failChecks = inprocessChecks
    .filter((c) => c.result === "fail" && !linkedCheckIds.has(c.id))
    .map((c) => ({ id: c.id, station: c.station, param: c.param }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <RealtimeRefresh
        tables={[
          "jobs",
          "production_records",
          "approvals",
          "material_requisitions",
          "line_clearances",
          "inprocess_checks",
          "qa_samples",
          "deviations",
          "deviation_comments",
        ]}
      />
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/board"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับบอร์ดงาน
        </Link>
        <Link
          href={`/board/${encodeURIComponent(job.job_no)}/ebr`}
          className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          📄 ดู eBR (แฟ้มบันทึกการผลิต)
        </Link>
      </div>

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

      {/* Line Clearance (A3) — gate ก่อนเริ่มผลิต */}
      <LineClearancePanel
        jobNo={job.job_no}
        jobId={job.id}
        clearance={lineClearance}
        canPerform={canPerformLc}
        canCheck={canCheckLc}
        currentProfileId={profile?.id ?? ""}
      />

      {/* บันทึกผลผลิตรายวัน */}
      <div className="rounded-xl border bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">บันทึกผลผลิตรายวัน</h2>
          <span className="text-xs text-muted-foreground">
            {records.length} รายการ
          </span>
        </div>

        {records.length > 0 ? (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[780px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">วันที่</th>
                  <th className="px-2 py-2 font-medium">สถานี</th>
                  <th className="px-2 py-2 font-medium">เครื่องจักร</th>
                  <th className="px-2 py-2 text-right font-medium">ตั้งต้น</th>
                  <th className="px-2 py-2 text-right font-medium">ผลิตได้</th>
                  <th className="px-2 py-2 text-right font-medium">ของเสีย</th>
                  <th className="px-2 py-2 text-right font-medium">ชม.</th>
                  <th className="px-2 py-2 text-right font-medium">คน</th>
                  <th className="px-2 py-2 font-medium">ผู้บันทึก</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <Fragment key={r.id}>
                    <tr className={`align-top ${r.note ? "" : "border-b last:border-0"}`}>
                      <td className="whitespace-nowrap px-2 py-2">{r.record_date}</td>
                      <td className="whitespace-nowrap px-2 py-2">
                        {STATION_ICON[r.station]} {STATION_LABEL[r.station] ?? r.station}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                        {r.machine_label ?? "—"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtQty(r.input_qty)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtQty(r.output_qty)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtQty(r.loss_qty)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.hours ?? "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.headcount ?? "—"}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                        {r.operator_name ?? "—"}
                      </td>
                    </tr>
                    {r.note && (
                      <tr className="border-b last:border-0">
                        <td />
                        <td
                          colSpan={8}
                          className="px-2 pb-2 text-xs text-muted-foreground"
                        >
                          📝 {r.note}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">ยังไม่มีการบันทึกผลผลิต</p>
        )}

        <div className="mt-4">
          {canRecord ? (
            <RecordForm jobId={job.id} jobNo={job.job_no} machines={machines} />
          ) : (
            <p className="text-xs text-muted-foreground">
              {hasAnyRole(roles, ["production", "manager"])
                ? "บันทึกผลผลิตได้เฉพาะงานที่เริ่มผลิตแล้ว (ยังไม่ถึง/เลยขั้นผลิต)"
                : "เฉพาะฝ่ายผลิต/ผู้บริหารบันทึกผลผลิตได้"}
            </p>
          )}
        </div>
      </div>

      {/* เบิกวัตถุดิบ (A2) */}
      <Requisitions
        jobId={job.id}
        jobNo={job.job_no}
        jobStatus={job.status}
        requisitions={requisitions}
        lots={selectableLots}
        canRequest={canRequestMat}
        canIssue={canIssueMat}
        currentProfileId={profile?.id ?? ""}
      />

      {/* ตรวจระหว่างผลิต (in-process QC) + จุดเก็บตัวอย่าง QA (A6) */}
      <QualityChecks
        jobId={job.id}
        jobNo={job.job_no}
        checks={inprocessChecks}
        samples={qaSamples}
        canCheck={canInprocess}
        canSample={canSample}
      />

      {/* Deviation / เหตุผิดปกติ (B3) — gate กัน QA→FG ถ้ามีเปิดค้าง */}
      <Deviations
        jobId={job.id}
        jobNo={job.job_no}
        deviations={deviations}
        failChecks={failChecks}
        canOpen={canOpenDeviation(roles)}
        canClose={canCloseDeviation(roles)}
      />

      {/* ลายเซ็นอนุมัติคุณภาพ (QC/QA e-signature) */}
      {approvals.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">ลายเซ็นอนุมัติคุณภาพ (QC / QA)</h2>
          <ul className="space-y-2">
            {approvals.map((a) => {
              const ok = a.decision === "approve";
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-start gap-2 rounded-md border border-l-4 bg-card p-3 text-sm"
                  style={{ borderLeftColor: ok ? "#16a34a" : "#ef4444" }}
                >
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                    style={{ backgroundColor: ok ? "#16a34a" : "#ef4444" }}
                  >
                    {a.stage.toUpperCase()} {ok ? "อนุมัติ" : "ตีกลับ"}
                  </span>
                  <span className="font-medium">{a.signer_name ?? "—"}</span>
                  <span className="text-muted-foreground">
                    {fmtDateTime(a.signed_at)}
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
        </div>
      )}
    </div>
  );
}
