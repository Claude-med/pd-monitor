import { createClient } from "@/lib/supabase/server";
import type { StationKey } from "@/lib/data/station-constants";

export type RouteStep = {
  id: string;
  station_id: string;
  station_code: string;
  station_name: string;
  station_group: StationKey;
  step_no: number;
  note: string | null;
};

/**
 * ผลิตภัณฑ์ + ขั้นตอนการผลิต (route)
 * — Part 2: ตัด "สูตร (product_recipes)" และ "รายการวัตถุดิบ (recipe_items)" ออกจาก UI แล้ว
 *   ตารางยังอยู่ใน DB (เก็บประวัติตาม ALCOA · jobs.recipe_id เป็น FK RESTRICT)
 * — `dosage_form` แสดงบนจอเป็น "ชนิด" (TAB/CAP/F/C/CRM/LIQ …) ตามที่ทีมผลิตเรียก
 */
export type ProductWithRoute = {
  id: string;
  code: string;
  name: string;
  dosage_form: string | null;
  unit: string;
  reg_no: string | null;
  type: string; // fg | rm | pm — ดู product-constants.ts
  is_active: boolean;
  route: RouteStep[];
};

/** ผลิตภัณฑ์ทั้งหมด (รวมที่ปิดใช้งาน — ให้หน้าจอเลือกกรองเอง) + ลำดับสถานี */
export async function listProductsWithRoutes(): Promise<ProductWithRoute[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      `id, code, name, dosage_form, unit, reg_no, type, is_active,
       route:product_routes (
         id, station_id, step_no, note,
         station:stations ( code, name, station_group )
       )`,
    )
    .order("code", { ascending: true });
  if (error || !data) return [];

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data as any[]).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    dosage_form: p.dosage_form ?? null,
    unit: p.unit ?? "",
    reg_no: p.reg_no ?? null,
    type: p.type ?? "fg",
    is_active: p.is_active ?? true,
    route: ((p.route ?? []) as any[])
      .map((r) => ({
        id: r.id,
        station_id: r.station_id,
        station_code: r.station?.code ?? "—",
        station_name: r.station?.name ?? "",
        station_group: r.station?.station_group,
        step_no: r.step_no,
        note: r.note,
      }))
      .sort((a, b) => a.step_no - b.step_no),
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
