import { createClient } from "@/lib/supabase/server";

/**
 * ทะเบียนบริษัท (Part D · 0071)
 *
 * โรงงานเดินงานให้ 2 บริษัท และ **เดินเลข Job No. แยกชุดกัน** —
 * UMEDA กับ POUND มีเลข 690001 ได้พร้อมกัน
 *
 * วิธีที่ระบบใช้: `jobs.job_no` เก็บ **อักษรนำของบริษัท** ไว้ข้างหน้า (`P690001`)
 * เพื่อให้คอลัมน์ยัง unique และ URL `/board/<job_no>` ใช้ได้เหมือนเดิม
 * ส่วนหน้าจอตัดอักษรนำทิ้งด้วย `displayJobNo()` แล้วโชว์ป้ายบริษัทกำกับแทน
 */
export type CompanyOption = {
  id: string;
  code: string;
  name: string;
  /** อักษรนำหน้าเลขงานใน DB — UMEDA = "" · POUND = "P" */
  job_no_prefix: string;
  /** true = ฟอร์มสร้างงานต้องโชว์ช่อง "หมายเหตุ" (POUND) */
  requires_note: boolean;
  /** เลขตั้งต้นของ running 4 หลักเมื่อขึ้นปี พ.ศ. ใหม่ */
  year_start_seq: number;
};

const SELECT = "id, code, name, job_no_prefix, requires_note, year_start_seq";

/** บริษัทที่เปิดใช้งาน — สำหรับ dropdown หน้าสร้างงาน */
export async function listCompanies(): Promise<CompanyOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("companies")
    .select(SELECT)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  return (data ?? []) as CompanyOption[];
}

export type CompanyJobNoConfig = CompanyOption & {
  /** ปี พ.ศ. 2 หลักที่ระบบกำลังออกเลขอยู่ */
  year_be: number;
  /** เลขใบถัดไปที่จะออก (running 4 หลัก) ของปีนั้น */
  next_seq: number;
};

/** ปี พ.ศ. 2 หลักตามเวลาไทย — ต้องตรงกับที่ next_job_nos() คำนวณใน DB */
export function currentYearBe(): number {
  const y = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
    }).format(new Date()),
  );
  return (y + 543) % 100;
}

/**
 * บริษัท + เลขถัดไปของปีปัจจุบัน — สำหรับหน้า admin ตั้งค่าเลขงาน
 * (`job_no_counters` มี policy ให้ผู้ใช้ที่ล็อกอินอ่านได้ — 0048)
 */
export async function listJobNoConfig(): Promise<CompanyJobNoConfig[]> {
  const supabase = await createClient();
  const yearBe = currentYearBe();

  const [{ data: rows }, { data: counters }] = await Promise.all([
    supabase
      .from("companies")
      .select(SELECT)
      .order("sort_order", { ascending: true }),
    supabase
      .from("job_no_counters")
      .select("company_id, last_seq")
      .eq("year_be", yearBe),
  ]);

  const last = new Map<string, number>();
  for (const c of (counters ?? []) as {
    company_id: string;
    last_seq: number;
  }[]) {
    last.set(c.company_id, c.last_seq);
  }

  return ((rows ?? []) as CompanyOption[]).map((c) => ({
    ...c,
    year_be: yearBe,
    // ยังไม่มีแถวตัวนับ = ปีนี้ยังไม่ออกเลขเลย → ใบแรกจะเริ่มที่ year_start_seq
    next_seq: last.has(c.id) ? last.get(c.id)! + 1 : c.year_start_seq,
  }));
}
