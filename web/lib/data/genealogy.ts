import { createClient } from "@/lib/supabase/server";

// B2 — Lot Genealogy / Traceability
// สายโซ่ที่มีอยู่แล้วในระบบ:
//   RM/PM lot (material_lots) → ใบเบิก (material_requisitions.job_id) → งาน (jobs)
//     → FG lot (batches.lot_no / fg_inventory) → ลูกค้า (orders)
// ไฟล์นี้ "อ่านอย่างเดียว" รวม query ข้ามตารางให้เป็นผังเดียว

export type RmLotUsed = {
  requisition_id: string;
  material_lot_id: string;
  material_code: string;
  material_name: string;
  lot_no: string;
  qty: number;
  unit: string;
  status: string;
};

export type JobTrace = {
  job_id: string;
  job_no: string;
  status: string;
  product_name: string | null;
  customer: string | null;
  order_no: string | null;
  fg_lot_no: string | null; // ล็อตผลิต (batches)
  mfg_date: string | null;
  exp_date: string | null;
  fg_qty: number | null; // จำนวนที่รับเข้าคลังจริง (fg_inventory)
  fg_unit: string | null;
  fg_location: string | null;
  rm_lots: RmLotUsed[];
  deviation_total: number;
  deviation_open: number;
};

export type ReverseTrace = {
  material_lot_id: string;
  lot_no: string;
  material_code: string;
  material_name: string;
  jobs: JobTrace[];
};

export type TraceResult = {
  query: string;
  forward: JobTrace[]; // ค้นจาก job/FG lot → ไล่ไปวัตถุดิบที่ใช้
  reverse: ReverseTrace[]; // ค้นจาก RM lot → ไล่ไปงาน/FG ที่ใช้ล็อตนี้ (recall)
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** ประกอบผังของงานเดียว (วัตถุดิบที่เบิก + FG ที่ออก + deviation) */
export async function getJobTrace(jobId: string): Promise<JobTrace | null> {
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select(
      `id, job_no, status,
       batches ( lot_no, manufacture_date, expiry_date ),
       orders ( order_no, customer, products ( name ) ),
       fg:fg_inventory ( qty, unit, location )`,
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;

  const order = one<any>((job as any).orders);
  const batch = one<any>((job as any).batches);
  const product = one<any>(order?.products);
  const fg = one<any>((job as any).fg);

  const { data: reqs } = await supabase
    .from("material_requisitions")
    .select(
      `id, qty, status, material_lot_id,
       lot:material_lots!material_lot_id (
         lot_no, material:materials!material_id ( code, name, unit )
       )`,
    )
    .eq("job_id", jobId)
    .order("requested_at", { ascending: true });

  const rm_lots: RmLotUsed[] = (reqs ?? []).map((r: any) => {
    const lot = one<any>(r.lot);
    const mat = one<any>(lot?.material);
    return {
      requisition_id: r.id,
      material_lot_id: r.material_lot_id,
      material_code: mat?.code ?? "—",
      material_name: mat?.name ?? "",
      lot_no: lot?.lot_no ?? "—",
      qty: Number(r.qty),
      unit: mat?.unit ?? "",
      status: r.status,
    };
  });

  const { data: devs } = await supabase
    .from("deviations")
    .select("status")
    .eq("job_id", jobId);
  const deviation_total = (devs ?? []).length;
  const deviation_open = (devs ?? []).filter(
    (d: any) => d.status !== "closed",
  ).length;

  return {
    job_id: (job as any).id,
    job_no: (job as any).job_no,
    status: (job as any).status,
    product_name: product?.name ?? null,
    customer: order?.customer ?? null,
    order_no: order?.order_no ?? null,
    fg_lot_no: batch?.lot_no ?? null,
    mfg_date: batch?.manufacture_date ?? null,
    exp_date: batch?.expiry_date ?? null,
    fg_qty: fg ? Number(fg.qty) : null,
    fg_unit: fg?.unit ?? null,
    fg_location: fg?.location ?? null,
    rm_lots,
    deviation_total,
    deviation_open,
  };
}

/** ค้นไล่ย้อนล็อต — รับ job_no หรือ lot_no (ทั้ง FG lot และ RM lot) */
export async function searchTrace(query: string): Promise<TraceResult> {
  const q = query.trim();
  const empty: TraceResult = { query: q, forward: [], reverse: [] };
  if (q === "") return empty;

  const supabase = await createClient();

  // --- ขาไปข้างหน้า: หา "งาน" ที่ตรงกับ job_no หรือ FG lot ---
  const jobIds = new Set<string>();

  const { data: byJobNo } = await supabase
    .from("jobs")
    .select("id")
    .ilike("job_no", `%${q}%`)
    .limit(20);
  for (const r of (byJobNo ?? []) as any[]) jobIds.add(r.id);

  // FG lot จาก batches (ผูกงานผ่าน jobs.batch_id) → ดึงงานที่ batch.lot_no ตรง
  const { data: byBatch } = await supabase
    .from("jobs")
    .select("id, batches!inner ( lot_no )")
    .ilike("batches.lot_no", `%${q}%`)
    .limit(20);
  for (const r of (byBatch ?? []) as any[]) jobIds.add(r.id);

  // FG lot จาก fg_inventory
  const { data: byFg } = await supabase
    .from("fg_inventory")
    .select("job_id")
    .ilike("lot_no", `%${q}%`)
    .limit(20);
  for (const r of (byFg ?? []) as any[]) jobIds.add(r.job_id);

  const forward: JobTrace[] = [];
  for (const id of jobIds) {
    const t = await getJobTrace(id);
    if (t) forward.push(t);
  }
  forward.sort((a, b) => b.job_no.localeCompare(a.job_no));

  // --- ขาย้อนกลับ: หา RM lot ที่ตรง → งานที่เบิกใช้ล็อตนี้ (recall) ---
  const { data: matLots } = await supabase
    .from("material_lots")
    .select(`id, lot_no, material:materials!material_id ( code, name )`)
    .ilike("lot_no", `%${q}%`)
    .limit(10);

  const reverse: ReverseTrace[] = [];
  for (const l of (matLots ?? []) as any[]) {
    const mat = one<any>(l.material);
    const { data: reqs } = await supabase
      .from("material_requisitions")
      .select("job_id")
      .eq("material_lot_id", l.id);
    const ids = Array.from(new Set((reqs ?? []).map((r: any) => r.job_id)));
    const jobs: JobTrace[] = [];
    for (const id of ids) {
      const t = await getJobTrace(id);
      if (t) jobs.push(t);
    }
    jobs.sort((a, b) => b.job_no.localeCompare(a.job_no));
    reverse.push({
      material_lot_id: l.id,
      lot_no: l.lot_no,
      material_code: mat?.code ?? "—",
      material_name: mat?.name ?? "",
      jobs,
    });
  }

  return { query: q, forward, reverse };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
