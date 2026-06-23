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
};

export type ActionResult = { ok?: boolean; jobNo?: string; error?: string };

/** สร้างงานผลิตใหม่ (order + job + ล็อตถ้ามี) ผ่าน rpc — DB บังคับสิทธิ์ manager + validate */
export async function createJob(v: NewJobValues): Promise<ActionResult> {
  const quantity = Number(v.quantity);
  if (!v.job_no.trim()) return { error: "กรุณาระบุเลขงาน (Job No)" };
  if (!v.customer.trim()) return { error: "กรุณาระบุลูกค้า" };
  if (!v.product_id) return { error: "กรุณาเลือกผลิตภัณฑ์" };
  if (!Number.isFinite(quantity) || quantity <= 0)
    return { error: "จำนวนต้องมากกว่า 0" };

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
  });

  if (error) return { error: error.message || "สร้างงานไม่สำเร็จ" };

  revalidatePath("/board");
  return { ok: true, jobNo: (data as string) ?? v.job_no.trim() };
}

/** เพิ่มผลิตภัณฑ์ (ยา) ใหม่ ผ่าน rpc — คืน id เพื่อเลือกในฟอร์มต่อ */
export async function createProduct(values: {
  code: string;
  name: string;
  dosage_form: string;
  standard_time_hours: string;
}): Promise<{ ok?: boolean; id?: string; error?: string }> {
  if (!values.code.trim()) return { error: "กรุณาระบุรหัสยา" };
  if (!values.name.trim()) return { error: "กรุณาระบุชื่อยา" };
  const hours = values.standard_time_hours.trim()
    ? Number(values.standard_time_hours)
    : null;
  if (hours != null && (!Number.isFinite(hours) || hours < 0))
    return { error: "เวลามาตรฐาน (ชม.) ไม่ถูกต้อง" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_product", {
    p_code: values.code.trim(),
    p_name: values.name.trim(),
    p_dosage_form: values.dosage_form.trim() || null,
    p_standard_time_hours: hours,
  });

  if (error) return { error: error.message || "เพิ่มผลิตภัณฑ์ไม่สำเร็จ" };
  return { ok: true, id: data as string };
}
