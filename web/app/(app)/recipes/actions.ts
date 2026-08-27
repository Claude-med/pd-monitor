"use server";

import { revalidatePath } from "next/cache";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getUser } from "@/lib/auth/dal";
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

/** 1 บรรทัดในลิสต์ "ลบไม่ได้เพราะ…" / "จะถูกลบตามไปด้วย…" */
export type DeleteImpact = { label: string; count: number; unit: string };

export type DeletePreview = {
  code?: string;
  name?: string;
  is_active?: boolean;
  can_delete?: boolean;
  blockers?: DeleteImpact[];
  cascades?: DeleteImpact[];
  error?: string;
};

/**
 * ดูก่อน "ลบถาวร" — แจกแจงว่าติดอะไร และอะไรจะหายตามไปด้วย (0050)
 * อ่านอย่างเดียว ไม่แก้ข้อมูล → เรียกได้ทุกคนที่จัดการผลิตภัณฑ์ได้
 */
export async function previewDeleteProduct(
  productId: string,
): Promise<DeletePreview> {
  if (!(await requireProductManager())) return { error: NO_PRODUCT_PERM };
  if (!productId) return { error: "ไม่พบผลิตภัณฑ์" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_delete_product", {
    p_id: productId,
  });
  if (error) return { error: error.message || "ดูข้อมูลก่อนลบไม่สำเร็จ" };
  return (data ?? {}) as DeletePreview;
}

/**
 * ลบผลิตภัณฑ์ถาวร — ผู้บริหารเท่านั้น + ยืนยันรหัสผ่านซ้ำ (กันลบผิดตัว)
 * DB (force_delete_product) เป็นด่านจริง: สิทธิ์ · ต้องปิดใช้งานอยู่ก่อน · นับ blocker ใหม่ตอนกด
 * การยืนยันรหัส = พิสูจน์ว่า "คนหน้าจอ = เจ้าของบัญชี" (แพตเทิร์นเดียวกับ deleteJob)
 */
export async function forceDeleteProduct(
  productId: string,
  password: string,
): Promise<DeleteResult> {
  const profile = await getProfile();
  if (!profile || !hasAnyRole(profile.roles, ["manager"]))
    return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร)" };
  if (!productId) return { error: "ไม่พบผลิตภัณฑ์" };
  if (!password.trim()) return { error: "กรุณากรอกรหัสผ่านเพื่อยืนยันการลบถาวร" };

  const user = await getUser();
  if (!user?.email) return { error: "ยังไม่ได้เข้าสู่ระบบ" };

  // ยืนยันรหัสผ่านด้วย client แยก (ไม่แตะ cookie/session ปัจจุบัน)
  const verifier = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { error: authError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (authError) return { error: "รหัสผ่านไม่ถูกต้อง — ลบถาวรไม่สำเร็จ" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("force_delete_product", {
    p_id: productId,
  });
  if (error) return { error: error.message || "ลบถาวรไม่สำเร็จ" };

  const res = (data ?? {}) as { message?: string };
  revalidatePath("/recipes");
  revalidatePath("/materials");
  return { ok: true, action: "deleted", message: res.message ?? "ลบถาวรแล้ว" };
}

/** เพิ่ม/แก้สถานีย่อย (master) */
export async function upsertStation(v: {
  id: string | null;
  code: string;
  name: string;
  seq: string;
  is_active: boolean;
}): Promise<ActionResult> {
  if (!(await requireManager()))
    return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร)" };
  if (!v.code.trim()) return { error: "กรุณาระบุรหัสสถานี" };
  if (!v.name.trim()) return { error: "กรุณาระบุชื่อสถานี" };

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
