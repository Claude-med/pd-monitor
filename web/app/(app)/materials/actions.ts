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

/** เพิ่ม/แก้รายการวัตถุดิบ */
export async function upsertMaterial(v: {
  id: string | null;
  code: string;
  name: string;
  type: string;
  unit: string;
}): Promise<ActionResult> {
  if (!(await requireWarehouse()))
    return { error: "ไม่มีสิทธิ์ (เฉพาะฝ่ายคลัง/ผู้บริหาร)" };
  if (!v.code.trim()) return { error: "กรุณาระบุรหัสวัตถุดิบ" };
  if (!v.name.trim()) return { error: "กรุณาระบุชื่อวัตถุดิบ" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_material", {
    p_id: v.id,
    p_code: v.code.trim(),
    p_name: v.name.trim(),
    p_type: v.type || "rm",
    p_unit: v.unit.trim() || "kg",
  });
  if (error) return { error: error.message || "บันทึกวัตถุดิบไม่สำเร็จ" };
  revalidatePath("/materials");
  return { ok: true, id: data as string };
}

/** เพิ่ม/แก้ล็อตวัตถุดิบ */
export async function upsertMaterialLot(v: {
  id: string | null;
  material_id: string;
  lot_no: string;
  qty: string;
  status: string;
  received_date: string;
  expiry_date: string;
  note: string;
}): Promise<ActionResult> {
  if (!(await requireWarehouse()))
    return { error: "ไม่มีสิทธิ์ (เฉพาะฝ่ายคลัง/ผู้บริหาร)" };
  if (!v.lot_no.trim()) return { error: "กรุณาระบุเลขล็อต" };
  const qty = Number(v.qty);
  if (!Number.isFinite(qty) || qty < 0)
    return { error: "จำนวนคงเหลือไม่ถูกต้อง (ห้ามติดลบ)" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_material_lot", {
    p_id: v.id,
    p_material_id: v.material_id,
    p_lot_no: v.lot_no.trim(),
    p_qty: qty,
    p_status: v.status || "quarantine",
    p_received_date: v.received_date || null,
    p_expiry_date: v.expiry_date || null,
    p_note: v.note.trim() || null,
  });
  if (error) return { error: error.message || "บันทึกล็อตไม่สำเร็จ" };
  revalidatePath("/materials");
  return { ok: true, id: data as string };
}
