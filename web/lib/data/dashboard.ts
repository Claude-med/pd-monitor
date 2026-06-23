import { createClient } from "@/lib/supabase/server";
import { STATIONS, type StationKey } from "@/lib/data/station-constants";

/**
 * Data layer ของหน้าแดชบอร์ด (D7) — สรุป KPI + ต้นทุนค่าแรง (DL cost)
 * อ่านจากข้อมูลที่มีอยู่ (jobs + production_records ของ D5) ไม่ต้องเพิ่มตาราง
 */

/** อัตราค่าแรงตั้งต้น (บาท/ชั่วโมง) — ปรับได้ในหน้าแดชบอร์ด (ผู้บริหาร) */
export const DEFAULT_LABOR_RATE = 60;

export type StationAgg = {
  station: StationKey;
  hours: number;
  personHours: number; // ชม. × จำนวนคน (คน-ชม.) — A5
  output: number;
  loss: number;
};

export type DashboardData = {
  // snapshot ปัจจุบันของงานทั้งหมด (สถานะ = สถานะ ณ ตอนนี้ ไม่อิงช่วงวันที่)
  statusCounts: Record<string, number>;
  totalJobs: number;
  problemCount: number;
  // สรุปบันทึกผลผลิตในช่วงวันที่ [from, to]
  recordCount: number;
  totalInput: number;
  totalOutput: number;
  totalLoss: number;
  totalHours: number;
  totalPersonHours: number; // ชม. × คน รวม (ใช้คิดค่าแรง) — A5
  yieldPct: number | null; // output/input × 100 (null = ยังไม่มี input)
  byStation: StationAgg[];
};

/** สรุปข้อมูลแดชบอร์ดในช่วงวันที่ที่เลือก (from/to = YYYY-MM-DD รวมปลายทั้งสอง) */
export async function getDashboardData(
  from: string,
  to: string,
): Promise<DashboardData> {
  const supabase = await createClient();

  const [{ data: jobs }, { data: records }] = await Promise.all([
    supabase.from("jobs").select("status, problem"),
    supabase
      .from("production_records")
      .select("station, input_qty, output_qty, loss_qty, hours, headcount")
      .gte("record_date", from)
      .lte("record_date", to),
  ]);

  // นับงานตามสถานะ + งานติดปัญหา (ภาพรวมงานปัจจุบัน)
  const statusCounts: Record<string, number> = {};
  let problemCount = 0;
  for (const j of jobs ?? []) {
    statusCounts[j.status] = (statusCounts[j.status] ?? 0) + 1;
    if (j.problem) problemCount += 1;
  }

  // ตั้งทุกสถานีเป็น 0 ก่อน เพื่อให้ตารางครบทุกสถานีแม้ช่วงนั้นไม่มีบันทึก
  const stationMap = new Map<StationKey, StationAgg>(
    STATIONS.map((s) => [
      s.key,
      { station: s.key, hours: 0, personHours: 0, output: 0, loss: 0 },
    ]),
  );

  let totalInput = 0;
  let totalOutput = 0;
  let totalLoss = 0;
  let totalHours = 0;
  let totalPersonHours = 0;
  for (const r of records ?? []) {
    const hrs = r.hours ?? 0;
    const ph = hrs * (r.headcount ?? 1); // ไม่ระบุคน = คิด 1 คน
    totalInput += r.input_qty ?? 0;
    totalOutput += r.output_qty ?? 0;
    totalLoss += r.loss_qty ?? 0;
    totalHours += hrs;
    totalPersonHours += ph;
    const agg = stationMap.get(r.station as StationKey);
    if (agg) {
      agg.hours += hrs;
      agg.personHours += ph;
      agg.output += r.output_qty ?? 0;
      agg.loss += r.loss_qty ?? 0;
    }
  }

  return {
    statusCounts,
    totalJobs: jobs?.length ?? 0,
    problemCount,
    recordCount: records?.length ?? 0,
    totalInput,
    totalOutput,
    totalLoss,
    totalHours,
    totalPersonHours,
    yieldPct: totalInput > 0 ? (totalOutput / totalInput) * 100 : null,
    byStation: STATIONS.map((s) => stationMap.get(s.key)!),
  };
}
