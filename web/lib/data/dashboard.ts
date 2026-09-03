import { createClient } from "@/lib/supabase/server";

/**
 * Data layer ของหน้าแดชบอร์ด (D7) — Pending Order + KPI ผลผลิต + ต้นทุนค่าแรง (DL cost)
 *
 * 🚨 การนับทั้งหมดอยู่ที่ DB (0081) ไม่ใช่ที่นี่
 *    เวอร์ชันเดิมดึง "ทุกแถว" ของ jobs + production_records มานับใน JS โดยไม่มี limit
 *    → พอข้อมูลเกินเพดาน max-rows ของ PostgREST (1,000) ตัวเลขจะขาดหายเงียบ ๆ ไม่มี error
 *    ตอนนี้เรียก RPC ที่คืนมาแค่แถวสรุป จึงไม่มีเพดานและเร็วกว่ามาก
 */

/** อัตราค่าแรงตั้งต้น (บาท/ชั่วโมง) — ปรับได้ในหน้าแดชบอร์ด (ผู้บริหาร) */
export const DEFAULT_LABOR_RATE = 60;

/** คีย์ของแถวสถานีที่ไม่ได้ผูกสถานี (station_id เป็น null) — ใช้เป็น React key เท่านั้น */
export const NO_STATION_KEY = "__no_station__";

export type StationAgg = {
  /** id ของสถานีจริง (Part C.3 ก้อน 2 — เดิมเป็นกลุ่มหลัก 4 ค่า) · NO_STATION_KEY = ไม่ระบุสถานี */
  stationId: string;
  stationName: string;
  hours: number;
  personHours: number; // ชม. × จำนวนคน (คน-ชม.) — A5
  output: number;
  loss: number;
};

/**
 * จำนวนงานแต่ละช่องบนแดชบอร์ด — นิยามอยู่ใน 0081 (ห้ามคำนวณซ้ำที่อื่น)
 *
 *   Pending Order = Plan + WIP
 *   ├─ Plan : unplan · pendingAnnounce · planned
 *   └─ WIP  : producing · packing · qc · qa · awaitingFg
 *   นอก Pending : inStock (เข้าคลังแล้ว = จบจริง)
 *
 * ทุกช่องแยกกันเด็ดขาด ⇒ ผลรวม 9 ช่อง = totalJobs เสมอ
 */
export type PendingOrderCounts = {
  // Plan
  unplan: number; // รอแจ้งผลิต + ยังไม่ระบุเดือนแผน
  pendingAnnounce: number; // รอแจ้งผลิต + ลงเดือนแผนแล้ว
  planned: number;
  // WIP
  producing: number;
  packing: number; // บันทึกผลผลิตล่าสุดอยู่สถานีที่ติดธง "สถานีบรรจุ"
  qc: number;
  qa: number;
  awaitingFg: number; // QA ปล่อยผ่านแล้ว แต่คลังยังไม่รับเข้า
  // จบแล้ว (ไม่นับใน Pending Order)
  inStock: number;
  // ยอดรวมที่ derive จากข้างบน
  plan: number;
  wip: number;
  pending: number;
};

