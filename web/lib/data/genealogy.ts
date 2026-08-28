import { createClient } from "@/lib/supabase/server";
import { isDeviationOpen } from "@/lib/data/deviation-constants";

// B2 — Lot Genealogy / Traceability
// สายโซ่ที่มีอยู่ในระบบ (หลัง Part C.2):
//   วัตถุดิบ/บรรจุภัณฑ์ที่เบิก (job_materials — บันทึกหน้างาน ไม่มีเลขล็อต)
//     → งาน (jobs) → FG lot (batches.lot_no / fg_inventory) → ลูกค้า (orders)
// ไฟล์นี้ "อ่านอย่างเดียว" รวม query ข้ามตารางให้เป็นผังเดียว
//
// ⚠️ ไล่ย้อนจาก "เลขล็อตวัตถุดิบ" (recall) ทำไม่ได้แล้วตั้งแต่ Part C.2 —
//    ระบบเบิกใหม่ไม่ผูก material_lots จึงไม่มีข้อมูลว่าล็อตไหนถูกใช้ในงานใด
//    ถ้าวันหน้าต้องใช้ ต้องเพิ่มช่องเลขล็อต (พิมพ์เอง) ใน job_materials ก่อน
//
// 🚨 กติกาการจัดการ error (Part C.4 ก้อน 1) — ของเดิมทิ้ง `error` ทุก query
//    ทำให้ "query พัง" กับ "ไม่มีข้อมูล" หน้าตาเหมือนกันหมด → ผู้ใช้เห็น "ไม่พบงาน" ทั้งที่ระบบมีปัญหา
//    ตอนนี้แยกกันชัด: ไม่พบงาน = คืน null · query พัง = throw ให้ app/(app)/error.tsx จับ

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
  /** ชื่อบริษัท (Part D) — เลขงานซ้ำข้ามบริษัทได้ ต้องโชว์คู่กันเสมอ */
  company: string | null;
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

/** query พังเมื่อไหร่ ให้ดังทันที — อย่าให้กลายเป็น "ไม่พบข้อมูล" เงียบๆ */
function assertOk(where: string, error: { message: string } | null): void {
  if (!error) return;
  console.error(`[genealogy] ${where}`, error.message);
  throw new Error(`ไล่ย้อนล็อตไม่สำเร็จ (${where}): ${error.message}`);
}

const JOB_SELECT = `id, job_no, company, status,
       batches ( lot_no, manufacture_date, expiry_date ),
       orders ( order_no, customer, products ( name ) ),
       fg:fg_inventory ( qty, unit, location )`;

/** ประกอบผังของงานจากแถว jobs ที่ query มาแล้ว + ข้อมูลลูกที่โหลดเป็นชุด */
function shapeJobTrace(
  job: any,
  materials: MaterialUsed[],
  devStatuses: string[],
): JobTrace {
  const order = one<any>(job.orders);
  const batch = one<any>(job.batches);
  const product = one<any>(order?.products);
  const fg = one<any>(job.fg);

  return {
    job_id: job.id,
    job_no: job.job_no,
    company: job.company ?? null,
    status: job.status,
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
    deviation_total: devStatuses.length,
    // ⚠️ นิยาม "เปิดค้าง" ต้องตรงกับ has_open_deviation() ใน DB เสมอ (ด่าน QA→FG ใช้ตัวนั้น)
    deviation_open: devStatuses.filter(isDeviationOpen).length,
  };
}

/** โหลดผังของหลายงานพร้อมกัน — 3 query ไม่ว่าจะกี่งาน (เดิมเป็น N+1) */
async function getJobTraces(jobIds: string[]): Promise<JobTrace[]> {
  if (jobIds.length === 0) return [];
  const supabase = await createClient();

  const [jobsRes, matsRes, devsRes] = await Promise.all([
    supabase.from("jobs").select(JOB_SELECT).in("id", jobIds),
    supabase
      .from("job_materials")
      .select("id, job_id, item_name, item_type, qty, qty_unit, status")
      .in("job_id", jobIds)
      .order("created_at", { ascending: true }),
    supabase.from("deviations").select("job_id, status").in("job_id", jobIds),
  ]);
  assertOk("โหลดข้อมูลงาน", jobsRes.error);
  assertOk("โหลดรายการเบิก", matsRes.error);
  assertOk("โหลดเหตุผิดปกติ", devsRes.error);

  const matsByJob = new Map<string, MaterialUsed[]>();
  for (const m of (matsRes.data ?? []) as any[]) {
    const list = matsByJob.get(m.job_id) ?? [];
    list.push({
      id: m.id,
      item_name: m.item_name,
      item_type: m.item_type,
      qty: m.qty == null ? null : Number(m.qty),
      qty_unit: m.qty_unit,
      status: m.status,
    });
    matsByJob.set(m.job_id, list);
  }

  const devsByJob = new Map<string, string[]>();
  for (const d of (devsRes.data ?? []) as any[]) {
    const list = devsByJob.get(d.job_id) ?? [];
    list.push(d.status);
    devsByJob.set(d.job_id, list);
  }

  return ((jobsRes.data ?? []) as any[]).map((job) =>
    shapeJobTrace(job, matsByJob.get(job.id) ?? [], devsByJob.get(job.id) ?? []),
  );
}

/** ค้นไล่ย้อนล็อต — รับ job_no หรือ FG lot_no (RM lot ค้นไม่ได้แล้ว ดูหัวไฟล์) */
export async function searchTrace(query: string): Promise<TraceResult> {
  const q = query.trim();
  const empty: TraceResult = { query: q, forward: [] };
  if (q === "") return empty;

  const supabase = await createClient();

  // --- ขาไปข้างหน้า: หา "งาน" ที่ตรงกับ job_no หรือ FG lot ---
  const [byJobNo, byBatch, byFg] = await Promise.all([
    supabase.from("jobs").select("id").ilike("job_no", `%${q}%`).limit(20),
    // FG lot จาก batches (ผูกงานผ่าน jobs.batch_id) → ดึงงานที่ batch.lot_no ตรง
    supabase
      .from("jobs")
      .select("id, batches!inner ( lot_no )")
      .ilike("batches.lot_no", `%${q}%`)
      .limit(20),
    // FG lot จาก fg_inventory
    supabase
      .from("fg_inventory")
      .select("job_id")
      .ilike("lot_no", `%${q}%`)
      .limit(20),
  ]);
  assertOk("ค้นจากเลขงาน", byJobNo.error);
  assertOk("ค้นจากล็อตผลิต", byBatch.error);
  assertOk("ค้นจากคลัง FG", byFg.error);

  const jobIds = new Set<string>();
  for (const r of (byJobNo.data ?? []) as any[]) jobIds.add(r.id);
  for (const r of (byBatch.data ?? []) as any[]) jobIds.add(r.id);
  for (const r of (byFg.data ?? []) as any[]) jobIds.add(r.job_id);

  const forward = await getJobTraces([...jobIds]);
  forward.sort((a, b) => b.job_no.localeCompare(a.job_no));

  // ขาย้อนกลับ (RM lot → งาน) ถูกตัดออกใน Part C.2 — ดูคำอธิบายหัวไฟล์
  return { query: q, forward };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
