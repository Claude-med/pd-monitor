import { createClient } from "@/lib/supabase/server";

export type MachineUsageRow = {
  machine_id: string;
  code: string;
  name: string;
  total_hours: number;
  record_count: number;
  job_count: number;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function pickMachine(r: any): { code: string; name: string } | null {
  const m = Array.isArray(r.machine) ? r.machine[0] : r.machine;
  return m ? { code: m.code, name: m.name } : null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * สรุปการใช้งานเครื่องจักรในช่วง [from, to] — รวมชั่วโมง / จำนวนครั้งบันทึก / จำนวนงาน ต่อเครื่อง
 * อ่านจาก production_records ที่ผูก machine_id (A1 ก้อน 3)
 */
export async function getMachineUsage(
  from: string,
  to: string,
): Promise<MachineUsageRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("production_records")
    .select("machine_id, hours, job_id, machine:machines!machine_id ( code, name )")
    .not("machine_id", "is", null)
    .gte("record_date", from)
    .lte("record_date", to);

  const map = new Map<
    string,
    { code: string; name: string; hours: number; records: number; jobs: Set<string> }
  >();

  for (const r of data ?? []) {
    const id = r.machine_id as string;
    const mc = pickMachine(r);
    const cur =
      map.get(id) ??
      { code: mc?.code ?? "—", name: mc?.name ?? "", hours: 0, records: 0, jobs: new Set<string>() };
    cur.hours += Number(r.hours ?? 0);
    cur.records += 1;
    if (r.job_id) cur.jobs.add(r.job_id as string);
    map.set(id, cur);
  }

  return [...map.entries()]
    .map(([machine_id, v]) => ({
      machine_id,
      code: v.code,
      name: v.name,
      total_hours: v.hours,
      record_count: v.records,
      job_count: v.jobs.size,
    }))
    .sort((a, b) => b.total_hours - a.total_hours);
}
