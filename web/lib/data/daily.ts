import { createClient } from "@/lib/supabase/server";
import type { StationKey } from "@/lib/data/station-constants";

export type DailyRow = {
  id: string;
  job_no: string | null;
  product_name: string | null;
  customer: string | null;
  station: StationKey;
  input_qty: number | null;
  output_qty: number | null;
  loss_qty: number | null;
  hours: number | null;
  operator_name: string | null;
  note: string | null;
};

const SELECT = `
  id, station, input_qty, output_qty, loss_qty, hours, note,
  operator:profiles!operator_id ( full_name ),
  jobs ( job_no, orders ( customer, products ( name ) ) )
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function shape(r: any): DailyRow {
  const op = one<any>(r.operator);
  const job = one<any>(r.jobs);
  const order = one<any>(job?.orders);
  const product = one<any>(order?.products);
  return {
    id: r.id,
    job_no: job?.job_no ?? null,
    product_name: product?.name ?? null,
    customer: order?.customer ?? null,
    station: r.station,
    input_qty: r.input_qty,
    output_qty: r.output_qty,
    loss_qty: r.loss_qty,
    hours: r.hours,
    operator_name: op?.full_name ?? null,
    note: r.note,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** บันทึกผลผลิตทุกงานของวันที่ที่เลือก (สำหรับรายงานประจำวัน) */
export async function getDailyReport(date: string): Promise<DailyRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("production_records")
    .select(SELECT)
    .eq("record_date", date)
    .order("created_at", { ascending: true });
  // จัดเรียงตามเลขงานใน JS (order ตามคอลัมน์ตาราง embed ไม่จัดลำดับแถวหลัก)
  return (data ?? [])
    .map(shape)
    .sort((a, b) => (a.job_no ?? "").localeCompare(b.job_no ?? ""));
}
