import { createClient } from "@/lib/supabase/server";

export type InprocessCheck = {
  id: string;
  station_id: string | null;
  /** ชื่อสถานี (join stations) */
  station_name: string | null;
  job_route_id: string | null;
  /** แถวบันทึกผลผลิตที่ผลตรวจนี้ตรวจอยู่ (Part C.3 ก้อน 5) */
  production_record_id: string | null;
  param: string;
  value: string | null;
  unit: string | null;
  result: "pass" | "fail";
  checked_at: string;
  checker_name: string | null;
  note: string | null;
};

export type QaSample = {
  id: string;
  sample_point: string;
  qty: number | null;
  unit: string | null;
  collected_at: string;
  collector_name: string | null;
  note: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** ผลตรวจ QC ระหว่างผลิตของงาน (ใหม่สุดก่อน) */
export async function getInprocessChecks(jobId: string): Promise<InprocessCheck[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inprocess_checks")
    .select(
      `id, station_id, job_route_id, production_record_id, param, value, unit, result, checked_at, note,
       checker:profiles!checked_by ( full_name ),
       station:stations!station_id ( name )`,
    )
    .eq("job_id", jobId)
    .order("checked_at", { ascending: false });
  if (error || !data) return [];
  return (data as any[]).map((r) => ({
    id: r.id,
    station_id: r.station_id ?? null,
    station_name: one<any>(r.station)?.name ?? null,
    job_route_id: r.job_route_id ?? null,
    production_record_id: r.production_record_id ?? null,
    param: r.param,
    value: r.value,
    unit: r.unit,
    result: r.result,
    checked_at: r.checked_at,
    checker_name: one<any>(r.checker)?.full_name ?? null,
    note: r.note,
  }));
}

/** จุด/รอบเก็บตัวอย่าง QA ของงาน (ใหม่สุดก่อน) */
export async function getQaSamples(jobId: string): Promise<QaSample[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("qa_samples")
    .select(
      `id, sample_point, qty, unit, collected_at, note,
       collector:profiles!collected_by ( full_name )`,
    )
    .eq("job_id", jobId)
    .order("collected_at", { ascending: false });
  if (error || !data) return [];
  return (data as any[]).map((r) => ({
    id: r.id,
    sample_point: r.sample_point,
    qty: r.qty === null ? null : Number(r.qty),
    unit: r.unit,
    collected_at: r.collected_at,
    collector_name: one<any>(r.collector)?.full_name ?? null,
    note: r.note,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */
