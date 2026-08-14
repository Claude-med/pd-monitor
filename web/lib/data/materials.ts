import { createClient } from "@/lib/supabase/server";
import type { MaterialLotStatus } from "@/lib/data/material-constants";

export type MaterialLot = {
  id: string;
  lot_no: string;
  qty_on_hand: number;
  status: MaterialLotStatus;
  received_date: string | null;
  expiry_date: string | null;
  note: string | null;
};

/**
 * ผลิตภัณฑ์ + ล็อตในคลัง
 * — Part 2 ก้อน 3: ยุบ materials เข้า products แล้ว ล็อตผูกกับ products
 *   ตาราง material_lots ยังใช้ชื่อเดิม (เปลี่ยนแค่ FK เป็น product_id)
 */
export type ProductWithLots = {
  id: string;
  code: string;
  name: string;
  type: string; // fg | rm | pm
  unit: string;
  dosage_form: string | null; // แสดงเป็น "ชนิด"
  is_active: boolean;
  lots: MaterialLot[];
};

/** ผลิตภัณฑ์ทั้งหมด + ล็อตของแต่ละตัว (เรียงตามรหัส · ล็อตหมดอายุก่อนขึ้นก่อน) */
export async function listStockProducts(): Promise<ProductWithLots[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      `id, code, name, type, unit, dosage_form, is_active,
       lots:material_lots ( id, lot_no, qty_on_hand, status, received_date, expiry_date, note )`,
    )
    .order("code", { ascending: true });
  if (error || !data) return [];

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data as any[]).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    type: p.type ?? "fg",
    unit: p.unit ?? "",
    dosage_form: p.dosage_form ?? null,
    is_active: p.is_active ?? true,
    lots: ((p.lots ?? []) as MaterialLot[]).slice().sort((a, b) => {
      // ล็อตที่มีวันหมดอายุเร็วสุดขึ้นก่อน (null = ไม่มีวันหมดอายุ ไปท้าย)
      if (!a.expiry_date) return 1;
      if (!b.expiry_date) return -1;
      return a.expiry_date.localeCompare(b.expiry_date);
    }),
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
