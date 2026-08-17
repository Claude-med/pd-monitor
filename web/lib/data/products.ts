import { createClient } from "@/lib/supabase/server";

export type ProductOption = {
  id: string;
  code: string;
  name: string;
  dosage_form: string | null; // แสดงเป็น "ชนิด"
  unit: string;
};

/**
 * ตัวเลือกผลิตภัณฑ์สำหรับหน้าสร้างงานผลิต
 * — Part 2.1: ทีมเลิกใช้การแยกประเภท ยา/RM/PM แล้ว (drop products.type ใน 0044)
 *   จึงแสดงผลิตภัณฑ์ที่เปิดใช้งานทุกตัว
 */
export async function getProducts(): Promise<ProductOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, code, name, dosage_form, unit")
    .eq("is_active", true)
    .order("code", { ascending: true });
  if (error || !data) return [];
  return data as ProductOption[];
}
