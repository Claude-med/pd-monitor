import { createClient } from "@/lib/supabase/server";
import type { StationKey } from "@/lib/data/station-constants";

export type Station = {
  id: string;
  code: string;
  name: string;
  station_group: StationKey;
  seq: number;
  is_active: boolean;
};

/** สถานีย่อยทั้งหมด (เรียงตาม seq) — ใช้ทั้งหน้าจัดการ master + ตัวเลือก route */
export async function listStations(): Promise<Station[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stations")
    .select("id, code, name, station_group, seq, is_active")
    .order("seq", { ascending: true });
  if (error || !data) return [];
  return data as Station[];
}
