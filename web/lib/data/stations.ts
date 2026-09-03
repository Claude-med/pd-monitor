import { createClient } from "@/lib/supabase/server";

export type Station = {
  id: string;
  code: string;
  name: string;
  seq: number;
  is_active: boolean;
  /** สถานีนี้คือขั้น "แพ็ค" (0081) — ใช้แยกช่อง "ผลิต" กับ "แพ็ค" บนแดชบอร์ด */
  is_packing: boolean;
};

/** สถานีย่อยทั้งหมด (เรียงตาม seq) — ใช้ทั้งหน้าจัดการ master + ตัวเลือก route */
export async function listStations(): Promise<Station[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stations")
    .select("id, code, name, seq, is_active, is_packing")
    .order("seq", { ascending: true });
  if (error || !data) return [];
  return data as Station[];
}

/** ขั้นตอนสถานีของงานหนึ่ง (snapshot จาก job_routes ตอนสร้างงาน) เรียงตาม step_no */
export type JobRouteStep = {
  station_id: string;
  code: string;
  name: string;
  step_no: number;
};

export async function getJobRoute(jobId: string): Promise<JobRouteStep[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_routes")
    .select(
      `station_id, step_no,
       station:stations!station_id ( code, name )`,
    )
    .eq("job_id", jobId)
    .order("step_no", { ascending: true });
  if (error || !data) return [];
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data as any[]).map((r) => {
    const s = Array.isArray(r.station) ? r.station[0] : r.station;
    return {
      station_id: r.station_id,
      code: s?.code ?? "",
      name: s?.name ?? "",
      step_no: r.step_no,
    };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
