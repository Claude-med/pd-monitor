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
