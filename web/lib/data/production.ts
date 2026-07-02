import { createClient } from "@/lib/supabase/server";
import type { ProductionRecordRow } from "@/lib/data/station-constants";

export * from "@/lib/data/station-constants";

// operator_id เป็นหนึ่งใน FK หลายตัวที่ชี้ profiles → ต้องระบุคอลัมน์ให้ PostgREST
const SELECT = `
  id, station, station_id, record_date, input_qty, output_qty, loss_qty, hours, headcount, note, created_at, machine_id,
  operator:profiles!operator_id ( full_name ),
  machine:machines!machine_id ( code, name ),
  station_ref:stations!station_id ( name )
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function shape(r: any): ProductionRecordRow {
  const op = Array.isArray(r.operator) ? r.operator[0] : r.operator;
  const mc = Array.isArray(r.machine) ? r.machine[0] : r.machine;
  const st = Array.isArray(r.station_ref) ? r.station_ref[0] : r.station_ref;
  return {
    id: r.id,
    station: r.station,
    station_id: r.station_id ?? null,
    station_name: st?.name ?? null,
    record_date: r.record_date,
    input_qty: r.input_qty,
    output_qty: r.output_qty,
    loss_qty: r.loss_qty,
    hours: r.hours,
    note: r.note,
    operator_name: op?.full_name ?? null,
    machine_id: r.machine_id ?? null,
    machine_label: mc ? `${mc.code} · ${mc.name}` : null,
    headcount: r.headcount ?? null,
    created_at: r.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** บันทึกผลผลิตของงานหนึ่ง เรียงตามวันที่/เวลาบันทึก (ใหม่ล่าสุดอยู่บน) */
export async function getRecordsForJob(
  jobId: string,
): Promise<ProductionRecordRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("production_records")
    .select(SELECT)
    .eq("job_id", jobId)
    .order("record_date", { ascending: false })
    .order("created_at", { ascending: false });
  return (data ?? []).map(shape);
}
