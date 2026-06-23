import { createClient } from "@/lib/supabase/server";

export type ProductOption = {
  id: string;
  code: string;
  name: string;
  dosage_form: string | null;
};

/** รายการผลิตภัณฑ์ (ยา) สำหรับ dropdown ตอนสร้างงาน — เฉพาะที่ยังใช้งานอยู่ */
export async function getProducts(): Promise<ProductOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, code, name, dosage_form")
    .eq("is_active", true)
    .order("code", { ascending: true });
  if (error || !data) return [];
  return data as ProductOption[];
}
