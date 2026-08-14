"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import { canPlanJobs } from "@/lib/data/role-access";

export type ActionResult = { ok?: boolean; id?: string; error?: string };

/** จัดการผลิตภัณฑ์ = ฝ่ายวางแผน/ผู้บริหาร (ตรงกับ can_plan_jobs() ใน DB) */
async function requirePlanner(): Promise<boolean> {
  const profile = await getProfile();
  return !!profile && canPlanJobs(profile.roles);
}

/** จัดการสถานี/ขั้นตอนการผลิต = ผู้บริหาร (ตรงกับ can_manage_stations() ใน DB) */
async function requireManager(): Promise<boolean> {
  const profile = await getProfile();
  return !!profile && hasAnyRole(profile.roles, ["manager"]);
}

/** เพิ่ม/แก้ผลิตภัณฑ์ (ยา · วัตถุดิบ · บรรจุภัณฑ์) */
export async function upsertProduct(v: {
  id: string | null;
  code: string;
  name: string;
  type: string;
  unit: string;
  reg_no: string;
  dosage_form: string;
}): Promise<ActionResult> {
  if (!(await requirePlanner()))
    return { error: "ไม่มีสิทธิ์ (เฉพาะฝ่ายวางแผน/ผู้บริหาร)" };
  if (!v.code.trim()) return { error: "กรุณาระบุรหัสผลิตภัณฑ์" };
  if (!v.name.trim()) return { error: "กรุณาระบุชื่อผลิตภัณฑ์" };
  if (!["fg", "rm", "pm"].includes(v.type))
    return { error: "กรุณาเลือกประเภทผลิตภัณฑ์" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_product", {
    p_id: v.id,
    p_code: v.code.trim(),
    p_name: v.name.trim(),
    p_type: v.type,
    p_unit: v.unit.trim() || "TAB",
    p_reg_no: v.reg_no.trim() || null,
    p_dosage_form: v.dosage_form.trim() || null,
  });
  if (error) return { error: error.message || "บันทึกผลิตภัณฑ์ไม่สำเร็จ" };
  revalidatePath("/recipes");
  revalidatePath("/materials");
  return { ok: true, id: data as string };
}

/** ปิด/เปิดใช้งานผลิตภัณฑ์ — ปุ่ม "ลบ" ใช้ตัวนี้ (ลบจริงไม่ได้ ประวัติ GMP ผูกอยู่) */
export async function setProductActive(
  productId: string,
  isActive: boolean,
): Promise<ActionResult> {
  if (!(await requirePlanner()))
    return { error: "ไม่มีสิทธิ์ (เฉพาะฝ่ายวางแผน/ผู้บริหาร)" };
  if (!productId) return { error: "ไม่พบผลิตภัณฑ์" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_product_active", {
    p_id: productId,
    p_is_active: isActive,
  });
  if (error) return { error: error.message || "เปลี่ยนสถานะไม่สำเร็จ" };
  revalidatePath("/recipes");
  revalidatePath("/materials");
  return { ok: true };
}

/** เพิ่ม/แก้สถานีย่อย (master) */
export async function upsertStation(v: {
  id: string | null;
  code: string;
  name: string;
  station_group: string;
  seq: string;
  is_active: boolean;
}): Promise<ActionResult> {
  if (!(await requireManager()))
    return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร)" };
  if (!v.code.trim()) return { error: "กรุณาระบุรหัสสถานี" };
  if (!v.name.trim()) return { error: "กรุณาระบุชื่อสถานี" };
  if (!v.station_group) return { error: "กรุณาเลือกกลุ่มสถานี" };

  let seq = 100;
  if (v.seq.trim() !== "") {
    seq = Number(v.seq);
    if (!Number.isInteger(seq)) return { error: "ลำดับต้องเป็นจำนวนเต็ม" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_station", {
    p_id: v.id,
    p_code: v.code.trim(),
    p_name: v.name.trim(),
    p_group: v.station_group,
    p_seq: seq,
    p_is_active: v.is_active,
  });
  if (error) return { error: error.message || "บันทึกสถานีไม่สำเร็จ" };
  revalidatePath("/recipes");
  return { ok: true, id: data as string };
}

/** ปิด/เปิดใช้งานสถานี — ปุ่ม "ลบ" ใช้ตัวนี้ (ประวัติการผลิตผูกอยู่ ลบจริงไม่ได้) */
export async function setStationActive(
  stationId: string,
  isActive: boolean,
): Promise<ActionResult> {
  if (!(await requireManager()))
    return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร)" };
  if (!stationId) return { error: "ไม่พบสถานี" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_station_active", {
    p_id: stationId,
    p_is_active: isActive,
  });
  if (error) return { error: error.message || "เปลี่ยนสถานะไม่สำเร็จ" };
  revalidatePath("/recipes");
  return { ok: true };
}

/** แทนที่ลำดับสถานีของผลิตภัณฑ์ (route) ทั้งชุด */
export async function setProductRoute(
  productId: string,
  items: { station_id: string; note: string }[],
): Promise<ActionResult> {
  if (!(await requireManager()))
    return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร)" };
  if (!productId) return { error: "ไม่พบผลิตภัณฑ์" };

  const payload: { station_id: string; note?: string }[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it.station_id) continue; // ข้ามแถวว่าง
    if (seen.has(it.station_id))
      return { error: "มีสถานีซ้ำกันในลำดับ — สถานีหนึ่งใส่ได้ครั้งเดียว" };
    seen.add(it.station_id);
    payload.push({ station_id: it.station_id, note: it.note.trim() || undefined });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_product_route", {
    p_product_id: productId,
    p_items: payload,
  });
  if (error) return { error: error.message || "บันทึกลำดับสถานีไม่สำเร็จ" };
  revalidatePath("/recipes");
  return { ok: true };
}
