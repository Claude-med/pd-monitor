import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import type { JobRow } from "@/lib/data/job-constants";
import { availableTransitions } from "@/lib/data/job-constants";
import { DEVIATION_DONE_STATUSES } from "@/lib/data/deviation-constants";
import {
  canApproveInprocess,
  canRecordInprocess,
} from "@/lib/data/role-access";
import {
  canRecordQaSample,
  canReviewQaSample,
} from "@/lib/data/qa-sample-constants";

// Part I ก้อน 4 — หน้า "ตรวจ QC / QA" = กล่องงานของทั้ง 2 ฝ่าย
//   แต่ละการ์ดตอบ 3 คำถาม: งานไหน · ขั้นตอน (สถานี) ไหน · ต้องทำอะไร
//   ปุ่มในการ์ดเรียก server action "ตัวเดิม" ของหน้างาน ⇒ ด่านสิทธิ์/GMP ใน DB ชุดเดียวกัน
//   can* ที่คืนไป = โชว์ปุ่มไหม (DB ยังตรวจซ้ำเป็นด่านจริงเสมอ)

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export type InboxJob = Pick<
  JobRow,
  "id" | "job_no" | "product_name" | "customer" | "lot_no" | "company"
>;

/** บันทึกผลผลิตที่ยังไม่มีผลตรวจ in-process — งานของลูกน้อง QC */
export type InprocessDue = {
  recordId: string;
  job: InboxJob;
  station: string | null;
  stepId: string | null;
  recordDate: string;
  output: string;
  /** ผลตรวจเดิมถูกหัวหน้าไม่อนุมัติ → ต้องตรวจใหม่ */
  redo: boolean;
};

/** ผลตรวจ in-process ที่รอหัวหน้า QC อนุมัติ */
export type InprocessPending = {
  id: string;
  job: InboxJob;
  station: string | null;
  stepId: string | null;
  summary: string;
  proposed: "pass" | "fail";
  checker: string | null;
  checkedAt: string;
  /** ผู้ดูเป็นคนลงผลเอง = อนุมัติเองไม่ได้ (สองลายเซ็น) */
  mine: boolean;
};

/** จุดเก็บตัวอย่างที่รอหัวหน้า QA อนุมัติ */
export type SamplePending = {
  id: string;
  job: InboxJob;
  summary: string;
  proposed: "pass" | "fail" | null;
  collector: string | null;
  collectedAt: string;
};

/** งานที่รอลงนาม QC หรือ QA (ทั้งงาน) */
export type SignDue = {
  job: InboxJob;
  stage: "qc" | "qa";
  /** สิ่งที่ยังขวางการ "ปล่อยผ่าน" (QA) — ว่าง = กดได้ · ตีกลับทำได้เสมอ */
  blockers: string[];
  /** ข้อมูลประกอบบนการ์ด (เช่น ตัวอย่างอนุมัติแล้ว N รายการ) */
  info: string[];
};

export type QualityInbox = {
  inprocessDue: InprocessDue[];
  inprocessPending: InprocessPending[];
  qcSign: SignDue[];
  sampleDue: InboxJob[];
  samplePending: SamplePending[];
  qaSign: SignDue[];
  /** คำขอแก้ไขจุดเก็บตัวอย่างที่ค้าง (ไปอนุมัติที่หน้า /edit-requests) */
  sampleEditRequests: number;
  /** ผู้ดูทำอะไรได้บ้าง — ใช้ทั้งโชว์ปุ่ม และจัดหัวข้อ "ของฉัน" */
  can: {
    recordInprocess: boolean;
    approveInprocess: boolean;
    signQc: boolean;
    recordSample: boolean;
    reviewSample: boolean;
    signQa: boolean;
    /** ปล่อยผ่าน FG ได้ (หัวหน้า QA · รีวิว 1 ต.ค. 69) — พนักงาน QA ลงนามได้แค่ตีกลับ */
    releaseQa: boolean;
  };
};

function toInboxJob(j: JobRow): InboxJob {
  return {
    id: j.id,
    job_no: j.job_no,
    product_name: j.product_name,
    customer: j.customer,
    lot_no: j.lot_no,
    company: j.company,
  };
}

function fmtNum(v: unknown): string {
  return Number(v ?? 0).toLocaleString("th-TH");
}

