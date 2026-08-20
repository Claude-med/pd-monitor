import { createClient } from "@/lib/supabase/server";
import type { JobRow } from "@/lib/data/job-constants";

// re-export constants/types เผื่อ import จากที่เดียว (server ใช้ได้)
export * from "@/lib/data/job-constants";

const SELECT = `
  id, job_no, status, problem, problem_note, planned_start, planned_end,
  request_no, cpo_date, sub_status,
  pack_type, pack_pattern_1, pack_pattern_2, pack_pattern_3,
  batches ( lot_no, manufacture_date, expiry_date ),
  orders ( order_no, customer, customer_id, quantity, unit, due_date, products ( name, reg_no ) )
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
    reg_no: product?.reg_no ?? null,
    quantity: order?.quantity ?? null,
    unit: order?.unit ?? null,
    due_date: order?.due_date ?? null,
    customer_id: order?.customer_id ?? null,
    request_no: r.request_no ?? null,
    cpo_date: r.cpo_date ?? null,
    sub_status: r.sub_status ?? null,
    pack_type: r.pack_type ?? null,
    pack_patterns: [r.pack_pattern_1, r.pack_pattern_2, r.pack_pattern_3].filter(
      (p): p is string => !!p,
    ),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** งานทั้งหมด (RLS: ผู้ใช้ที่ login อ่านได้) + ธงว่ารับเข้าคลัง FG แล้วหรือยัง */
export async function getJobs(): Promise<JobRow[]> {
  const supabase = await createClient();
  const [{ data }, { data: fgRows }] = await Promise.all([
    supabase.from("jobs").select(SELECT).order("job_no"),
    // fg_inventory อ่านได้ทุก role (RLS using(true)) — ใช้บอกว่างานเข้าคลังแล้ว
    supabase.from("fg_inventory").select("job_id"),
  ]);
  const receivedJobIds = new Set(
    (fgRows ?? []).map((r: { job_id: string }) => r.job_id),
  );
  return (data ?? []).map((r) => {
    const job = shape(r);
    job.fg_received = receivedJobIds.has(job.id);
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
