import { createClient } from "@/lib/supabase/server";

/**
 * Data layer ของหน้าแดชบอร์ด (D7) — สรุป KPI + ต้นทุนค่าแรง (DL cost)
 * อ่านจากข้อมูลที่มีอยู่ (jobs + production_records ของ D5) ไม่ต้องเพิ่มตาราง
 */

/** อัตราค่าแรงตั้งต้น (บาท/ชั่วโมง) — ปรับได้ในหน้าแดชบอร์ด (ผู้บริหาร) */
export const DEFAULT_LABOR_RATE = 60;

export type StationAgg = {
  /** id ของสถานีจริง (Part C.3 ก้อน 2 — เดิมเป็นกลุ่มหลัก 4 ค่า) */
  stationId: string;
  stationName: string;
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

  const [{ data: jobs }, { data: records }, { data: stations }] =
    await Promise.all([
      supabase.from("jobs").select("status, problem"),
      supabase
        .from("production_records")
        .select("station_id, input_qty, output_qty, loss_qty, minutes, headcount")
        .gte("record_date", from)
        .lte("record_date", to),
      // ดึงสถานี "ทั้งหมด" รวมที่ปิดใช้งาน — บันทึกเก่าของสถานีที่ปิดไปแล้ว
      // ต้องยังนับรวมในตาราง ไม่งั้นยอดรายสถานีจะไม่เท่ายอดรวม
      supabase
        .from("stations")
        .select("id, name, seq, is_active")
        .order("seq", { ascending: true }),
    ]);

  // นับงานตามสถานะ + งานติดปัญหา (ภาพรวมงานปัจจุบัน)
  const statusCounts: Record<string, number> = {};
  let problemCount = 0;
  for (const j of jobs ?? []) {
    statusCounts[j.status] = (statusCounts[j.status] ?? 0) + 1;
    if (j.problem) problemCount += 1;
  }

  // ตั้งทุกสถานีเป็น 0 ก่อน เพื่อให้ตารางครบทุกสถานีแม้ช่วงนั้นไม่มีบันทึก
  const stationMap = new Map<string, StationAgg>(
    (stations ?? []).map((s) => [
      s.id as string,
      {
        stationId: s.id as string,
        stationName: s.name as string,
        hours: 0,
        personHours: 0,
        output: 0,
        loss: 0,
      },
    ]),
  );

  let totalInput = 0;
  let totalOutput = 0;
  let totalLoss = 0;
  let totalHours = 0;
  let totalPersonHours = 0;
  for (const r of records ?? []) {
    // 0063: DB เก็บเป็นนาที — ต้นทุนค่าแรงคิดเป็น ฿/ชม. จึงแปลงที่นี่
    const hrs = (r.minutes ?? 0) / 60;
    const ph = hrs * (r.headcount ?? 1); // ไม่ระบุคน = คิด 1 คน
    totalInput += r.input_qty ?? 0;
    totalOutput += r.output_qty ?? 0;
    totalLoss += r.loss_qty ?? 0;
    totalHours += hrs;
    totalPersonHours += ph;
    const agg = r.station_id ? stationMap.get(r.station_id as string) : null;
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
    // แสดงสถานีที่เปิดใช้งานทั้งหมด + สถานีที่ปิดไปแล้วแต่มีบันทึกในช่วงนี้
    // (เรียงตาม seq มาจาก query แล้ว — Map รักษาลำดับที่ใส่)
    byStation: (stations ?? [])
      .filter((s) => {
        const agg = stationMap.get(s.id as string)!;
        return s.is_active || agg.hours > 0 || agg.output > 0 || agg.loss > 0;
      })
      .map((s) => stationMap.get(s.id as string)!),
  };
}
