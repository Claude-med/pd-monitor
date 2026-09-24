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

/** ใบจ่ายออก 1 ใบ (Part G · 0097) — หน่วยเดียวกับรายการรับเข้าเสมอ */
export type FgDispatch = {
  id: string;
  qty: number;
  dispatched_date: string;
  doc_no: string | null;
  customer: string | null;
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
  /** ใบจ่ายออกที่ยังไม่ถูกลบ — ใหม่สุดก่อน */
  dispatches: FgDispatch[];
  /** ยอดจ่ายออกรวม (ไม่นับใบที่ถูกลบ) */
  dispatched_qty: number;
  /** คงคลัง = รับเข้า − จ่ายออก (0 ถ้ายังไม่รับเข้า) */
  on_hand: number;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** งานที่ถึงสถานะ FG แล้ว + รายการคลัง (ถ้ารับเข้าแล้ว) + ใบจ่ายออก */
export async function listFgJobs(): Promise<FgJob[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(
      `id, job_no,
       batches ( lot_no ),
       orders ( customer, quantity, unit, products ( name ) ),
       fg:fg_inventory ( id, qty, unit, lot_no, location, received_date, note ),
       dispatches:fg_dispatches ( id, qty, dispatched_date, doc_no, customer, note, deleted_at )`,
    )
    .eq("status", "finished_goods")
    .order("job_no", { ascending: false });
  if (error || !data) return [];

  return (data as any[]).map((r) => {
    const order = one<any>(r.orders);
    const batch = one<any>(r.batches);
    const product = one<any>(order?.products);
    const fg = one<any>(r.fg);
    // soft delete (0097) — RLS อ่านเป็น using(true) จึงต้องกรองแถวที่ถูกลบที่นี่
    const dispatches: FgDispatch[] = ((r.dispatches ?? []) as any[])
      .filter((d) => !d.deleted_at)
      .map((d) => ({
        id: d.id,
        qty: Number(d.qty),
        dispatched_date: d.dispatched_date,
        doc_no: d.doc_no,
        customer: d.customer,
        note: d.note,
      }))
      .sort((a, b) => b.dispatched_date.localeCompare(a.dispatched_date));
    const dispatched_qty = dispatches.reduce((s, d) => s + d.qty, 0);
    const received_qty = fg ? Number(fg.qty) : 0;
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
            qty: received_qty,
            unit: fg.unit,
            lot_no: fg.lot_no,
            location: fg.location,
            received_date: fg.received_date,
            note: fg.note,
          }
        : null,
      dispatches,
      dispatched_qty,
      on_hand: Math.max(received_qty - dispatched_qty, 0),
    };
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** "YYYY-MM" ของวันนี้ตามเวลาไทย (Vercel เป็น UTC) */
export function currentMonthTh(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

/** วันที่ "YYYY-MM-DD" อยู่ในเดือน "YYYY-MM" ไหม */
export function inMonth(date: string | null, month: string): boolean {
  return !!date && date.slice(0, 7) === month;
}

/**
 * รวมยอดแยกตามหน่วย — ไม่บวกข้ามหน่วย (ขวด + กล่อง รวมกันไม่ได้)
 * คืนเรียงจากยอดมากไปน้อย เช่น [{unit:"ขวด", qty:12000}, {unit:"กล่อง", qty:300}]
 */
export function sumByUnit(
  rows: { unit: string; qty: number }[],
): { unit: string; qty: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r.qty) continue;
    m.set(r.unit, (m.get(r.unit) ?? 0) + r.qty);
  }
  return [...m.entries()]
    .map(([unit, qty]) => ({ unit, qty }))
    .sort((a, b) => b.qty - a.qty);
}
