import { createClient } from "@/lib/supabase/server";
import type { ProductionRecordRow } from "@/lib/data/production-constants";

export * from "@/lib/data/production-constants";

// operator_id เป็นหนึ่งใน FK หลายตัวที่ชี้ profiles → ต้องระบุคอลัมน์ให้ PostgREST
const SELECT = `
  id, job_route_id, station_id, record_date, shift, work_period,
  input_qty, input_unit, output_qty, output_unit, loss_qty, loss_unit,
  minutes, headcount, note, created_at, machine_id,
  status, approved_at, approve_note, created_by, operator_id,
  operator:profiles!operator_id ( full_name ),
  approver:profiles!approved_by ( full_name ),
  machine:machines!machine_id ( code, name ),
  station_ref:stations!station_id ( name )
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function shape(r: any): ProductionRecordRow {
  const op = Array.isArray(r.operator) ? r.operator[0] : r.operator;
  const mc = Array.isArray(r.machine) ? r.machine[0] : r.machine;
  const st = Array.isArray(r.station_ref) ? r.station_ref[0] : r.station_ref;
  const ap = Array.isArray(r.approver) ? r.approver[0] : r.approver;
  return {
    id: r.id,
    job_route_id: r.job_route_id ?? null,
    station_id: r.station_id ?? null,
    station_name: st?.name ?? null,
    record_date: r.record_date,
    shift: r.shift ?? null,
    work_period: r.work_period ?? null,
    input_qty: r.input_qty,
    input_unit: r.input_unit ?? null,
    output_qty: r.output_qty,
    output_unit: r.output_unit ?? null,
    loss_qty: r.loss_qty,
    loss_unit: r.loss_unit ?? null,
    minutes: r.minutes,
    note: r.note,
    operator_name: op?.full_name ?? null,
    machine_id: r.machine_id ?? null,
    machine_label: mc ? `${mc.code} · ${mc.name}` : null,
    headcount: r.headcount ?? null,
    created_at: r.created_at,
    status: (r.status ?? "pending") as ProductionRecordRow["status"],
    approved_at: r.approved_at ?? null,
    approve_note: r.approve_note ?? null,
    approver_name: ap?.full_name ?? null,
    created_by_id: r.created_by ?? null,
    operator_id: r.operator_id ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** บันทึกผลผลิตของงานหนึ่ง เรียงตามวันที่/เวลาบันทึก (ใหม่ล่าสุดอยู่บน) */
export async function getRecordsForJob(
  jobId: string,
): Promise<ProductionRecordRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("production_records")
    .select(SELECT)
    .eq("job_id", jobId)
    .order("record_date", { ascending: false })
    .order("created_at", { ascending: false });
  // ต้องเช็ก error เสมอ — RLS ผิดจะตอบ [] แบบเงียบ แยกจาก "ไม่มีข้อมูล" ไม่ออก
  if (error || !data) return [];
  return data.map(shape);
}
