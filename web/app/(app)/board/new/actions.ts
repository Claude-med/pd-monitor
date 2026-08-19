"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  MAX_JOBS_PER_CREATE,
  DEFAULT_JOB_SUB_STATUS,
} from "@/lib/data/job-constants";

export type NewJobValues = {
  /** id จากทะเบียนลูกค้า (Part 3 ก้อน 1) */
  customer_id: string;
  product_id: string;
  /** Batch size ต่อ 1 ใบ — ทุกใบในชุดเท่ากัน */
  quantity: string;
  due_date: string;
  /** "ใบคำขอ" — เลขที่ใบสั่งผลิตจากลูกค้า */
  request_no: string;
  /** "C.P.O DATE" — วันที่ลูกค้าสั่งผลิต */
  cpo_date: string;
  pack_type: string;
  /** ขนาดบรรจุ 1–3 ช่อง (ตรงกับใบแจ้งผลิต F.PLN.01) */
  pack_patterns: string[];
  /** จำนวนใบที่จะสร้างพร้อมกัน (1–50) */
  count: string;
};

export type ActionResult = { ok?: boolean; jobNos?: string[]; error?: string };

/**
 * สร้างงานผลิต 1–50 ใบจากข้อมูลชุดเดียว (Part 3 ก้อน 2)
 * เลขงานออกโดย DB เป็นเลข 6 หลัก (ปี พ.ศ. + running) — ผู้ใช้กรอกเองไม่ได้แล้ว
 *
 * Part 3.1: หน่วย + Status ไม่รับจากฟอร์มแล้ว
 *   - หน่วย = อ่านจากทะเบียนยาที่นี่เสมอ (ไม่ใช่แค่ซ่อนช่องใน UI)
 *   - Status = ตั้งเป็น "ไม่มีแผน" ให้ทุกใบ
 */
export async function createJobs(v: NewJobValues): Promise<ActionResult> {
  if (!v.customer_id) return { error: "กรุณาเลือกลูกค้า" };
  if (!v.product_id) return { error: "กรุณาเลือกผลิตภัณฑ์" };

  const quantity = Number(v.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0)
    return { error: "Batch size ต้องมากกว่า 0" };

  const count = Number(v.count || "1");
  if (!Number.isInteger(count) || count < 1)
    return { error: "จำนวนใบที่จะสร้างต้องอย่างน้อย 1 ใบ" };
  if (count > MAX_JOBS_PER_CREATE)
    return { error: `สร้างได้สูงสุด ${MAX_JOBS_PER_CREATE} ใบต่อครั้ง` };

  const packs = (v.pack_patterns ?? [])
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 3);

  const supabase = await createClient();

  // หน่วยล็อกตามทะเบียนยา — ฟอร์มส่งมาไม่ได้ กันหน่วยของงานเพี้ยนจากทะเบียน
  const { data: product } = await supabase
    .from("products")
    .select("unit")
    .eq("id", v.product_id)
    .maybeSingle();
  if (!product) return { error: "ไม่พบผลิตภัณฑ์ที่เลือก" };

  const { data, error } = await supabase.rpc("create_production_jobs", {
    p_customer_id: v.customer_id,
    p_product_id: v.product_id,
    p_quantity: quantity,
    p_unit: (product.unit ?? "").trim() || null,
    p_due_date: v.due_date || null,
    p_request_no: v.request_no.trim() || null,
    p_cpo_date: v.cpo_date || null,
    p_sub_status: DEFAULT_JOB_SUB_STATUS,
    p_pack_type: v.pack_type.trim() || null,
    p_pack_pattern_1: packs[0] ?? null,
    p_pack_pattern_2: packs[1] ?? null,
    p_pack_pattern_3: packs[2] ?? null,
    p_count: count,
  });
  if (error) return { error: error.message || "สร้างงานไม่สำเร็จ" };

  revalidatePath("/board");
  return { ok: true, jobNos: (data as string[]) ?? [] };
}
