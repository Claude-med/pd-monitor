import { createClient } from "@/lib/supabase/server";

// B2 — Lot Genealogy / Traceability
// สายโซ่ที่มีอยู่ในระบบ (หลัง Part C.2):
//   วัตถุดิบ/บรรจุภัณฑ์ที่เบิก (job_materials — บันทึกหน้างาน ไม่มีเลขล็อต)
//     → งาน (jobs) → FG lot (batches.lot_no / fg_inventory) → ลูกค้า (orders)
// ไฟล์นี้ "อ่านอย่างเดียว" รวม query ข้ามตารางให้เป็นผังเดียว
//
// ⚠️ ไล่ย้อนจาก "เลขล็อตวัตถุดิบ" (recall) ทำไม่ได้แล้วตั้งแต่ Part C.2 —
//    ระบบเบิกใหม่ไม่ผูก material_lots จึงไม่มีข้อมูลว่าล็อตไหนถูกใช้ในงานใด
//    ถ้าวันหน้าต้องใช้ ต้องเพิ่มช่องเลขล็อต (พิมพ์เอง) ใน job_materials ก่อน

export type MaterialUsed = {
  id: string;
  item_name: string;
  item_type: string;
  qty: number | null;
  qty_unit: string | null;
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
  materials: MaterialUsed[];
  deviation_total: number;
  deviation_open: number;
};

export type TraceResult = {
  query: string;
  forward: JobTrace[]; // ค้นจาก job/FG lot → ไล่ไปวัตถุดิบที่ใช้
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** ประกอบผังของงานเดียว (วัตถุดิบ/บรรจุภัณฑ์ที่เบิก + FG ที่ออก + deviation) */
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

  const { data: mats } = await supabase
    .from("job_materials")
    .select("id, item_name, item_type, qty, qty_unit, status")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });

  const materials: MaterialUsed[] = (mats ?? []).map((m: any) => ({
    id: m.id,
    item_name: m.item_name,
    item_type: m.item_type,
    qty: m.qty == null ? null : Number(m.qty),
    qty_unit: m.qty_unit,
    status: m.status,
  }));

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
    materials,
    deviation_total,
    deviation_open,
  };
}

/** ค้นไล่ย้อนล็อต — รับ job_no หรือ FG lot_no (RM lot ค้นไม่ได้แล้ว ดูหัวไฟล์) */
export async function searchTrace(query: string): Promise<TraceResult> {
  const q = query.trim();
  const empty: TraceResult = { query: q, forward: [] };
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

  // ขาย้อนกลับ (RM lot → งาน) ถูกตัดออกใน Part C.2 — ดูคำอธิบายหัวไฟล์
  return { query: q, forward };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
