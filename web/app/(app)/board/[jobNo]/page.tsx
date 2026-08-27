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
  WORK_SHIFT_LABEL,
  WORK_PERIOD_LABEL,
  RECORDABLE_STATUSES,
  type RecordQcStatus,
} from "@/lib/data/production-constants";
import { getApprovalsForJob } from "@/lib/data/approvals";
import { listMachines } from "@/lib/data/machines";
import { getJobMaterials } from "@/lib/data/job-materials";
import { getLineClearances } from "@/lib/data/line-clearance";
import { getInprocessChecks, getQaSamples } from "@/lib/data/quality-checks";
import { getJobRoute, listStations } from "@/lib/data/stations";
import { getJobRouteSteps } from "@/lib/data/job-routes";
import { getDeviationsByJob } from "@/lib/data/deviations";
import { canOpenDeviation, canCloseDeviation } from "@/lib/data/deviation-constants";
import {
  getEditRequestsForJob,
  getPendingTargetIds,
} from "@/lib/data/edit-requests";
import {
  EDIT_TARGET_LABEL,
  EDIT_STATUS_META,
  fieldLabel,
} from "@/lib/data/edit-request-constants";
import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import {
  canPlanJobs,
  canEditJobMaterials,
  canSetJobMaterialStatus,
  canEditJobRouteMachines,
  canPerformLineClearance,
  canCheckLineClearance,
  canRecordInprocess,
  canApproveInprocess,
} from "@/lib/data/role-access";
import { listJobSubStatuses } from "@/lib/data/job-sub-statuses";
import { listCustomers } from "@/lib/data/customers";
import { fmtDateTime } from "@/lib/format";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { JobActions } from "./job-actions";
import { DeleteJobButton } from "./delete-job-button";
import { LotNotice } from "./lot-notice";
import { JobInfoCard } from "./job-info-card";
import { RecordForm } from "./record-form";
import { JobMaterials } from "./job-materials";
import { LineClearancePanel } from "./line-clearance";
import { QualityChecks } from "./quality-checks";
import { Deviations } from "./deviations";
import { EditRequestButton, type EditField } from "./edit-request-button";
import { MissingRouteBanner } from "./missing-route";
import { RouteTabs } from "./route-tabs";
import { RouteMachinesCard } from "./route-machines-card";
import { RecordQcCell } from "./record-qc-cell";
import type { ProductionRecordRow } from "@/lib/data/production-constants";

/** ยอด + หน่วยต่อท้าย (หน่วยแยกช่องตั้งแต่ Part C.3 ก้อน 5) */
function fmtQtyUnit(n: number | null, unit: string | null): string {
  if (n == null) return "—";
  return unit ? `${n.toLocaleString("th-TH")} ${unit}` : n.toLocaleString("th-TH");
}

type EditOption = { value: string; label: string };

