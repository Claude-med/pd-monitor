import { createClient } from "@/lib/supabase/server";
import type { JobRow } from "@/lib/data/job-constants";

// re-export constants/types เผื่อ import จากที่เดียว (server ใช้ได้)
export * from "@/lib/data/job-constants";

const SELECT = `
  id, job_no, status, problem, problem_note, planned_start, planned_end,
  batches ( lot_no, manufacture_date, expiry_date ),
  orders ( order_no, customer, quantity, unit, products ( name ) )
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
    quantity: order?.quantity ?? null,
    unit: order?.unit ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** งานทั้งหมด (RLS: ผู้ใช้ที่ login อ่านได้) */
export async function getJobs(): Promise<JobRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("jobs").select(SELECT).order("job_no");
  return (data ?? []).map(shape);
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
