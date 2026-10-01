import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/data/fetch-all";
import type { JobRow } from "@/lib/data/job-constants";
import { DEVIATION_DONE_STATUSES } from "@/lib/data/deviation-constants";

// re-export constants/types เผื่อ import จากที่เดียว (server ใช้ได้)
export * from "@/lib/data/job-constants";

const SELECT = `
  id, job_no, status, problem, problem_note, planned_start, planned_end,
  request_no, cpo_date, sub_status, plan_month, company_id, company, note,
  pack_type, pack_pattern_1, pack_pattern_2, pack_pattern_3,
  cancelled_at, cancel_reason, canceller:profiles!cancelled_by ( full_name ),
  batches ( lot_no, manufacture_date, expiry_date ),
  orders ( order_no, customer, customer_id, quantity, unit, due_date, products ( code, name, dosage_form, reg_no, appearance ) )
`;

// supabase embed FK แบบ many-to-one อาจคืน object หรือ array — normalize ให้เป็น object
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function shape(r: any): JobRow {
  const order = one<any>(r.orders);
  const batch = one<any>(r.batches);
  const product = one<any>(order?.products);
  return {
    id: r.id,
    job_no: r.job_no,
    status: r.status,
    problem: r.problem,
    problem_note: r.problem_note,
    planned_start: r.planned_start,
    planned_end: r.planned_end,
    lot_no: batch?.lot_no ?? null,
    mfg_date: batch?.manufacture_date ?? null,
    exp_date: batch?.expiry_date ?? null,
    order_no: order?.order_no ?? null,
    customer: order?.customer ?? null,
    product_name: product?.name ?? null,
    product_code: product?.code ?? null,
    dosage_form: product?.dosage_form ?? null,
    reg_no: product?.reg_no ?? null,
    appearance: product?.appearance ?? null,
    quantity: order?.quantity ?? null,
    unit: order?.unit ?? null,
    due_date: order?.due_date ?? null,
    customer_id: order?.customer_id ?? null,
    company_id: r.company_id ?? null,
    company: r.company ?? null,
    note: r.note ?? null,
    request_no: r.request_no ?? null,
    cpo_date: r.cpo_date ?? null,
    sub_status: r.sub_status ?? null,
    plan_month: r.plan_month ?? null,
    pack_type: r.pack_type ?? null,
    pack_patterns: [r.pack_pattern_1, r.pack_pattern_2, r.pack_pattern_3].filter(
      (p): p is string => !!p,
    ),
    cancelled_at: r.cancelled_at ?? null,
    cancel_reason: r.cancel_reason ?? null,
    cancelled_by_name: one<any>(r.canceller)?.full_name ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * งานทั้งหมด (RLS: ผู้ใช้ที่ login อ่านได้) + ธงว่ารับเข้าคลัง FG แล้วหรือยัง
 * + จำนวน Incident ที่ยังไม่ปิด (Part I — ใช้กับ "งานมีปัญหา" ดู isProblemJob)
 */
export async function getJobs(): Promise<JobRow[]> {
  const supabase = await createClient();
  // ⚠️ jobs / fg_inventory โตไม่หยุด → ดึงทีละหน้าด้วย fetchAll (เลี่ยงเพดาน 1,000 แถว)
  const [data, fgRows, { data: incRows }] = await Promise.all([
    fetchAll(
      (from, to) => supabase.from("jobs").select(SELECT).order("job_no").range(from, to),
      "getJobs",
    ),
    // fg_inventory อ่านได้ทุก role (RLS using(true)) — ใช้บอกว่างานเข้าคลังแล้ว
    fetchAll<{ job_id: string }>(
      (from, to) =>
        supabase.from("fg_inventory").select("job_id").order("job_id").range(from, to),
      "getJobs/fg",
    ),
    // deviations อ่านได้ทุก role (0025 using(true)) · ดึงเฉพาะที่ยังเปิด = แถวน้อย ไม่ชนเพดาน 1,000
    // "เปิด" ต้องตรงกับ DEVIATION_DONE_STATUSES / has_open_deviation()
    supabase
      .from("deviations")
      .select("job_id")
      .not("status", "in", `(${DEVIATION_DONE_STATUSES.join(",")})`),
  ]);
  const receivedJobIds = new Set(fgRows.map((r) => r.job_id));
  const openIncidents = new Map<string, number>();
  for (const r of (incRows ?? []) as { job_id: string }[]) {
    openIncidents.set(r.job_id, (openIncidents.get(r.job_id) ?? 0) + 1);
  }
  return data.map((r) => {
    const job = shape(r);
    job.fg_received = receivedJobIds.has(job.id);
    job.open_incidents = openIncidents.get(job.id) ?? 0;
    return job;
  });
}

/** งานเดียวตามเลข job_no */
export async function getJobByNo(jobNo: string): Promise<JobRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select(SELECT)
    .eq("job_no", jobNo)
    .maybeSingle();
  return data ? shape(data) : null;
}