export type DashboardData = {
  /**
   * ข้อความ error ที่ต้องขึ้นแถบเตือนบนหน้า (null = ปกติ)
   * เคสหลักคือ "ยังไม่ได้ paste migration 0081" — โค้ดขึ้นเว็บก่อน SQL เข้าเสมอ
   * ⚠️ ห้ามกลืน error เงียบแล้วโชว์ 0 ทุกช่อง — ผู้บริหารจะเข้าใจผิดว่าโรงงานไม่มีงาน
   */
  loadError: string | null;
  // snapshot ปัจจุบันของงานทั้งหมด (ไม่อิงช่วงวันที่)
  counts: PendingOrderCounts;
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

/** แถวที่ dashboard_job_counts() คืนมา (0081) */
type JobCountsRow = {
  unplan: number;
  pending_announce: number;
  planned: number;
  producing: number;
  packing: number;
  qc: number;
  qa: number;
  awaiting_fg: number;
  in_stock: number;
  problem: number;
  total: number;
};

/** แถวที่ dashboard_production_summary() คืนมา (0081) — หนึ่งแถวต่อสถานี */
type ProductionSummaryRow = {
  station_id: string | null;
  station_name: string;
  seq: number;
  is_active: boolean;
  minutes: number | string;
  person_minutes: number | string;
  input_qty: number | string;
  output_qty: number | string;
  loss_qty: number | string;
  record_count: number;
};

const EMPTY_COUNTS: PendingOrderCounts = {
  unplan: 0,
  pendingAnnounce: 0,
  planned: 0,
  producing: 0,
  packing: 0,
  qc: 0,
  qa: 0,
  awaitingFg: 0,
  inStock: 0,
  plan: 0,
  wip: 0,
  pending: 0,
};

/** numeric ของ Postgres มาถึง JS เป็น string ได้ — บังคับเป็นเลขทุกครั้ง */
function num(v: number | string | null | undefined): number {
  const n = typeof v === "string" ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** สรุปข้อมูลแดชบอร์ดในช่วงวันที่ที่เลือก (from/to = YYYY-MM-DD รวมปลายทั้งสอง) */
export async function getDashboardData(
  from: string,
  to: string,
): Promise<DashboardData> {
  const supabase = await createClient();

  const [{ data: countsData, error: countsErr }, { data: sumData, error: sumErr }] =
    await Promise.all([
      supabase.rpc("dashboard_job_counts"),
      supabase.rpc("dashboard_production_summary", { p_from: from, p_to: to }),
    ]);

  // ต้องเช็ก error เสมอ — RPC/RLS พังจะตอบ [] แบบเงียบ แยกจาก "ไม่มีข้อมูล" ไม่ออก
  // (บทเรียนเดียวกับ job-routes.ts:85) · ที่นี่ไม่ throw เพราะนี่คือหน้าแรกหลังล็อกอิน
  // ถ้าโค้ดขึ้นเว็บก่อน paste 0081 ทั้งแอปจะเปิดไม่ได้ → เลือกขึ้นแถบเตือนแทน
  const loadError =
    countsErr?.message || sumErr?.message
      ? `โหลดตัวเลขไม่สำเร็จ: ${countsErr?.message ?? sumErr?.message}` +
        ` (ถ้าเพิ่งขึ้นเว็บใหม่ ตรวจว่ารัน migration 0081 ใน Supabase แล้วหรือยัง)`
      : null;

  // RPC ที่ returns table คืนมาเป็น array — แถวเดียว
  const c = (Array.isArray(countsData) ? countsData[0] : countsData) as
    | JobCountsRow
    | undefined;

  const counts: PendingOrderCounts = c
    ? {
        unplan: c.unplan,
        pendingAnnounce: c.pending_announce,
        planned: c.planned,
        producing: c.producing,
        packing: c.packing,
        qc: c.qc,
        qa: c.qa,
        awaitingFg: c.awaiting_fg,
        inStock: c.in_stock,
        plan: c.unplan + c.pending_announce + c.planned,
        wip: c.producing + c.packing + c.qc + c.qa + c.awaiting_fg,
        pending:
          c.unplan +
          c.pending_announce +
          c.planned +
          c.producing +
          c.packing +
          c.qc +
          c.qa +
          c.awaiting_fg,
      }
    : EMPTY_COUNTS;

  const rows = (sumData ?? []) as ProductionSummaryRow[];

  let recordCount = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalLoss = 0;
  let totalMinutes = 0;
  let totalPersonMinutes = 0;
  for (const r of rows) {
    recordCount += r.record_count;
    totalInput += num(r.input_qty);
    totalOutput += num(r.output_qty);
    totalLoss += num(r.loss_qty);
    totalMinutes += num(r.minutes);
    totalPersonMinutes += num(r.person_minutes);
  }

  // 0063: DB เก็บเป็นนาที — ต้นทุนค่าแรงคิดเป็น ฿/ชม. จึงแปลงที่นี่
  const totalHours = totalMinutes / 60;
  const totalPersonHours = totalPersonMinutes / 60;

  return {
    loadError,
    counts,
    totalJobs: c?.total ?? 0,
    problemCount: c?.problem ?? 0,
    recordCount,
    totalInput,
    totalOutput,
    totalLoss,
    totalHours,
    totalPersonHours,
    yieldPct: totalInput > 0 ? (totalOutput / totalInput) * 100 : null,
    // แสดงสถานีที่เปิดใช้งานทั้งหมด + สถานีที่ปิดไปแล้วแต่มีบันทึกในช่วงนี้
    // (เรียงตาม seq มาจาก RPC แล้ว)
    byStation: rows
      .filter(
        (r) =>
          r.is_active ||
          num(r.minutes) > 0 ||
          num(r.output_qty) > 0 ||
          num(r.loss_qty) > 0 ||
          r.record_count > 0,
      )
      .map((r) => ({
        stationId: r.station_id ?? NO_STATION_KEY,
        stationName: r.station_name,
        hours: num(r.minutes) / 60,
        personHours: num(r.person_minutes) / 60,
        output: num(r.output_qty),
        loss: num(r.loss_qty),
      })),
  };
}
