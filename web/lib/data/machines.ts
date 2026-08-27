import { createClient } from "@/lib/supabase/server";
import type { MachineStatus } from "@/lib/data/machine-constants";

export type Machine = {
  id: string;
  code: string;
  name: string;
  /** สถานีจริงที่เครื่องประจำอยู่ (FK stations) — Part C.3 ก้อน 1 */
  station_id: string | null;
  /** ชื่อสถานีสำหรับแสดงผล (join มาจาก stations) */
  station_name: string | null;
  room: string | null;
  status: MachineStatus;
  note: string | null;
  last_clean_date: string | null;
  next_maintenance_date: string | null;
  next_calibration_date: string | null;
  is_active: boolean;
};

const SELECT_COLS = `
  id, code, name, station_id, room, status, note,
  last_clean_date, next_maintenance_date, next_calibration_date, is_active,
  station:stations!station_id ( name )
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function shape(r: any): Machine {
  const st = one<any>(r.station);
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    station_id: r.station_id,
    station_name: st?.name ?? null,
    room: r.room,
    status: r.status,
    note: r.note,
    last_clean_date: r.last_clean_date,
    next_maintenance_date: r.next_maintenance_date,
    next_calibration_date: r.next_calibration_date,
    is_active: r.is_active,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** รายการเครื่องจักรทั้งหมด (เรียงตามรหัสเครื่อง) */
export async function listMachines(): Promise<Machine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("machines")
    .select(SELECT_COLS)
    .order("code", { ascending: true });
  // ต้องเช็ก error เสมอ — RLS ผิดจะตอบ [] แบบเงียบ แยกจาก "ไม่มีข้อมูล" ไม่ออก
  if (error || !data) return [];
  return data.map(shape);
}
