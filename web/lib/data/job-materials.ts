import { createClient } from "@/lib/supabase/server";
import type {
  MaterialItemType,
  MaterialReadyStatus,
} from "@/lib/data/job-material-constants";

/**
 * รายการวัตถุดิบ/บรรจุภัณฑ์ที่ต้องเบิกใช้ต่องาน (Part C.2 · ตาราง job_materials)
 *
 * เป็น "บันทึกหน้างาน" ล้วน — ไม่ผูกล็อตในคลัง ไม่ตัดสต็อก
 * ฝ่ายผลิตพิมพ์รายการ · ฝ่ายคลังกดสถานะ พร้อม/ไม่พร้อม
 */

export type JobMaterialRow = {
  id: string;
  job_id: string;
  item_name: string;
  item_type: MaterialItemType;
  qty: number | null;
  qty_unit: string | null;
  note: string | null;
  status: MaterialReadyStatus;
  status_changed_at: string | null;
  status_changed_by_name: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

/** รายการเบิกของงานหนึ่ง จัดกลุ่มพร้อมข้อมูลงาน — ใช้ที่หน้ารวมของฝ่ายคลัง */
export type JobMaterialGroup = {
  job_id: string;
  job_no: string;
  job_status: string;
  product_name: string | null;
  items: JobMaterialRow[];
};

const SELECT_COLS = `
  id, job_id, item_name, item_type, qty, qty_unit, note, status,
  status_changed_at, created_at, updated_at,
  status_by:profiles!status_changed_by ( full_name ),
  creator:profiles!created_by ( full_name )
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function first(x: any): any {
  return Array.isArray(x) ? x[0] : x;
}

function toRow(r: any): JobMaterialRow {
  return {
    id: r.id,
    job_id: r.job_id,
    item_name: r.item_name,
    item_type: r.item_type,
    qty: r.qty == null ? null : Number(r.qty),
    qty_unit: r.qty_unit,
    note: r.note,
    status: r.status,
    status_changed_at: r.status_changed_at,
    status_changed_by_name: first(r.status_by)?.full_name ?? null,
    created_by_name: first(r.creator)?.full_name ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * รายการเบิกของงานหนึ่ง — เรียงตามลำดับที่พิมพ์ (note list อ่านจากบนลงล่าง)
 *
 * ⚠️ รับ error มาด้วยเสมอ: RLS ที่ตั้งผิดจะตอบ "ว่างเปล่า" โดยไม่มี error ให้เห็น
 *    ถ้า destructure แค่ { data } บั๊กแบบนี้จะเงียบสนิท (บทเรียน note.md)
 */
export async function getJobMaterials(
  jobId: string,
): Promise<JobMaterialRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_materials")
    .select(SELECT_COLS)
    .eq("job_id", jobId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error("[job-materials] getJobMaterials", error.message);
    return [];
  }
  return (data ?? []).map(toRow);
}

/**
 * รายการเบิกข้ามทุกงาน สำหรับหน้ารวมของฝ่ายคลัง
 *
 * ⚠️ query เดียวแล้วจัดกลุ่มฝั่ง TS — ห้ามวนเรียกรายงาน (N+1)
 *    `jobs!inner` จำเป็น ไม่งั้น PostgREST กรองด้วยคอลัมน์ของตารางที่ join มาไม่ได้
 */
export async function listJobMaterialsAcrossJobs(opts?: {
  status?: MaterialReadyStatus | "all";
  scope?: "active" | "all";
}): Promise<JobMaterialGroup[]> {
  const status = opts?.status ?? "not_ready";
  const scope = opts?.scope ?? "active";

  const supabase = await createClient();
  let q = supabase
    .from("job_materials")
    .select(
      `${SELECT_COLS},
       job:jobs!inner ( id, job_no, status, orders ( products ( name ) ) )`,
    )
    .order("created_at", { ascending: true })
    .limit(1000);

  if (status !== "all") q = q.eq("status", status);
  // งานที่เข้าคลัง FG แล้วถือว่าจบ ไม่ต้องรกหน้าคลัง
  if (scope === "active") q = q.neq("job.status", "finished_goods");

  const { data, error } = await q;
  if (error) {
    console.error("[job-materials] listJobMaterialsAcrossJobs", error.message);
    return [];
  }

  const groups = new Map<string, JobMaterialGroup>();
  for (const r of (data ?? []) as any[]) {
    const job = first(r.job);
    if (!job) continue;
    let g = groups.get(job.id);
    if (!g) {
      const order = first(job.orders);
      g = {
        job_id: job.id,
        job_no: job.job_no,
        job_status: job.status,
        product_name: first(order?.products)?.name ?? null,
        items: [],
      };
      groups.set(job.id, g);
    }
    g.items.push(toRow(r));
  }

  // เลขงานเรียงขึ้น = งานเก่าที่ค้างนานอยู่บนสุด
  return Array.from(groups.values()).sort((a, b) =>
    a.job_no.localeCompare(b.job_no),
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
