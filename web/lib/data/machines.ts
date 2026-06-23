import { createClient } from "@/lib/supabase/server";
import type { MachineStatus } from "@/lib/data/machine-constants";

export type Machine = {
  id: string;
  code: string;
  name: string;
  station: string | null;
  status: MachineStatus;
  note: string | null;
  last_clean_date: string | null;
  next_maintenance_date: string | null;
  next_calibration_date: string | null;
  is_active: boolean;
};

/** รายการเครื่องจักรทั้งหมด (เรียงตามรหัสเครื่อง) */
export async function listMachines(): Promise<Machine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("machines")
    .select(
      "id, code, name, station, status, note, last_clean_date, next_maintenance_date, next_calibration_date, is_active",
    )
    .order("code", { ascending: true });
  if (error || !data) return [];
  return data as Machine[];
}
