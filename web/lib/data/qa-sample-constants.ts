import type { AppRole } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";

/**
 * ค่าคงที่ของ "จุดเก็บตัวอย่าง (ตรวจ Finished product)" — Part C.4 ก้อน 3
 *
 * ⚠️ ไฟล์นี้ห้าม import อะไรที่ลาก `supabase/server` เข้ามา —
 *    quality-checks.tsx เป็น "use client" และดึงค่าจากไฟล์นี้เป็น value import
 *    (บทเรียน INPROCESS_STATUS_META ตอน Part C.3 ที่ทำ build ล้มทั้งระบบ)
 */

/** ผลตรวจ — ใช้ enum check_result เดิมใน DB (0024) ร่วมกับ inprocess_checks.result */
export const QA_SAMPLE_RESULT = [
  { key: "pass", label: "ผ่าน", color: "#16a34a" },
  { key: "fail", label: "ไม่ผ่าน", color: "#dc2626" },
] as const;

export type QaSampleResult = (typeof QA_SAMPLE_RESULT)[number]["key"];

export const QA_RESULT_META: Record<string, { label: string; color: string }> =
  Object.fromEntries(QA_SAMPLE_RESULT.map((r) => [r.key, r]));

/**
 * บันทึก / แก้ไข / ลบ จุดเก็บตัวอย่าง — ตรงกับ can_record_qa_sample() ใน DB (0066)
 * ทีมยืนยันว่าเป็นของ QA เท่านั้น (ผู้บริหาร/admin ทำแทนได้ตามแพทเทิร์นเดิมทั้งระบบ)
 */
export function canRecordQaSample(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["qa", "manager"]);
}
