import { createClient } from "@/lib/supabase/server";

export type JobSubStatusOption = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  /** เลือกค่านี้แล้วต้องระบุเดือนแผนด้วย (ปัจจุบันคือ "มีแผน") */
  requires_plan_month: boolean;
  /** ค่าที่ระบบผูกไว้ในโค้ด — ลบ/แก้ชื่อไม่ได้ (มีแผน / ไม่มีแผน) */
  is_system: boolean;
  /** จำนวนงานที่ใช้สถานะนี้อยู่ — ใช้เตือนก่อนกดลบ (ด่านจริงอยู่ที่ delete_job_sub_status ใน DB 0053) */
  usage_count: number;
};

/**
 * ทะเบียนสถานะย่อยของงาน (Part C ก้อน 2)
 * นับ usage ฝั่ง TS จาก jobs.sub_status (เทียบด้วยชื่อ เพราะเก็บเป็น snapshot text ไม่ใช่ FK)
 * — วิธีเดียวกับ listCustomers() ใน lib/data/customers.ts
 */
export async function listJobSubStatuses(): Promise<JobSubStatusOption[]> {
  const supabase = await createClient();
  const [{ data: rows }, { data: jobs }] = await Promise.all([
    supabase
      .from("job_sub_statuses")
      .select("id, name, description, sort_order, requires_plan_month, is_system")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase.from("jobs").select("sub_status"),
  ]);

  const used = new Map<string, number>();
  for (const j of (jobs ?? []) as { sub_status: string | null }[]) {
    const key = (j.sub_status ?? "").trim().toLowerCase();
    if (!key) continue;
    used.set(key, (used.get(key) ?? 0) + 1);
  }

  return ((rows ?? []) as Omit<JobSubStatusOption, "usage_count">[]).map((s) => ({
    ...s,
    usage_count: used.get(s.name.trim().toLowerCase()) ?? 0,
  }));
}
