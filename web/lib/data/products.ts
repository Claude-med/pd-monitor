import { createClient } from "@/lib/supabase/server";

export type ProductOption = {
  id: string;
  code: string;
  name: string;
  dosage_form: string | null; // แสดงเป็น "ชนิด"
  unit: string;
  /** ตั้งขั้นตอนการผลิตแล้วหรือยัง — ยังไม่ตั้ง = สร้างงานไม่ได้ (ด่านจริงอยู่ที่ DB 0045) */
  has_route: boolean;
};

/**
 * ตัวเลือกผลิตภัณฑ์สำหรับหน้าสร้างงานผลิต
 * — Part 2.1: ทีมเลิกใช้การแยกประเภท ยา/RM/PM แล้ว (drop products.type ใน 0044)
 *   จึงแสดงผลิตภัณฑ์ที่เปิดใช้งานทุกตัว
 */
export async function getProducts(): Promise<ProductOption[]> {
  const supabase = await createClient();
  // ดึง route มาด้วยเพื่อบอกหน้าจอว่าผลิตภัณฑ์ไหนยังตั้งขั้นตอนการผลิตไม่ครบ
  // (นับเฉพาะสถานีที่ยังเปิดใช้งาน — ให้ตรงกับ product_has_route() ใน DB)
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, code, name, dosage_form, unit, routes:product_routes ( station:stations ( is_active ) )",
    )
    .eq("is_active", true)
    .order("code", { ascending: true });
  if (error || !data) return [];

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data as any[]).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    dosage_form: p.dosage_form ?? null,
    unit: p.unit ?? "",
    has_route: ((p.routes ?? []) as any[]).some((r) => r.station?.is_active),
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
