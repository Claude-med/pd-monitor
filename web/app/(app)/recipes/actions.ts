"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";

export type ActionResult = { ok?: boolean; id?: string; error?: string };

async function requireManager(): Promise<boolean> {
  const profile = await getProfile();
  return !!profile && hasAnyRole(profile.roles, ["manager"]);
}

/** เพิ่ม/แก้หัวสูตร */
export async function upsertRecipe(v: {
  id: string | null;
  product_id: string;
  name: string;
  batch_size: string;
  batch_unit: string;
  is_active: boolean;
  note: string;
}): Promise<ActionResult> {
  if (!(await requireManager()))
    return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร)" };
  if (!v.product_id) return { error: "ไม่พบยา/ผลิตภัณฑ์" };

  let batchSize: number | null = null;
  if (v.batch_size.trim() !== "") {
    batchSize = Number(v.batch_size);
    if (!Number.isFinite(batchSize) || batchSize < 0)
      return { error: "ขนาดแบตช์ไม่ถูกต้อง (ห้ามติดลบ)" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_recipe", {
    p_id: v.id,
    p_product_id: v.product_id,
    p_name: v.name.trim() || "สูตรมาตรฐาน",
    p_batch_size: batchSize,
    p_batch_unit: v.batch_unit.trim() || "เม็ด",
    p_is_active: v.is_active,
    p_note: v.note.trim() || null,
  });
  if (error) return { error: error.message || "บันทึกสูตรไม่สำเร็จ" };
  revalidatePath("/recipes");
  return { ok: true, id: data as string };
}

/** แทนที่รายการวัตถุดิบในสูตร (BOM) ทั้งชุด */
export async function setRecipeItems(
  recipeId: string,
  items: { material_id: string; qty: string; unit: string; note: string }[],
): Promise<ActionResult> {
  if (!(await requireManager()))
    return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร)" };
  if (!recipeId) return { error: "ไม่พบสูตร" };

  const payload: { material_id: string; qty: number; unit?: string; note?: string }[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it.material_id) continue; // ข้ามแถวว่าง
    if (seen.has(it.material_id))
      return { error: "มีวัตถุดิบซ้ำกันในสูตร — รวมเป็นรายการเดียว" };
    seen.add(it.material_id);
    const qty = Number(it.qty);
    if (!Number.isFinite(qty) || qty < 0)
      return { error: "จำนวนวัตถุดิบในสูตรไม่ถูกต้อง (ห้ามว่างหรือติดลบ)" };
    payload.push({
      material_id: it.material_id,
      qty,
      unit: it.unit.trim() || undefined,
      note: it.note.trim() || undefined,
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_recipe_items", {
    p_recipe_id: recipeId,
    p_items: payload,
  });
  if (error) return { error: error.message || "บันทึกรายการวัตถุดิบไม่สำเร็จ" };
  revalidatePath("/recipes");
  return { ok: true };
}
