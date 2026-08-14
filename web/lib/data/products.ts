import { createClient } from "@/lib/supabase/server";

export type ProductOption = {
  id: string;
  code: string;
  name: string;
  dosage_form: string | null; // แสดงเป็น "ชนิด"
  unit: string;
};

/**
 * ตัวเลือกยาสำหรับหน้าสร้างงานผลิต
 * — Part 2: กรองเฉพาะ type = 'fg' (ยา/สินค้าสำเร็จรูป)
 *   เพราะตาราง products ตอนนี้เก็บวัตถุดิบ (rm) และบรรจุภัณฑ์ (pm) รวมอยู่ด้วย
 */
export async function getProducts(): Promise<ProductOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, code, name, dosage_form, unit")
    .eq("is_active", true)
    .eq("type", "fg")
    .order("code", { ascending: true });
  if (error || !data) return [];
  return data as ProductOption[];
}
