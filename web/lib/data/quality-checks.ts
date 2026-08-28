import { createClient } from "@/lib/supabase/server";
import type { InprocessStatus } from "@/lib/data/inprocess-constants";

export type { InprocessStatus };

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
  /** ใช้ได้ถึงวันที่ (Valid date) — null = ไม่กำหนดอายุ (Part C.3 ก้อน 6) */
  valid_date: string | null;
  /** สถานะอนุมัติจากหัวหน้า QC — pending จนกว่าจะมีคนอนุมัติ */
  status: InprocessStatus;
  approver_name: string | null;
  approved_at: string | null;
  approve_note: string | null;
  checked_at: string;
  checker_name: string | null;
  checked_by_id: string | null;
  note: string | null;
};

export type QaSample = {
  id: string;
  /** เลิกใช้ตั้งแต่ Part C.4 — null ในแถวใหม่ · แถวเก่ายังมีข้อความอยู่ (0066) */
  qty: number | null;
  unit: string | null;
  /** ผลตรวจ Finished product — null = แถวเก่าที่ยังไม่ได้ลงผล */
  result: "pass" | "fail" | null;
  /** วันเวลาที่เก็บ — Part C.4 ให้ QA กรอกเองได้ (เดิมเป็น now() เสมอ) */
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
      `id, station_id, job_route_id, production_record_id, param, value, unit, result,
       valid_date, status, approved_at, approve_note, checked_at, checked_by, note,
       checker:profiles!checked_by ( full_name ),
       approver:profiles!approved_by ( full_name ),
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
    valid_date: r.valid_date ?? null,
    status: (r.status ?? "pending") as InprocessStatus,
    approver_name: one<any>(r.approver)?.full_name ?? null,
    approved_at: r.approved_at ?? null,
    approve_note: r.approve_note ?? null,
    checked_at: r.checked_at,
    checked_by_id: r.checked_by ?? null,
    checker_name: one<any>(r.checker)?.full_name ?? null,
    note: r.note,
  }));
}

/** จุดเก็บตัวอย่าง (ตรวจ Finished product) ของงาน — ใหม่สุดก่อน · ไม่รวมแถวที่ถูกลบ */
export async function getQaSamples(jobId: string): Promise<QaSample[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("qa_samples")
    .select(
      `id, qty, unit, result, collected_at, note,
       collector:profiles!collected_by ( full_name )`,
    )
    .eq("job_id", jobId)
    // soft delete (0066) — RLS อ่านเป็น using(true) จึงต้องกรองแถวที่ถูกลบที่นี่
    .is("deleted_at", null)
    .order("collected_at", { ascending: false });
  if (error || !data) return [];
  return (data as any[]).map((r) => ({
    id: r.id,
    qty: r.qty === null ? null : Number(r.qty),
    unit: r.unit,
    result: r.result ?? null,
    collected_at: r.collected_at,
    collector_name: one<any>(r.collector)?.full_name ?? null,
    note: r.note,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */
