import { createClient } from "@/lib/supabase/server";

export type FgRecord = {
  id: string;
  qty: number;
  unit: string;
  lot_no: string | null;
  location: string | null;
  received_date: string | null;
  note: string | null;
};

export type FgJob = {
  job_id: string;
  job_no: string;
  product_name: string | null;
  customer: string | null;
  lot_no: string | null;
  order_qty: number | null;
  order_unit: string | null;
  fg: FgRecord | null; // null = ยังไม่รับเข้าคลัง
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** งานที่ถึงสถานะ FG แล้ว + รายการคลัง (ถ้ารับเข้าแล้ว) */
export async function listFgJobs(): Promise<FgJob[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(
      `id, job_no,
       batches ( lot_no ),
       orders ( customer, quantity, unit, products ( name ) ),
       fg:fg_inventory ( id, qty, unit, lot_no, location, received_date, note )`,
    )
    .eq("status", "finished_goods")
    .order("job_no", { ascending: false });
  if (error || !data) return [];

  return (data as any[]).map((r) => {
    const order = one<any>(r.orders);
    const batch = one<any>(r.batches);
    const product = one<any>(order?.products);
    const fg = one<any>(r.fg);
    return {
      job_id: r.id,
      job_no: r.job_no,
      product_name: product?.name ?? null,
      customer: order?.customer ?? null,
      lot_no: batch?.lot_no ?? null,
      order_qty: order?.quantity ?? null,
      order_unit: order?.unit ?? null,
      fg: fg
        ? {
            id: fg.id,
            qty: Number(fg.qty),
            unit: fg.unit,
            lot_no: fg.lot_no,
            location: fg.location,
            received_date: fg.received_date,
            note: fg.note,
          }
        : null,
    };
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
