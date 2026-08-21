"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import {
  canEditJobMaterials,
  canSetJobMaterialStatus,
} from "@/lib/data/role-access";
import type { MaterialReadyStatus } from "@/lib/data/job-material-constants";

/**
 * Server actions ของ "เบิกวัตถุดิบ/บรรจุภัณฑ์" (Part C.2 · migration 0056)
 *
 * วางไว้ใน lib/actions/ ไม่ใช่ในโฟลเดอร์ route เพราะใช้ร่วมกัน 2 หน้า
 * (หน้ารายละเอียดงาน + หน้ารวมของฝ่ายคลัง) ผ่าน component ร่วมใน components/
 *
 * ⚠️ การเช็คสิทธิ์ที่นี่เป็นแค่ด่านแรกไว้ให้ error อ่านรู้เรื่อง —
 *    ด่านจริงอยู่ที่ RPC ใน DB (RLS ไม่มี policy เขียนเลย เขียนได้ทางเดียวคือผ่าน RPC)
 */

export type JobMaterialResult = { ok?: boolean; id?: string; error?: string };

export type JobMaterialValues = {
  id: string | null; // null = เพิ่มใหม่
  jobId: string;
  jobNo: string;
  itemName: string;
  itemType: string;
  qty: string; // มาจาก <input type="number"> จึงเป็น string เสมอ
  qtyUnit: string;
  note: string;
};

/** เพิ่ม/แก้รายการเบิก — ฝ่ายผลิต/ผู้บริหาร (แก้สถานะไม่ได้ RPC ไม่มีช่องให้ส่ง) */
export async function upsertJobMaterial(
  v: JobMaterialValues,
): Promise<JobMaterialResult> {
  const profile = await getProfile();
  if (!profile || !canEditJobMaterials(profile.roles))
    return { error: "ไม่มีสิทธิ์ (เฉพาะฝ่ายผลิต/ผู้บริหาร)" };

  const name = v.itemName.trim();
  if (!name) return { error: "กรุณาระบุชื่อวัตถุดิบ/บรรจุภัณฑ์" };

  // จำนวนเว้นว่างได้ (เช่น "แป้ง — ตามสูตร") แต่ถ้ากรอกต้องเป็นตัวเลขบวก
  let qty: number | null = null;
  const rawQty = v.qty.trim();
  if (rawQty !== "") {
    qty = Number(rawQty);
    if (!Number.isFinite(qty) || qty <= 0)
      return { error: "จำนวนที่เบิกต้องมากกว่า 0 (หรือเว้นว่างไว้)" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_job_material", {
    p_id: v.id,
    p_job_id: v.jobId,
    p_item_name: name,
    p_item_type: v.itemType,
    p_qty: qty,
    p_qty_unit: v.qtyUnit.trim() || null,
    p_note: v.note.trim() || null,
  });
  if (error) return { error: error.message || "บันทึกรายการเบิกไม่สำเร็จ" };

  revalidateBoth(v.jobNo);
  return { ok: true, id: data as string };
}

/**
 * กดสถานะ พร้อม/ไม่พร้อม — ฝ่ายคลัง/ผู้บริหาร
 *
 * ⚠️ ห้ามใช้ upsertJobMaterial เปลี่ยนสถานะ — ตัวนั้นเขียนชื่อ/จำนวน/หมายเหตุทับด้วย
 *    ถ้าหน้าจอถือ snapshot เก่าอยู่จะทับข้อมูลที่ฝ่ายผลิตเพิ่งแก้ (บทเรียน 0052)
 */
export async function setJobMaterialStatus(
  id: string,
  jobNo: string,
  status: MaterialReadyStatus,
): Promise<JobMaterialResult> {
  const profile = await getProfile();
  if (!profile || !canSetJobMaterialStatus(profile.roles))
    return { error: "ไม่มีสิทธิ์ (เฉพาะฝ่ายคลัง/ผู้บริหาร)" };
  if (!id) return { error: "ไม่พบรายการเบิกที่เลือก" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_job_material_status", {
    p_id: id,
    p_status: status,
  });
  if (error) return { error: error.message || "เปลี่ยนสถานะไม่สำเร็จ" };

  revalidateBoth(jobNo);
  return { ok: true };
}

/** ลบรายการเบิก — ฝ่ายผลิต/ผู้บริหาร (ฝ่ายคลังลบไม่ได้) */
export async function deleteJobMaterial(
  id: string,
  jobNo: string,
): Promise<JobMaterialResult> {
  const profile = await getProfile();
  if (!profile || !canEditJobMaterials(profile.roles))
    return { error: "ไม่มีสิทธิ์ (เฉพาะฝ่ายผลิต/ผู้บริหาร)" };
  if (!id) return { error: "ไม่พบรายการเบิกที่เลือก" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_job_material", { p_id: id });
  if (error) return { error: error.message || "ลบรายการเบิกไม่สำเร็จ" };

  revalidateBoth(jobNo);
  return { ok: true };
}

/** รายการเบิกโผล่ 2 หน้า — ต้อง revalidate ทั้งคู่ ไม่งั้นอีกหน้าค้างข้อมูลเก่า */
function revalidateBoth(jobNo: string) {
  revalidatePath("/job-materials");
  if (jobNo) revalidatePath(`/board/${jobNo}`);
}
