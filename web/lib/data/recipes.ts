import { createClient } from "@/lib/supabase/server";

export type RecipeItem = {
  id: string;
  material_id: string;
  material_code: string;
  material_name: string;
  qty: number;
  unit: string | null;
  note: string | null;
};

export type Recipe = {
  id: string;
  name: string;
  batch_size: number | null;
  batch_unit: string;
  is_active: boolean;
  note: string | null;
  items: RecipeItem[];
};

export type ProductWithRecipes = {
  id: string;
  code: string;
  name: string;
  dosage_form: string | null;
  pack_type: string | null;
  pack_pattern: string | null;
  recipes: Recipe[];
};

export type MaterialOption = {
  id: string;
  code: string;
  name: string;
  unit: string;
};

/** วัตถุดิบ/บรรจุภัณฑ์ทั้งหมด (สำหรับ dropdown เลือกใส่ในสูตร) */
export async function getMaterialOptions(): Promise<MaterialOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("materials")
    .select("id, code, name, unit")
    .eq("is_active", true)
    .order("code", { ascending: true });
  if (error || !data) return [];
  return data as MaterialOption[];
}

/** ยา/ผลิตภัณฑ์ทั้งหมด + สูตร + รายการวัตถุดิบในสูตร (BOM) */
export async function listProductsWithRecipes(): Promise<ProductWithRecipes[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      `id, code, name, dosage_form, pack_type, pack_pattern,
       recipes:product_recipes (
         id, name, batch_size, batch_unit, is_active, note,
         items:recipe_items (
           id, material_id, qty, unit, note,
           material:materials ( code, name )
         )
       )`,
    )
    .eq("is_active", true)
    .order("code", { ascending: true });
  if (error || !data) return [];

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data as any[]).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    dosage_form: p.dosage_form,
    pack_type: p.pack_type ?? null,
    pack_pattern: p.pack_pattern ?? null,
    recipes: ((p.recipes ?? []) as any[])
      .map((r) => ({
        id: r.id,
        name: r.name,
        batch_size: r.batch_size === null ? null : Number(r.batch_size),
        batch_unit: r.batch_unit,
        is_active: r.is_active,
        note: r.note,
        items: ((r.items ?? []) as any[])
          .map((it) => ({
            id: it.id,
            material_id: it.material_id,
            material_code: it.material?.code ?? "—",
            material_name: it.material?.name ?? "",
            qty: Number(it.qty),
            unit: it.unit,
            note: it.note,
          }))
          .sort((a, b) => a.material_code.localeCompare(b.material_code)),
      }))
      // สูตรที่ใช้อยู่ขึ้นก่อน แล้วเรียงตามชื่อ
      .sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
