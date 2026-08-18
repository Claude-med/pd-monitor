import { createClient } from "@/lib/supabase/server";

export type CustomerOption = {
  id: string;
  name: string;
  /** จำนวนใบสั่งผลิตที่ผูกอยู่ — ใช้เตือนก่อนกดลบ (ด่านจริงอยู่ที่ delete_customer ใน DB 0047) */
  usage_count: number;
};

/**
 * ทะเบียนลูกค้าสำหรับ dropdown หน้าสร้างงานผลิต (Part 3 ก้อน 1)
 * นับ usage ฝั่ง TS จาก orders.customer_id — ชัวร์กว่าพึ่ง embed count ของ PostgREST
 */
export async function listCustomers(): Promise<CustomerOption[]> {
  const supabase = await createClient();
  const [{ data: rows }, { data: orders }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name")
      .order("name", { ascending: true }),
    supabase.from("orders").select("customer_id"),
  ]);

  const used = new Map<string, number>();
  for (const o of (orders ?? []) as { customer_id: string | null }[]) {
    if (!o.customer_id) continue;
    used.set(o.customer_id, (used.get(o.customer_id) ?? 0) + 1);
  }

  return ((rows ?? []) as { id: string; name: string }[]).map((c) => ({
    id: c.id,
    name: c.name,
    usage_count: used.get(c.id) ?? 0,
  }));
}
