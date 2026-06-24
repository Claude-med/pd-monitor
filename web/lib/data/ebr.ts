import { createClient } from "@/lib/supabase/server";
import { getJobByNo, type JobRow } from "@/lib/data/jobs";
import { getRecordsForJob } from "@/lib/data/production";
import type { ProductionRecordRow } from "@/lib/data/station-constants";
import { getRequisitionsForJob, type RequisitionRow } from "@/lib/data/requisitions";
import { getLineClearance, type LineClearance } from "@/lib/data/line-clearance";
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
  requisitions: RequisitionRow[];
  lineClearance: LineClearance | null;
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
    requisitions,
    lineClearance,
    inprocessChecks,
    qaSamples,
    approvals,
    deviations,
    fg,
  ] = await Promise.all([
    getRecordsForJob(job.id),
    getRequisitionsForJob(job.id),
    getLineClearance(job.id),
    getInprocessChecks(job.id),
    getQaSamples(job.id),
    getApprovalsForJob(job.id),
    getDeviationsByJob(job.id),
    getFgReceived(job.id),
  ]);

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
    requisitions,
    lineClearance,
    inprocessChecks,
    qaSamples,
    approvals,
    deviations,
    fg,
    machinesUsed,
  };
}
