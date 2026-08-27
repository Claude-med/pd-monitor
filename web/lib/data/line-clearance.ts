import { createClient } from "@/lib/supabase/server";

/**
 * Line Clearance — Part C.3 ก้อน 4: แยก "ต่อขั้นตอน × ต่อเครื่องจักร"
 * ของเดิมเป็น 1 ใบต่องาน (unique job_id) ทำครั้งเดียวจบ ซึ่งไม่ตรงหน้างานจริง
 * ที่ต้องเคลียร์ไลน์ใหม่ทุก stage และทุกเครื่อง
 */
export type LineClearance = {
  id: string;
  job_route_id: string;
  machine_id: string;
  cleared_old: boolean;
  cleaned: boolean;
  setup_done: boolean;
  setup_minutes: number | null;
  /** เวลาที่เคลียร์ของเก่า (HH:MM) */
  cleared_old_time: string | null;
  /** เวลาที่ทำความสะอาดเสร็จ (HH:MM) */
  cleaned_time: string | null;
  room: string | null;
  headcount: number | null;
  note: string | null;
  performed_by_id: string | null;
  performed_by_name: string | null;
  performed_at: string | null;
  checked_by_id: string | null;
  checked_by_name: string | null;
  checked_at: string | null;
  /** ผ่านแล้ว = ติ๊กอย่างน้อย 1 ข้อ + หัวหน้าฝ่ายผลิตยืนยัน (ตรงกับ line_clearance_passed ใน DB) */
  passed: boolean;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function first(x: any): any {
  return Array.isArray(x) ? x[0] : x;
}

/** ตัด "14:30:00" → "14:30" (input type=time ต้องการรูปแบบนี้) */
function hhmm(t: string | null): string | null {
  return t ? t.slice(0, 5) : null;
}

/** Line Clearance ทุกใบของงานหนึ่ง (ทุกขั้นตอน ทุกเครื่อง) */
export async function getLineClearances(
  jobId: string,
): Promise<LineClearance[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("line_clearances")
    .select(
      `id, job_route_id, machine_id,
       cleared_old, cleaned, setup_done, setup_minutes,
       cleared_old_time, cleaned_time, room, headcount, note,
       performed_by, performed_at, checked_by, checked_at,
       performer:profiles!performed_by ( full_name ),
       checker:profiles!checked_by ( full_name )`,
    )
    .eq("job_id", jobId);
  // ต้องเช็ก error เสมอ — RLS ผิดจะตอบ [] แบบเงียบ แยกจาก "ไม่มีข้อมูล" ไม่ออก
  if (error || !data) return [];

  return (data as any[]).map((d) => {
    const performer = first(d.performer);
    const checker = first(d.checker);
    return {
      id: d.id,
      job_route_id: d.job_route_id,
      machine_id: d.machine_id,
      cleared_old: d.cleared_old,
      cleaned: d.cleaned,
      setup_done: d.setup_done,
      setup_minutes: d.setup_minutes,
      cleared_old_time: hhmm(d.cleared_old_time),
      cleaned_time: hhmm(d.cleaned_time),
      room: d.room ?? null,
      headcount: d.headcount ?? null,
      note: d.note,
      performed_by_id: d.performed_by ?? null,
      performed_by_name: performer?.full_name ?? null,
      performed_at: d.performed_at,
      checked_by_id: d.checked_by ?? null,
      checked_by_name: checker?.full_name ?? null,
      checked_at: d.checked_at,
      passed:
        !!d.checked_by && (d.cleared_old || d.cleaned || d.setup_done),
    };
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
