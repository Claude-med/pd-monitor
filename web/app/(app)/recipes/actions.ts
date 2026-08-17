"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import { canManageProducts } from "@/lib/data/role-access";

export type ActionResult = { ok?: boolean; id?: string; error?: string };

/** ผลลัพธ์ปุ่ม "ลบ" — RPC บอกกลับมาว่าลบจริงได้ หรือเปลี่ยนเป็นปิดใช้งานแทน */
export type DeleteResult = {
  ok?: boolean;
  action?: "deleted" | "deactivated";
  message?: string;
  error?: string;
};

/** จัดการผลิตภัณฑ์ = วางแผน/คลัง/ผู้บริหาร (ตรงกับ can_manage_products() ใน DB — 0044) */
async function requireProductManager(): Promise<boolean> {
  const profile = await getProfile();
  return !!profile && canManageProducts(profile.roles);
}

const NO_PRODUCT_PERM = "ไม่มีสิทธิ์ (เฉพาะฝ่ายวางแผน/ฝ่ายคลัง/ผู้บริหาร)";

/** จัดการสถานี/ขั้นตอนการผลิต = ผู้บริหาร (ตรงกับ can_manage_stations() ใน DB) */
async function requireManager(): Promise<boolean> {
  const profile = await getProfile();
  return !!profile && hasAnyRole(profile.roles, ["manager"]);
}

/** เพิ่ม/แก้ผลิตภัณฑ์ */
export async function upsertProduct(v: {
  id: string | null;
  code: string;
  name: string;
  unit: string;
  reg_no: string;
  dosage_form: string;
}): Promise<ActionResult> {
  if (!(await requireProductManager())) return { error: NO_PRODUCT_PERM };
  if (!v.code.trim()) return { error: "กรุณาระบุรหัสผลิตภัณฑ์" };
  if (!v.name.trim()) return { error: "กรุณาระบุชื่อผลิตภัณฑ์" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_product", {
    p_id: v.id,
    p_code: v.code.trim(),
    p_name: v.name.trim(),
    p_unit: v.unit.trim() || "TAB",
    p_reg_no: v.reg_no.trim() || null,
    p_dosage_form: v.dosage_form.trim() || null,
  });
  if (error) return { error: error.message || "บันทึกผลิตภัณฑ์ไม่สำเร็จ" };
  revalidatePath("/recipes");
  revalidatePath("/materials");
  return { ok: true, id: data as string };
}

/** เปิดใช้งานผลิตภัณฑ์ที่เคยปิดไป — ปุ่ม "กู้คืน" */
export async function setProductActive(
  productId: string,
  isActive: boolean,
): Promise<ActionResult> {
  if (!(await requireProductManager())) return { error: NO_PRODUCT_PERM };
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

/**
 * ปุ่ม "ลบ" ผลิตภัณฑ์ — RPC ลบจริงถ้ายังไม่มีใครใช้ · ติดแล้วปิดใช้งานให้อัตโนมัติ (0044)
 * ผลลัพธ์ที่คืนมาบอกว่าเกิดอะไรขึ้น เพื่อให้หน้าจอแจ้งผู้ใช้ได้ถูก
 */
export async function deleteProduct(productId: string): Promise<DeleteResult> {
  if (!(await requireProductManager())) return { error: NO_PRODUCT_PERM };
  if (!productId) return { error: "ไม่พบผลิตภัณฑ์" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_product", { p_id: productId });
  if (error) return { error: error.message || "ลบผลิตภัณฑ์ไม่สำเร็จ" };

  const res = (data ?? {}) as { action?: string; message?: string };
  revalidatePath("/recipes");
  revalidatePath("/materials");
  return {
    ok: true,
    action: res.action === "deleted" ? "deleted" : "deactivated",
    message: res.message ?? "ทำรายการแล้ว",
  };
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

/** เปิดใช้งานสถานีที่เคยปิดไป — ปุ่ม "กู้คืน" */
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

/** ปุ่ม "ลบ" สถานี — ลบจริงถ้ายังไม่มีประวัติการผลิตผูกอยู่ · ติดแล้วปิดใช้งานแทน (0044) */
export async function deleteStation(stationId: string): Promise<DeleteResult> {
  if (!(await requireManager()))
    return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร)" };
  if (!stationId) return { error: "ไม่พบสถานี" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_station", { p_id: stationId });
  if (error) return { error: error.message || "ลบสถานีไม่สำเร็จ" };

  const res = (data ?? {}) as { action?: string; message?: string };
  revalidatePath("/recipes");
  return {
    ok: true,
    action: res.action === "deleted" ? "deleted" : "deactivated",
    message: res.message ?? "ทำรายการแล้ว",
  };
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