/** field ปุ่ม "ขอแก้ไข" ของบันทึกผลผลิต — ใช้ร่วมกันทั้งการ์ด (มือถือ) และตาราง (จอกว้าง) */
function productionEditFields(
  r: ProductionRecordRow,
  canEditStationMachine: boolean,
  stationIdEditOptions: EditOption[],
  machineEditOptions: EditOption[],
): EditField[] {
  return [
    { key: "output_qty", label: "ผลิตได้", kind: "number", current: String(r.output_qty ?? "") },
    { key: "loss_qty", label: "ของเสีย", kind: "number", current: String(r.loss_qty ?? "") },
    { key: "input_qty", label: "ยอดที่ต้องการ", kind: "number", current: String(r.input_qty ?? "") },
    { key: "minutes", label: "นาทีทำงาน", kind: "number", current: String(r.minutes ?? "") },
    { key: "headcount", label: "จำนวนคน", kind: "number", current: String(r.headcount ?? "") },
    { key: "record_date", label: "วันที่", kind: "date", current: r.record_date ?? "" },
    { key: "note", label: "หมายเหตุ", kind: "text", current: r.note ?? "" },
    ...(canEditStationMachine
      ? [
          { key: "station_id", label: "สถานี", kind: "select" as const, current: r.station_id ?? "", options: stationIdEditOptions },
          { key: "machine_id", label: "เครื่องจักร", kind: "select" as const, current: r.machine_id ?? "", options: machineEditOptions },
        ]
      : []),
  ];
}

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobNo: string }>;
  /** ?step=<job_routes.id> — แท็บขั้นตอนที่กำลังดูอยู่ (Part C.3 ก้อน 3) */
  searchParams: Promise<{ step?: string; qc?: string }>;
}) {
  const { jobNo } = await params;
  const sp = await searchParams;
  const job = await getJobByNo(decodeURIComponent(jobNo));
  if (!job) notFound();

  const profile = await getProfile();
  const roles = profile?.roles ?? [];
  const curIdx = STATUS_INDEX[job.status] ?? 0;
  const flag = job.problem ? PROBLEM_FLAGS[job.problem] : null;

  const records = await getRecordsForJob(job.id);
  const approvals = await getApprovalsForJob(job.id);
  const canRecord =
    hasAnyRole(roles, ["production", "production_lead", "manager"]) &&
    RECORDABLE_STATUSES.has(job.status);
  // [ข้อ 8] ผู้บริหาร/ผู้ดูแล ขอแก้ไข "สถานี/เครื่องจักร" ของบันทึกผลผลิต + สถานีของ in-process ได้
  const canEditStationMachine = hasAnyRole(roles, ["manager", "admin"]);
  // Part C.3: การ์ด "เครื่องจักรของขั้นตอนนี้" ต้องมีรายการเครื่องไว้ทำ dropdown ด้วย
  const canEditRouteMachines = canEditJobRouteMachines(roles);
  const machines =
    canRecord || canEditStationMachine || canEditRouteMachines
      ? await listMachines()
      : [];
  // สถานีย่อยทั้งหมด (active) + route ของงาน → ใช้ทำตัวเลือกสถานีในฟอร์มต่างๆ
  const jobRoute = await getJobRoute(job.id);
  const activeStations = (await listStations()).filter((s) => s.is_active);
  // ตัวเลือกฟอร์มขอแก้ไข: สถานีย่อย (station_id) = ทุกสถานี active · เครื่องจักร = รายการเครื่อง
  const stationIdEditOptions = activeStations.map((s) => ({ value: s.id, label: s.name }));
  const machineEditOptions = [
    { value: "", label: "— ไม่ระบุเครื่อง —" },
    ...machines.map((m) => ({ value: m.id, label: `${m.code} · ${m.name}` })),
  ];
  const jobMaterials = await getJobMaterials(job.id);
  // Part C — การ์ดข้อมูลงานแก้ไขได้: ต้องมีทะเบียนสถานะ + ทะเบียนลูกค้าไว้ทำ dropdown
  const [subStatuses, customers] = await Promise.all([
    listJobSubStatuses(),
    listCustomers(),
  ]);
  // จำนวนรายการเบิก — ใช้เตือนตอนแก้ Batch Size (โหลดอยู่แล้ว ไม่ต้อง query เพิ่ม)
  const materialCount = jobMaterials.length;
  // Part C.2: ฝ่ายผลิตลงรายการ · ฝ่ายคลังกดสถานะ — คนละสิทธิ์กันคนละ helper
  const canEditMat = canEditJobMaterials(roles);
  const canSetMatStatus = canSetJobMaterialStatus(roles);
  // Part C.3 ก้อน 4: LC เป็นหลายใบต่องาน (1 ใบต่อ ขั้นตอน × เครื่อง)
  const lineClearances = await getLineClearances(job.id);
  const canPerformLc = canPerformLineClearance(roles);
  const canCheckLc = canCheckLineClearance(roles);
  const inprocessChecks = await getInprocessChecks(job.id);
  const qaSamples = await getQaSamples(job.id);
  const canInprocess = canRecordInprocess(roles);
  // Part C.3 ก้อน 6: หัวหน้า QC เป็นคนอนุมัติผลตรวจ (คนละคนกับผู้ลงผล)
  const canApproveQc = canApproveInprocess(roles);
  const canSample = hasAnyRole(roles, ["qa", "manager"]);
  // ── Part C.3 ก้อน 3: แท็บตามขั้นตอนการผลิต ──────────────────────────
  // steps มาจาก job_routes (snapshot ตอนสร้างงาน) พร้อมเครื่องจักรที่ผูกไว้ + ตัวนับ
  const steps = await getJobRouteSteps(job.id);
  // ?step ที่ไม่มีอยู่จริง (ลิงก์เก่า/พิมพ์มั่ว) → ตกกลับขั้นตอนแรก ไม่ใช่จอว่าง
  const activeStep =
    steps.find((s) => s.id === sp.step) ?? steps[0] ?? null;

  // บันทึกผลผลิต / ผลตรวจ QC ที่แสดงในแท็บ = เฉพาะสถานีของขั้นตอนที่เลือก
  // งานเก่าที่ไม่มี route (steps ว่าง) → แสดงทั้งหมดเหมือนเดิม ไม่งั้นจอจะว่างเปล่า
  const viewRecords = activeStep
    ? records.filter((r) => r.station_id === activeStep.station_id)
    : records;
  const viewChecks = activeStep
    ? inprocessChecks.filter((c) => c.station_id === activeStep.station_id)
    : inprocessChecks;
  const viewRoute = activeStep
    ? jobRoute.filter((r) => r.station_id === activeStep.station_id)
    : jobRoute;
  // สถานะ QC รายแถว — คำนวณจากผลตรวจที่ผูกกับแถวนั้น (ไม่เก็บคอลัมน์ กันข้อมูลตกยุค)
  const qcByRecord = new Map<string, RecordQcStatus>();
  for (const c of inprocessChecks) {
    // ผลที่ยัง "รออนุมัติ/ไม่อนุมัติ" ยังไม่นับ — แถวคงสถานะ "รอ QC ตรวจสอบ" ต่อ
    if (!c.production_record_id || c.status !== "approved") continue;
    const cur = qcByRecord.get(c.production_record_id);
    if (cur === "fail") continue; // ไม่ผ่านแม้ข้อเดียว = ไม่ผ่านทั้งแถว
    qcByRecord.set(c.production_record_id, c.result === "fail" ? "fail" : "pass");
  }
  const qcStatusOf = (id: string): RecordQcStatus =>
    qcByRecord.get(id) ?? "waiting";

  // ตัวเลือกให้ QC เลือกว่าจะตรวจแถวไหน — ใช้ข้อมูลที่โหลดมาแล้ว ไม่ query เพิ่ม
  const recordOptions = viewRecords.map((r) => ({
    id: r.id,
    label: `${r.record_date} · ผลิตได้ ${fmtQtyUnit(r.output_qty, r.output_unit)}${
      r.machine_label ? ` · ${r.machine_label}` : ""
    }`,
  }));


  const deviations = await getDeviationsByJob(job.id);
  // F1 — คำขอแก้ไขย้อนหลัง (ประวัติ + badge บนแถวที่มีคำขอค้าง)
  const editRequests = await getEditRequestsForJob(job.id);
  const pendingTargets = await getPendingTargetIds(job.id);
  const canAmend = roles.length > 0;
  // ผลตรวจระหว่างผลิตที่ "ไม่ผ่าน" และยังไม่ได้เปิด deviation → เสนอเปิดด่วน
  const linkedCheckIds = new Set(
    deviations.map((d) => d.inprocess_check_id).filter(Boolean) as string[],
  );
  const failChecks = inprocessChecks
    .filter((c) => c.result === "fail" && !linkedCheckIds.has(c.id))
    .map((c) => ({ id: c.id, station_name: c.station_name, param: c.param }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <RealtimeRefresh
        tables={[
          "jobs",
          "orders",
          "batches",
          "job_sub_statuses",
          "production_records",
          "approvals",
          "job_materials",
          "job_route_machines",
          "line_clearances",
          "inprocess_checks",
          "qa_samples",
          "deviations",
          "deviation_comments",
          "edit_requests",
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

      {/* Part 2.1 — งานที่ไม่มีขั้นตอนการผลิต (job_routes ว่าง) ต้องซ่อมก่อนถึงจะบันทึกผลได้ */}
      {jobRoute.length === 0 && (
        <MissingRouteBanner
          jobNo={job.job_no}
          jobId={job.id}
          canFix={canPlanJobs(roles)}
        />
      )}

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

      {/* ข้อมูลงาน — อ่าน/แก้ไขในการ์ดเดียว สิทธิ์รายช่องตามฝ่าย (Part C) */}
      <JobInfoCard
        job={job}
        roles={roles}
        isManager={hasAnyRole(roles, ["manager", "admin"])}
        subStatuses={subStatuses}
        customers={customers}
        materialCount={materialCount}
      />

      {/* ไม่มีเลขล็อต = กดเริ่มผลิตไม่ได้ (ด่าน 0049) — ช่องกรอกอยู่ในการ์ดข้อมูลงานด้านบน */}
      <LotNotice lotNo={job.lot_no} status={job.status} />

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

        {/* ลบงาน (ข้อ 2) — เฉพาะผู้บริหาร/ผู้ดูแล */}
        {hasAnyRole(roles, ["manager", "admin"]) && (
          <div className="mt-4 border-t pt-4">
            <DeleteJobButton jobId={job.id} jobNo={job.job_no} />
          </div>
        )}
      </div>

      {/* เบิกวัตถุดิบ/บรรจุภัณฑ์ (Part C.2) */}
      <JobMaterials
        jobId={job.id}
        jobNo={job.job_no}
        items={jobMaterials}
        canEdit={canEditMat}
        canSetStatus={canSetMatStatus}
      />

      {/* ── แท็บขั้นตอนการผลิต (Part C.3) — Line Clearance / บันทึกผลผลิต / QC แยกตามขั้นตอน ── */}
      {steps.length > 0 && activeStep && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            ขั้นตอนการผลิตของงานนี้ · {steps.length} ขั้นตอน
          </h2>
          <RouteTabs
            jobNo={job.job_no}
            steps={steps}
            activeId={activeStep.id}
          />
        </div>
      )}

      {activeStep && (
        <RouteMachinesCard
          jobNo={job.job_no}
          jobRouteId={activeStep.id}
          stationId={activeStep.station_id}
          stationName={activeStep.station_name}
          selected={activeStep.machines}
          allMachines={machines}
          canEdit={canEditRouteMachines}
        />
      )}

      {/* Line Clearance — 1 ใบต่อเครื่องจักรของขั้นตอนนี้ (Part C.3 ก้อน 4) */}
      {activeStep && (
        <LineClearancePanel
          jobNo={job.job_no}
          jobRouteId={activeStep.id}
          stationName={activeStep.station_name}
          machines={activeStep.machines}
          clearances={lineClearances.filter(
            (c) => c.job_route_id === activeStep.id,
          )}
          canPerform={canPerformLc}
          canCheck={canCheckLc}
          currentProfileId={profile?.id ?? ""}
        />
      )}

      {/* บันทึกผลผลิตรายวัน — เฉพาะขั้นตอนที่เลือกอยู่ */}
      <div className="rounded-xl border bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">
            บันทึกผลผลิตรายวัน
            {activeStep && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                · {activeStep.step_no}. {activeStep.station_name}
              </span>
            )}
          </h2>
          <span className="text-xs text-muted-foreground">
            {viewRecords.length} รายการ
          </span>
        </div>

        {viewRecords.length > 0 ? (
          <>
            {/* มือถือ: การ์ด (เห็นครบทุกช่องในใบเดียว ไม่ต้องเลื่อนแนวนอน) */}
            <div className="space-y-3 md:hidden">
              {viewRecords.map((r) => (
                <div key={r.id} className="rounded-lg border bg-muted/20 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {r.station_name ?? "—"}
                    </span>
                    <span className="text-xs text-muted-foreground">{r.record_date}</span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    <div><dt className="text-xs text-muted-foreground">ยอดที่ต้องการ</dt><dd className="tabular-nums">{fmtQtyUnit(r.input_qty, r.input_unit)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">ผลิตได้</dt><dd className="tabular-nums">{fmtQtyUnit(r.output_qty, r.output_unit)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">ของเสีย</dt><dd className="tabular-nums">{fmtQtyUnit(r.loss_qty, r.loss_unit)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">นาที / คน</dt><dd className="tabular-nums">{r.minutes ?? "—"} / {r.headcount ?? "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">กะ / ช่วงเวลา</dt><dd>{r.shift ? WORK_SHIFT_LABEL[r.shift] : "—"}{r.work_period ? " / " + WORK_PERIOD_LABEL[r.work_period] : ""}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">เครื่องจักร</dt><dd>{r.machine_label ?? "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">ผู้บันทึก</dt><dd>{r.operator_name ?? "—"}</dd></div>
                  </dl>
                  {r.note && <p className="mt-2 text-xs text-muted-foreground">📝 {r.note}</p>}
                  <div className="mt-2">
                    <RecordQcCell
                      status={qcStatusOf(r.id)}
                      jobNo={job.job_no}
                      stepId={activeStep?.id ?? null}
                      recordId={r.id}
                      canCheck={canInprocess}
                    />
                  </div>
                  {canAmend && (
                    <div className="mt-2">
                      <EditRequestButton
                        targetType="production_record"
                        targetId={r.id}
                        jobNo={job.job_no}
                        hasPending={pendingTargets.has(r.id)}
                        fields={productionEditFields(r, canEditStationMachine, stationIdEditOptions, machineEditOptions)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* จอกว้าง: ตาราง */}
            <div className="-mx-2 hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2 font-medium">วันที่</th>
                    <th className="px-2 py-2 font-medium">กะ / ช่วงเวลา</th>
                    <th className="px-2 py-2 font-medium">เครื่องจักร</th>
                    <th className="px-2 py-2 text-right font-medium">ยอดที่ต้องการ</th>
                    <th className="px-2 py-2 text-right font-medium">ผลิตได้</th>
                    <th className="px-2 py-2 text-right font-medium">ของเสีย</th>
                    <th className="px-2 py-2 text-right font-medium">นาที</th>
                    <th className="px-2 py-2 text-right font-medium">คน</th>
                    <th className="px-2 py-2 font-medium">ผู้บันทึก</th>
                    {canAmend && <th className="px-2 py-2 font-medium">แก้ไข</th>}
                    <th className="px-2 py-2 font-medium">สถานะ QC</th>
                  </tr>
                </thead>
                <tbody>
                  {viewRecords.map((r) => (
                    <Fragment key={r.id}>
                      <tr className={`align-top ${r.note ? "" : "border-b last:border-0"}`}>
                        <td className="whitespace-nowrap px-2 py-2">{r.record_date}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                          {r.shift ? WORK_SHIFT_LABEL[r.shift] : "—"}
                          {r.work_period ? " / " + WORK_PERIOD_LABEL[r.work_period] : ""}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                          {r.machine_label ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{fmtQtyUnit(r.input_qty, r.input_unit)}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{fmtQtyUnit(r.output_qty, r.output_unit)}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{fmtQtyUnit(r.loss_qty, r.loss_unit)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{r.minutes ?? "—"}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{r.headcount ?? "—"}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                          {r.operator_name ?? "—"}
                        </td>
                        {canAmend && (
                          <td className="px-2 py-2">
                            <EditRequestButton
                              targetType="production_record"
                              targetId={r.id}
                              jobNo={job.job_no}
                              hasPending={pendingTargets.has(r.id)}
                              fields={productionEditFields(r, canEditStationMachine, stationIdEditOptions, machineEditOptions)}
                            />
                          </td>
                        )}
                        <td className="px-2 py-2">
                          <RecordQcCell
                            status={qcStatusOf(r.id)}
                            jobNo={job.job_no}
                            stepId={activeStep?.id ?? null}
                            recordId={r.id}
                            canCheck={canInprocess}
                          />
                        </td>
                      </tr>
                      {r.note && (
                        <tr className="border-b last:border-0">
                          <td />
                          <td
                            colSpan={canAmend ? 10 : 9}
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
          </>
        ) : (
          <p className="text-sm text-muted-foreground">ยังไม่มีการบันทึกผลผลิต</p>
        )}

        <div className="mt-4">
          {canRecord && activeStep ? (
            <RecordForm
              jobId={job.id}
              jobNo={job.job_no}
              jobRouteId={activeStep.id}
              stationName={`${activeStep.step_no}. ${activeStep.station_name}`}
              machines={activeStep.machines}
            />
          ) : canRecord && !activeStep ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              งานนี้ยังไม่มีขั้นตอนการผลิต — บันทึกผลผลิตไม่ได้จนกว่าจะเติมขั้นตอน (ดูแถบเตือนด้านบน)
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {hasAnyRole(roles, ["production", "production_lead", "manager"])
                ? "บันทึกผลผลิตได้เฉพาะงานที่เริ่มผลิตแล้ว (ยังไม่ถึง/เลยขั้นผลิต)"
                : "เฉพาะฝ่ายผลิต/ผู้บริหารบันทึกผลผลิตได้"}
            </p>
          )}
        </div>
      </div>

      {/* ตรวจระหว่างผลิต (in-process QC) + จุดเก็บตัวอย่าง QA (A6) */}
      <QualityChecks
        jobId={job.id}
        jobNo={job.job_no}
        checks={viewChecks}
        samples={qaSamples}
        route={viewRoute}
        jobRouteId={activeStep?.id ?? null}
        stationOptions={activeStations.map((st) => ({ id: st.id, name: st.name }))}
        recordOptions={recordOptions}
        preselectRecordId={sp.qc ?? null}
        canCheck={canInprocess}
        canApprove={canApproveQc}
        currentProfileId={profile?.id ?? ""}
        canSample={canSample}
        canAmend={canAmend}
        // Part C.4: ขอแก้ไขผลตรวจ in-process ได้เฉพาะ QC (ฝ่ายผลิตต้องไม่เห็นปุ่ม)
        // ⚠️ ห้ามรวมกับ canAmend ที่ยังต้องเป็น "ทุกคนที่ล็อกอิน" สำหรับบันทึกผลผลิต
        canAmendCheck={canAmend && canInprocess}
        canEditStation={canEditStationMachine}
        pendingTargetIds={[...pendingTargets]}
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

      {/* ประวัติการแก้ไขย้อนหลัง (F1) */}
      {editRequests.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">ประวัติการแก้ไขย้อนหลัง (Amendment)</h2>
          <ul className="space-y-2">
            {editRequests.map((e) => {
              const meta = EDIT_STATUS_META[e.status];
              return (
                <li
                  key={e.id}
                  className="rounded-md border border-l-4 bg-card p-3 text-sm"
                  style={{ borderLeftColor: meta.color }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                      style={{ backgroundColor: meta.color }}
                    >
                      {meta.label}
                    </span>
                    <span className="font-medium">
                      {EDIT_TARGET_LABEL[e.target_type]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      โดย {e.requester_name ?? "—"} · {fmtDateTime(e.requested_at)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    แก้:{" "}
                    {Object.keys(e.changes)
                      .map((k) => fieldLabel(k))
                      .join(", ")}{" "}
                    · เหตุผล: {e.reason}
                  </p>
                  {e.review_note && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      หมายเหตุผู้อนุมัติ: {e.review_note}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

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
