"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type NewJobValues = {
  job_no: string;
  customer: string;
  product_id: string;
  quantity: string;
  unit: string;
  due_date: string;
  planned_start: string;
  planned_end: string;
  lot_no: string;
  pack_type: string;
  /** ขนาดบรรจุ 1–3 ช่อง (ตรงกับใบแจ้งผลิต F.PLN.01) */
  pack_patterns: string[];
};

export type ActionResult = { ok?: boolean; jobNo?: string; error?: string };

/** สร้างออเดอร์ + งานผลิต + (ถ้าระบุ) ล็อต ในครั้งเดียว */
export async function createJob(v: NewJobValues): Promise<ActionResult> {
  // job_no เว้นว่างได้ — DB จะออกเลขให้อัตโนมัติ (JOB-YYYY-NNNN)
  if (!v.customer.trim()) return { error: "กรุณาระบุลูกค้า" };
  if (!v.product_id) return { error: "กรุณาเลือกผลิตภัณฑ์" };
  const quantity = Number(v.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0)
    return { error: "จำนวนต้องมากกว่า 0" };

  const packs = (v.pack_patterns ?? [])
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 3);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_job_with_order", {
    p_customer: v.customer.trim(),
    p_product_id: v.product_id,
    p_quantity: quantity,
    p_unit: v.unit.trim() || null,
    p_due_date: v.due_date || null,
    p_job_no: v.job_no.trim(),
    p_planned_start: v.planned_start || null,
    p_planned_end: v.planned_end || null,
    p_lot_no: v.lot_no.trim() || null,
    p_pack_type: v.pack_type.trim() || null,
    p_pack_pattern_1: packs[0] ?? null,
    p_pack_pattern_2: packs[1] ?? null,
    p_pack_pattern_3: packs[2] ?? null,
  });
  if (error) return { error: error.message || "สร้างงานไม่สำเร็จ" };

  revalidatePath("/board");
  return { ok: true, jobNo: (data as string) ?? v.job_no.trim() };
}
