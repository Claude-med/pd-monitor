import { createClient } from "@/lib/supabase/server";
import { getJobByNo, type JobRow } from "@/lib/data/jobs";
import { getRecordsForJob } from "@/lib/data/production";
import type { ProductionRecordRow } from "@/lib/data/production-constants";
import { getJobMaterials, type JobMaterialRow } from "@/lib/data/job-materials";
import { getLineClearances, type LineClearance } from "@/lib/data/line-clearance";
import { getJobRouteSteps } from "@/lib/data/job-routes";
import {
  getInprocessChecks,
  getQaSamples,
  type InprocessCheck,
  type QaSample,
} from "@/lib/data/quality-checks";
import { getApprovalsForJob, type ApprovalRow } from "@/lib/data/approvals";
import { getDeviationsByJob, type Deviation } from "@/lib/data/deviations";

// B1 — Electronic Batch Record (eBR)
// รวมข้อมูลทุกส่วนของ "งาน/ล็อต" หนึ่ง เป็นแฟ้มเดียว (อ่านอย่างเดียว)

export type FgReceived = {
  qty: number;
  unit: string | null;
  lot_no: string | null;
  location: string | null;
  received_date: string | null;
};

export type BatchRecord = {
  job: JobRow;
  records: ProductionRecordRow[];
  materials: JobMaterialRow[];
  /** Part C.3 ก้อน 4: LC เป็นหลายใบต่องาน (1 ใบต่อ ขั้นตอน × เครื่อง) */
  lineClearances: (LineClearance & {
    step_no: number;
    station_name: string;
    machine_label: string;
  })[];
  inprocessChecks: InprocessCheck[];
  qaSamples: QaSample[];
  approvals: ApprovalRow[];
  deviations: Deviation[];
  fg: FgReceived | null;
  machinesUsed: string[]; // เครื่องที่ใช้ (unique) จากบันทึกผลผลิต
};

/* eslint-disable @typescript-eslint/no-explicit-any */
async function getFgReceived(jobId: string): Promise<FgReceived | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("fg_inventory")
    .select("qty, unit, lot_no, location, received_date")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!data) return null;
  const d = data as any;
  return {
    qty: Number(d.qty),
    unit: d.unit,
    lot_no: d.lot_no,
    location: d.location,
    received_date: d.received_date,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** ประกอบแฟ้มบันทึกการผลิต (eBR) ของงานตามเลข job_no */
export async function getBatchRecord(jobNo: string): Promise<BatchRecord | null> {
  const job = await getJobByNo(jobNo);
  if (!job) return null;

  const [
    records,
    materials,
    lcRows,
    steps,
    inprocessChecks,
    qaSamples,
    approvals,
    deviations,
    fg,
  ] = await Promise.all([
    getRecordsForJob(job.id),
    getJobMaterials(job.id),
    getLineClearances(job.id),
    getJobRouteSteps(job.id),
    getInprocessChecks(job.id),
    getQaSamples(job.id),
    getApprovalsForJob(job.id),
    getDeviationsByJob(job.id),
    getFgReceived(job.id),
  ]);

  // เติมชื่อขั้นตอน/เครื่องให้ใบ LC เพื่อพิมพ์ลงแฟ้ม (LC เก็บแต่ id)
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const machineLabel = new Map<string, string>();
  for (const st of steps) {
    for (const m of st.machines) {
      machineLabel.set(m.machine_id, `${m.code} · ${m.name}`);
    }
  }
  const lineClearances = lcRows
    .map((c) => {
      const st = stepById.get(c.job_route_id);
      return {
        ...c,
        step_no: st?.step_no ?? 0,
        station_name: st?.station_name ?? "—",
        machine_label: machineLabel.get(c.machine_id) ?? "—",
      };
    })
    .sort((a, b) =>
      a.step_no !== b.step_no
        ? a.step_no - b.step_no
        : a.machine_label.localeCompare(b.machine_label),
    );

  const machinesUsed = Array.from(
    new Set(
      records
        .map((r) => r.machine_label)
        .filter((x): x is string => !!x),
    ),
  );

  return {
    job,
    records,
    materials,
    lineClearances,
    inprocessChecks,
    qaSamples,
    approvals,
    deviations,
    fg,
    machinesUsed,
  };
}
