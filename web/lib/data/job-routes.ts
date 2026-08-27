import { createClient } from "@/lib/supabase/server";

/**
 * ขั้นตอนการผลิต (route) ของงาน + เครื่องจักรที่ผูกไว้ + ตัวนับสำหรับป้ายบนแท็บ
 * — Part C.3 ก้อน 3: หน้ารายละเอียดงานแบ่งเป็นแท็บตามขั้นตอน
 *
 * ต่างจาก getJobRoute() ใน lib/data/stations.ts ตรงที่คืน `id` ของแถว job_routes มาด้วย
 * (getJobRoute คืนแค่ station_id — ใช้ทำ dropdown เฉย ๆ) · ที่นี่ต้องใช้ job_routes.id
 * เป็นคีย์ของแท็บและของ job_route_machines เพราะ route ที่เดินสถานีเดิมซ้ำต้องแยกกันได้
 */

export type RouteMachine = {
  /** id ของแถว job_route_machines (ใช้ตอนถอดออก) */
  id: string;
  machine_id: string;
  code: string;
  name: string;
  room: string | null;
  status: string;
  last_clean_date: string | null;
  next_maintenance_date: string | null;
  next_calibration_date: string | null;
  note: string | null;
};

export type JobRouteStepFull = {
  /** job_routes.id — คีย์ของแท็บ */
  id: string;
  station_id: string;
  station_code: string;
  station_name: string;
  step_no: number;
  machines: RouteMachine[];
  /** ผลตรวจ in-process ของสถานีนี้ที่ "ไม่ผ่าน" — ขึ้นป้ายแดงบนแท็บ */
  failCount: number;
  /** จำนวนบันทึกผลผลิตของสถานีนี้ */
  recordCount: number;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/**
 * ขั้นตอนทั้งหมดของงาน เรียงตาม step_no
 *
 * ⚠️ ตัวนับคิดจาก station_id ไม่ใช่ job_route_id เพราะ production_records /
 *    inprocess_checks ยังผูกกับ station_id อยู่ (ก้อน 5–6 จะเพิ่ม job_route_id)
 *    ผลคือ route ที่เดินสถานีเดิมซ้ำ ตัวนับของ 2 ขั้นตอนนั้นจะเท่ากันไปก่อน
 */
export async function getJobRouteSteps(
  jobId: string,
): Promise<JobRouteStepFull[]> {
  const supabase = await createClient();

  // query เดียวได้ทั้ง route + เครื่องจักร (embed ซ้อน) — ห้ามวนลูปยิงทีละขั้นตอน (N+1)
  const [{ data: routes, error: routeErr }, { data: checks }, { data: recs }] =
    await Promise.all([
      supabase
        .from("job_routes")
        .select(
          `id, station_id, step_no,
           station:stations!station_id ( code, name ),
           machines:job_route_machines (
             id, machine_id, note,
             machine:machines!machine_id (
               code, name, room, status,
               last_clean_date, next_maintenance_date, next_calibration_date
             )
           )`,
        )
        .eq("job_id", jobId)
        .order("step_no", { ascending: true }),
      supabase
        .from("inprocess_checks")
        .select("station_id, result")
        .eq("job_id", jobId),
      supabase
        .from("production_records")
        .select("station_id")
        .eq("job_id", jobId),
    ]);
  // ต้องเช็ก error เสมอ — RLS ผิดจะตอบ [] แบบเงียบ แยกจาก "ไม่มีข้อมูล" ไม่ออก
  if (routeErr || !routes) return [];

  const failByStation = new Map<string, number>();
  for (const c of (checks ?? []) as any[]) {
    if (c.result !== "fail" || !c.station_id) continue;
    failByStation.set(c.station_id, (failByStation.get(c.station_id) ?? 0) + 1);
  }
  const recByStation = new Map<string, number>();
  for (const r of (recs ?? []) as any[]) {
    if (!r.station_id) continue;
    recByStation.set(r.station_id, (recByStation.get(r.station_id) ?? 0) + 1);
  }

  return (routes as any[]).map((r) => {
    const st = one<any>(r.station);
    return {
      id: r.id,
      station_id: r.station_id,
      station_code: st?.code ?? "",
      station_name: st?.name ?? "",
      step_no: r.step_no,
      machines: ((r.machines ?? []) as any[])
        .map((m) => {
          const mc = one<any>(m.machine);
          return {
            id: m.id,
            machine_id: m.machine_id,
            code: mc?.code ?? "",
            name: mc?.name ?? "",
            room: mc?.room ?? null,
            status: mc?.status ?? "available",
            last_clean_date: mc?.last_clean_date ?? null,
            next_maintenance_date: mc?.next_maintenance_date ?? null,
            next_calibration_date: mc?.next_calibration_date ?? null,
            note: m.note ?? null,
          };
        })
        .sort((a, b) => a.code.localeCompare(b.code)),
      failCount: failByStation.get(r.station_id) ?? 0,
      recordCount: recByStation.get(r.station_id) ?? 0,
    };
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
