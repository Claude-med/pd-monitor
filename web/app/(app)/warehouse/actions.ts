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
