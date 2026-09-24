"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";

export type ActionResult = { ok?: boolean; id?: string; error?: string };

async function requireWarehouse(): Promise<boolean> {
  const profile = await getProfile();
  return !!profile && hasAnyRole(profile.roles, ["warehouse", "manager"]);
}

/** รับงานเข้าคลัง FG (หรือแก้จำนวน/ตำแหน่ง) */
export async function receiveFg(v: {
  job_id: string;
  qty: string;
  unit: string;
  location: string;
  lot_no: string;
  note: string;
}): Promise<ActionResult> {
  if (!(await requireWarehouse()))
    return { error: "ไม่มีสิทธิ์ (เฉพาะฝ่ายคลัง/ผู้บริหาร)" };
  if (!v.job_id) return { error: "ไม่พบงาน" };
  const qty = Number(v.qty);
  if (!Number.isFinite(qty) || qty < 0)
    return { error: "จำนวนไม่ถูกต้อง (ห้ามว่างหรือติดลบ)" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_fg", {
    p_job_id: v.job_id,
    p_qty: qty,
    p_unit: v.unit.trim() || null,
    p_location: v.location.trim() || null,
    p_lot_no: v.lot_no.trim() || null,
    p_note: v.note.trim() || null,
  });
  if (error) return { error: error.message || "รับเข้าคลังไม่สำเร็จ" };
  revalidatePath("/warehouse");
  return { ok: true, id: data as string };
}

/** บันทึกจ่ายออก FG (Part G · 0097) — ด่าน "จ่ายเกินคงคลัง" อยู่ที่ RPC */
export async function addFgDispatch(v: {
  job_id: string;
  qty: string;
  dispatched_date: string;
  doc_no: string;
  customer: string;
  note: string;
}): Promise<ActionResult> {
  if (!(await requireWarehouse()))
    return { error: "ไม่มีสิทธิ์ (เฉพาะฝ่ายคลัง/ผู้บริหาร)" };
  if (!v.job_id) return { error: "ไม่พบงาน" };
  const qty = Number(v.qty);
  if (!Number.isFinite(qty) || qty <= 0)
    return { error: "จำนวนจ่ายออกต้องมากกว่า 0" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_fg_dispatch", {
    p_job_id: v.job_id,
    p_qty: qty,
    p_dispatched_date: v.dispatched_date || null,
    p_doc_no: v.doc_no.trim() || null,
    p_customer: v.customer.trim() || null,
    p_note: v.note.trim() || null,
  });
  if (error) return { error: error.message || "บันทึกจ่ายออกไม่สำเร็จ" };
  revalidatePath("/warehouse");
  return { ok: true, id: data as string };
}

/** ลบรายการจ่ายออก — soft delete + เหตุผล (ยอดกลับเข้าคงคลัง) */
export async function deleteFgDispatch(
  id: string,
  reason: string,
): Promise<ActionResult> {
  if (!(await requireWarehouse()))
    return { error: "ไม่มีสิทธิ์ (เฉพาะฝ่ายคลัง/ผู้บริหาร)" };
  if (!id) return { error: "ไม่พบรายการ" };
  if (!reason.trim()) return { error: "กรุณาระบุเหตุผลที่ลบ" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_fg_dispatch", {
    p_id: id,
    p_reason: reason.trim(),
  });
  if (error) return { error: error.message || "ลบรายการไม่สำเร็จ" };
  revalidatePath("/warehouse");
  return { ok: true };
}
