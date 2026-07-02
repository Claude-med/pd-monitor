import { createClient } from "@/lib/supabase/server";
import type { RequisitionStatus } from "@/lib/data/requisition-constants";

export type RequisitionRow = {
  id: string;
  qty: number;
  status: RequisitionStatus;
  note: string | null;
  material_code: string;
  material_name: string;
  unit: string;
  lot_no: string;
  requested_by_id: string | null;
  requested_by_name: string | null;
  requested_at: string;
};

export type SelectableLot = {
  lot_id: string;
  material_id: string;
  label: string; // "RM-001 แป้ง · ล็อต L1 (คงเหลือ 50 kg)"
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function first(x: any): any {
  return Array.isArray(x) ? x[0] : x;
}

/** ใบเบิกวัตถุดิบของงานหนึ่ง (ใหม่ล่าสุดอยู่บน) */
export async function getRequisitionsForJob(
  jobId: string,
): Promise<RequisitionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("material_requisitions")
    .select(
      `id, qty, status, note, requested_at, requested_by,
       requester:profiles!requested_by ( full_name ),
       lot:material_lots!material_lot_id (
         lot_no, material:materials!material_id ( code, name, unit )
       )`,
    )
    .eq("job_id", jobId)
    .order("requested_at", { ascending: false });

  return (data ?? []).map((r: any) => {
    const lot = first(r.lot);
    const mat = first(lot?.material);
    const req = first(r.requester);
    return {
      id: r.id,
      qty: Number(r.qty),
      status: r.status,
      note: r.note,
      material_code: mat?.code ?? "—",
      material_name: mat?.name ?? "",
      unit: mat?.unit ?? "",
      lot_no: lot?.lot_no ?? "—",
      requested_by_id: r.requested_by ?? null,
      requested_by_name: req?.full_name ?? null,
      requested_at: r.requested_at,
    };
  });
}

/**
 * material_id ที่อยู่ใน BOM ของสูตรที่ผูกกับงาน (ข้อ 5)
 *   null = งานไม่มีสูตร / สูตรไม่มี BOM → ไม่กรอง (แสดงวัตถุดิบทั้งหมด backward-compat)
 */
export async function getRecipeMaterialIds(
  jobId: string,
): Promise<string[] | null> {
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("recipe_id")
    .eq("id", jobId)
    .maybeSingle();
  const recipeId = (job as { recipe_id?: string } | null)?.recipe_id;
  if (!recipeId) return null;
  const { data } = await supabase
    .from("recipe_items")
    .select("material_id")
    .eq("recipe_id", recipeId);
  const ids = ((data ?? []) as { material_id: string }[])
    .map((r) => r.material_id)
    .filter(Boolean);
  return ids.length ? ids : null;
}

/**
 * ล็อตที่เลือกเบิกได้ (มีของ + ไม่ใช่ไม่ผ่าน/หมดอายุ) สำหรับฟอร์มขอเบิก
 *   allowedMaterialIds (ถ้ามี) = กรองเฉพาะวัตถุดิบที่อยู่ใน BOM ของสูตร (ข้อ 5)
 */
export async function getSelectableLots(
  allowedMaterialIds?: string[] | null,
): Promise<SelectableLot[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("material_lots")
    .select(
      `id, lot_no, qty_on_hand, status, expiry_date,
       material:materials!material_id ( id, code, name, unit )`,
    )
    .gt("qty_on_hand", 0)
    .not("status", "in", "(rejected,expired)")
    .order("expiry_date", { ascending: true });

  const today = new Date().toISOString().slice(0, 10);
  const allow =
    allowedMaterialIds && allowedMaterialIds.length
      ? new Set(allowedMaterialIds)
      : null;
  const out: SelectableLot[] = [];
  for (const l of (data ?? []) as any[]) {
    if (l.expiry_date && l.expiry_date < today) continue; // กันล็อตหมดอายุ
    const mat = first(l.material);
    if (allow && !allow.has(mat?.id)) continue; // กรองตาม BOM ของสูตร
    out.push({
      lot_id: l.id,
      material_id: mat?.id ?? "",
      label: `${mat?.code ?? "—"} ${mat?.name ?? ""} · ล็อต ${l.lot_no} (คงเหลือ ${Number(
        l.qty_on_hand,
      ).toLocaleString("th-TH")} ${mat?.unit ?? ""})`,
    });
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
