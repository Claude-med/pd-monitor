import { createClient } from "@/lib/supabase/server";
import type {
  MaterialType,
  MaterialLotStatus,
} from "@/lib/data/material-constants";

export type MaterialLot = {
  id: string;
  lot_no: string;
  qty_on_hand: number;
  status: MaterialLotStatus;
  received_date: string | null;
  expiry_date: string | null;
  note: string | null;
};

export type MaterialWithLots = {
  id: string;
  code: string;
  name: string;
  type: MaterialType;
  unit: string;
  is_active: boolean;
  lots: MaterialLot[];
};

/** รายการวัตถุดิบทั้งหมด + ล็อตของแต่ละตัว (เรียงตามรหัส · ล็อตหมดอายุก่อนขึ้นก่อน) */
export async function listMaterials(): Promise<MaterialWithLots[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("materials")
    .select(
      `id, code, name, type, unit, is_active,
       lots:material_lots ( id, lot_no, qty_on_hand, status, received_date, expiry_date, note )`,
    )
    .order("code", { ascending: true });
  if (error || !data) return [];

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data as any[]).map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    type: m.type,
    unit: m.unit,
    is_active: m.is_active,
    lots: ((m.lots ?? []) as MaterialLot[]).slice().sort((a, b) => {
      // ล็อตที่มีวันหมดอายุเร็วสุดขึ้นก่อน (null = ไม่มีวันหมดอายุ ไปท้าย)
      if (!a.expiry_date) return 1;
      if (!b.expiry_date) return -1;
      return a.expiry_date.localeCompare(b.expiry_date);
    }),
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
