"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok?: boolean; error?: string };

/** ทำเครื่องหมายอ่านแล้ว 1 รายการ */
export async function markRead(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
  if (error) return { error: error.message || "ทำเครื่องหมายไม่สำเร็จ" };
  revalidatePath("/inbox");
  return { ok: true };
}

/** ทำเครื่องหมายอ่านทั้งหมด */
export async function markAllRead(): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_all_notifications_read");
  if (error) return { error: error.message || "ทำเครื่องหมายไม่สำเร็จ" };
  revalidatePath("/inbox");
  return { ok: true };
}

/**
 * ลบแจ้งเตือนที่เลือกไว้ (Part F)
 *
 * 🔑 "ลบ" ที่นี่คือ **ซ่อนเฉพาะของผู้ใช้คนนี้** — ใบเดียวกันจ่าหน้าถึงทั้งฝ่าย
 *    คนอื่นที่ได้รับใบนั้นยังเห็นอยู่ (ด่านจริงอยู่ที่ dismiss_notifications() · 0091)
 * ⚠️ ส่งเฉพาะ id ของรายการ source === "stored" เท่านั้น —
 *    รายการ derived (overdue-<uuid> / stuck-<uuid>) ไม่ใช่แถวจริงในตาราง
 */
export async function dismissMany(
  ids: string[],
): Promise<ActionResult & { dismissed?: number }> {
  const clean = [...new Set((ids ?? []).filter(Boolean))];
  if (clean.length === 0) return { error: "ยังไม่ได้เลือกรายการ" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dismiss_notifications", {
    p_ids: clean,
  });
  if (error) return { error: error.message || "ลบแจ้งเตือนไม่สำเร็จ" };
  revalidatePath("/inbox");
  return { ok: true, dismissed: Number((data as { dismissed?: number } | null)?.dismissed ?? 0) };
}