export async function getQualityInbox(
  profile: Profile,
  jobs: JobRow[],
): Promise<QualityInbox> {
  const roles = profile.roles;
  const me = profile.id;
  const supabase = await createClient();

  const byId = new Map(jobs.map((j) => [j.id, j]));
  const producing = jobs.filter((j) => j.status === "in_production");
  const qcJobs = jobs.filter((j) => j.status === "qc");
  const qaJobs = jobs.filter((j) => j.status === "qa");
  const producingIds = producing.map((j) => j.id);
  const qaIds = qaJobs.map((j) => j.id);

  // .in() กับ array ว่างจะได้ SQL ผิด → ข้ามคิวรีไปเลย
  const empty = Promise.resolve({ data: [] as any[] });

  const [recRes, chkRes, sampleRes, devRes, erRes] = await Promise.all([
    // บันทึกผลผลิตของงานที่กำลังผลิต (ไม่นับที่ถูกตีกลับ — 0080)
    producingIds.length
      ? supabase
          .from("production_records")
          .select(
            `id, job_id, job_route_id, record_date, output_qty, output_unit,
             station:stations!station_id ( name )`,
          )
          .in("job_id", producingIds)
          .neq("status", "rejected")
          .order("record_date", { ascending: true })
      : empty,
    // ผลตรวจ in-process ทุกตัวของงานที่กำลังผลิต (ใช้ทั้งหา "ยังไม่ตรวจ" และ "รออนุมัติ")
    producingIds.length
      ? supabase
          .from("inprocess_checks")
          .select(
            `id, job_id, job_route_id, production_record_id, param, value, unit,
             result, status, checked_at, checked_by,
             checker:profiles!checked_by ( full_name ),
             station:stations!station_id ( name )`,
          )
          .in("job_id", producingIds)
          .order("checked_at", { ascending: true })
      : empty,
    // จุดเก็บตัวอย่างของงานที่รอ QA
    qaIds.length
      ? supabase
          .from("qa_samples")
          .select(
            `id, job_id, qty, unit, result, review_status, collected_at,
             collector:profiles!collected_by ( full_name )`,
          )
          .in("job_id", qaIds)
          .is("deleted_at", null)
          .order("collected_at", { ascending: true })
      : empty,
    // Incident ที่ยังเปิดของงานที่รอ QA — ด่านเดียวกับ has_open_deviation()
    qaIds.length
      ? supabase
          .from("deviations")
          .select("job_id")
          .in("job_id", qaIds)
          .not("status", "in", `(${DEVIATION_DONE_STATUSES.join(",")})`)
      : empty,
    // คำขอแก้ไขจุดเก็บตัวอย่างที่ค้าง — ด่าน QA→FG (0099)
    qaIds.length
      ? supabase
          .from("edit_requests")
          .select("job_id")
          .in("job_id", qaIds)
          .eq("target_type", "qa_sample")
          .eq("status", "pending")
      : empty,
  ]);

  const checks = (chkRes.data ?? []) as any[];

  // ---------- in-process: รอตรวจ ----------
  // บันทึกที่ "มีผลตรวจที่ยังนับอยู่" (รออนุมัติ หรือ อนุมัติแล้ว) = ลูกน้องทำส่วนตัวเองแล้ว
  // มีแต่ผลที่ถูกไม่อนุมัติ = ต้องตรวจใหม่
  const handled = new Set<string>();
  const rejectedOnly = new Set<string>();
  for (const c of checks) {
    if (!c.production_record_id) continue;
    if (c.status === "rejected") rejectedOnly.add(c.production_record_id);
    else handled.add(c.production_record_id);
  }
  const inprocessDue: InprocessDue[] = ((recRes.data ?? []) as any[]).flatMap((r) => {
    if (handled.has(r.id)) return [];
    const job = byId.get(r.job_id);
    if (!job) return [];
    return [
      {
        recordId: r.id,
        job: toInboxJob(job),
        station: one<any>(r.station)?.name ?? null,
        stepId: r.job_route_id ?? null,
        recordDate: r.record_date,
        output: `ผลิตได้ ${fmtNum(r.output_qty)}${r.output_unit ? " " + r.output_unit : ""}`,
        redo: rejectedOnly.has(r.id),
      },
    ];
  });

  // ---------- in-process: รอหัวหน้า QC อนุมัติ ----------
  const inprocessPending: InprocessPending[] = checks.flatMap((c) => {
    if (c.status !== "pending") return [];
    const job = byId.get(c.job_id);
    if (!job) return [];
    return [
      {
        id: c.id,
        job: toInboxJob(job),
        station: one<any>(c.station)?.name ?? null,
        stepId: c.job_route_id ?? null,
        summary: `${c.param ?? ""}${c.value ? ` = ${c.value}${c.unit ? " " + c.unit : ""}` : ""}`,
        proposed: c.result === "fail" ? "fail" : "pass",
        checker: one<any>(c.checker)?.full_name ?? null,
        checkedAt: c.checked_at,
        mine: c.checked_by === me,
      },
    ];
  });

  // ---------- จุดเก็บตัวอย่าง ----------
  const samples = (sampleRes.data ?? []) as any[];
  const samplesByJob = new Map<string, any[]>();
  for (const s of samples) {
    const list = samplesByJob.get(s.job_id) ?? [];
    list.push(s);
    samplesByJob.set(s.job_id, list);
  }
  const sampleDue = qaJobs
    .filter((j) => !samplesByJob.has(j.id))
    .map(toInboxJob);
  const samplePending: SamplePending[] = samples.flatMap((s) => {
    if (s.review_status !== "pending") return [];
    const job = byId.get(s.job_id);
    if (!job) return [];
    return [
      {
        id: s.id,
        job: toInboxJob(job),
        summary: s.qty != null ? `${fmtNum(s.qty)} ${s.unit ?? ""}`.trim() : "",
        proposed: s.result === "fail" ? "fail" : s.result === "pass" ? "pass" : null,
        collector: one<any>(s.collector)?.full_name ?? null,
        collectedAt: s.collected_at,
      },
    ];
  });

  // ---------- ลงนาม QC / QA ----------
  const countBy = (rows: any[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.job_id, (m.get(r.job_id) ?? 0) + 1);
    return m;
  };
  const openDev = countBy((devRes.data ?? []) as any[]);
  const pendingEr = countBy((erRes.data ?? []) as any[]);

  const qcSign: SignDue[] = qcJobs.map((j) => ({
    job: toInboxJob(j),
    stage: "qc",
    blockers: [],
    info: ["ผลผลิต + in-process ครบทุกขั้นตอนแล้ว (ผ่านด่านส่งตรวจ QC)"],
  }));

  const qaSign: SignDue[] = qaJobs.map((j) => {
    const list = samplesByJob.get(j.id) ?? [];
    const pend = list.filter((s) => s.review_status === "pending").length;
    const done = list.length - pend;
    const blockers: string[] = [];
    const dev = openDev.get(j.id) ?? 0;
    if (dev > 0) blockers.push(`🚨 Incident Case ยังเปิด ${dev} เรื่อง`);
    if (pend > 0) blockers.push(`🧪 จุดเก็บตัวอย่างรอหัวหน้า QA อนุมัติ ${pend} รายการ`);
    const er = pendingEr.get(j.id) ?? 0;
    if (er > 0) blockers.push(`✏️ คำขอแก้ไขจุดเก็บตัวอย่างค้าง ${er} รายการ`);
    const info =
      list.length === 0
        ? ["⚠️ ยังไม่มีจุดเก็บตัวอย่าง"]
        : [`จุดเก็บตัวอย่างอนุมัติแล้ว ${done} รายการ`];
    return { job: toInboxJob(j), stage: "qa", blockers, info };
  });

  let sampleEditRequests = 0;
  if (canReviewQaSample(roles)) {
    const { count } = await supabase
      .from("edit_requests")
      .select("id", { count: "exact", head: true })
      .eq("target_type", "qa_sample")
      .eq("status", "pending");
    sampleEditRequests = count ?? 0;
  }

  return {
    inprocessDue,
    inprocessPending,
    qcSign,
    sampleDue,
    samplePending,
    qaSign,
    sampleEditRequests,
    can: {
      // ลูกน้อง QC (+หัวหน้า) — ผู้บริหารบันทึกได้ตามสิทธิ์เดิม แต่ไม่ใช่ "งานของผู้บริหาร"
      recordInprocess: canRecordInprocess(roles) && hasAnyRole(roles, ["qc"]),
      approveInprocess: canApproveInprocess(roles),
      signQc: availableTransitions("qc", roles).some((t) => t.esign),
      recordSample: canRecordQaSample(roles) && hasAnyRole(roles, ["qa"]),
      reviewSample: canReviewQaSample(roles),
      signQa: availableTransitions("qa", roles).some((t) => t.esign),
      releaseQa: availableTransitions("qa", roles).some(
        (t) => t.esign && t.kind === "forward",
      ),
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ------------------------------------------------------------------
// การลงนามล่าสุด — รวม 3 แหล่ง (อ่านอย่างเดียว ไม่มีตารางใหม่)
//   approvals (ลงนาม QC/QA ทั้งงาน) · inprocess_checks ที่หัวหน้าพิจารณาแล้ว · qa_samples ที่อนุมัติแล้ว
// ------------------------------------------------------------------
export type SignatureKind = "qc" | "qa" | "inprocess" | "qa-sample";

export type RecentSignature = {
  key: string;
  kind: SignatureKind;
  ok: boolean;
  label: string;
  jobNo: string | null;
  detail: string | null;
  signer: string | null;
  at: string;
  reason: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function getRecentSignatures(limit = 30): Promise<RecentSignature[]> {
  const supabase = await createClient();
  const [appr, chk, smp] = await Promise.all([
    supabase
      .from("approvals")
      .select(
        `id, stage, decision, reason, signed_at,
         signer:profiles!profile_id ( full_name ),
         jobs:job_id ( job_no )`,
      )
      .order("signed_at", { ascending: false })
      .limit(limit),
    supabase
      .from("inprocess_checks")
      .select(
        `id, param, value, unit, result, status, approved_at, approve_note,
         approver:profiles!approved_by ( full_name ),
         station:stations!station_id ( name ),
         jobs ( job_no )`,
      )
      .in("status", ["approved", "rejected"])
      .not("approved_at", "is", null)
      .order("approved_at", { ascending: false })
      .limit(limit),
    supabase
      .from("qa_samples")
      .select(
        `id, result, reviewed_at,
         reviewer:profiles!reviewed_by ( full_name ),
         jobs ( job_no )`,
      )
      .eq("review_status", "approved")
      .not("reviewed_at", "is", null)
      .is("deleted_at", null)
      .order("reviewed_at", { ascending: false })
      .limit(limit),
  ]);

  const rows: RecentSignature[] = [
    ...((appr.data ?? []) as any[]).map((r) => {
      const ok = r.decision === "approve";
      return {
        key: `a-${r.id}`,
        kind: r.stage as "qc" | "qa",
        ok,
        label: `${String(r.stage).toUpperCase()} ${ok ? "อนุมัติ" : "ตีกลับ"}`,
        jobNo: one<any>(r.jobs)?.job_no ?? null,
        detail: null,
        signer: one<any>(r.signer)?.full_name ?? null,
        at: r.signed_at,
        reason: r.reason ?? null,
      };
    }),
    ...((chk.data ?? []) as any[]).map((r) => {
      const approved = r.status === "approved";
      const ok = approved && r.result !== "fail";
      return {
        key: `i-${r.id}`,
        kind: "inprocess" as const,
        ok,
        label: approved
          ? `In-process อนุมัติ${r.result === "fail" ? " (ไม่ผ่าน)" : ""}`
          : "In-process ไม่อนุมัติ",
        jobNo: one<any>(r.jobs)?.job_no ?? null,
        detail: [one<any>(r.station)?.name, r.param].filter(Boolean).join(" · ") || null,
        signer: one<any>(r.approver)?.full_name ?? null,
        at: r.approved_at,
        reason: r.approve_note ?? null,
      };
    }),
    ...((smp.data ?? []) as any[]).map((r) => ({
      key: `s-${r.id}`,
      kind: "qa-sample" as const,
      ok: r.result !== "fail",
      label: `ตัวอย่าง QA ${r.result === "fail" ? "ไม่ผ่าน" : "ผ่าน"}`,
      jobNo: one<any>(r.jobs)?.job_no ?? null,
      detail: null,
      signer: one<any>(r.reviewer)?.full_name ?? null,
      at: r.reviewed_at,
      reason: null,
    })),
  ];

  return rows
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
