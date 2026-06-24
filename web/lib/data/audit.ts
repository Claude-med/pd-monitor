import { createClient } from "@/lib/supabase/server";

export type AuditAction = "INSERT" | "UPDATE" | "DELETE";

export type AuditRow = {
  id: number;
  table_name: string;
  record_id: string | null;
  action: AuditAction;
  reason: string | null;
  changed_at: string;
  actor_name: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
};

/** ป้ายภาษาไทยของชื่อตาราง (fallback = ชื่อ raw) */
export const TABLE_LABEL: Record<string, string> = {
  profiles: "ผู้ใช้ / โปรไฟล์",
  user_roles: "สิทธิ์ผู้ใช้ (role)",
  products: "ผลิตภัณฑ์",
  orders: "ออเดอร์",
  batches: "ล็อต / แบตช์",
  jobs: "งานผลิต",
  production_records: "บันทึกผลผลิต",
  approvals: "ลายเซ็น QC / QA",
  machines: "เครื่องจักร",
  materials: "วัตถุดิบ",
  material_lots: "ล็อตวัตถุดิบ",
  material_requisitions: "ใบเบิกวัตถุดิบ",
  line_clearances: "Line Clearance",
};

/** ตารางที่มี audit trigger — ใช้เป็นตัวเลือกตัวกรอง */
export const AUDITED_TABLES = Object.keys(TABLE_LABEL);

export const ACTION_LABEL: Record<AuditAction, string> = {
  INSERT: "เพิ่ม",
  UPDATE: "แก้ไข",
  DELETE: "ลบ",
};

export const ACTION_COLOR: Record<AuditAction, string> = {
  INSERT: "#16a34a",
  UPDATE: "#0ea5e9",
  DELETE: "#ef4444",
};

const SELECT = `
  id, table_name, record_id, action, reason, changed_at, old_data, new_data,
  actor:profiles!changed_by ( full_name )
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function shape(r: any): AuditRow {
  const a = Array.isArray(r.actor) ? r.actor[0] : r.actor;
  return {
    id: r.id,
    table_name: r.table_name,
    record_id: r.record_id,
    action: r.action,
    reason: r.reason,
    changed_at: r.changed_at,
    actor_name: a?.full_name ?? null,
    old_data: r.old_data ?? null,
    new_data: r.new_data ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type AuditFilters = {
  table?: string;
  action?: AuditAction;
  limit?: number;
};

/**
 * ประวัติการเปลี่ยนแปลง (audit trail) — ใหม่สุดอยู่บน
 * RLS: อ่านได้เฉพาะ manager/qa/admin (ดู migration 0005)
 */
export async function getAuditLog(
  filters: AuditFilters = {},
): Promise<AuditRow[]> {
  const supabase = await createClient();
  let q = supabase
    .from("audit_log")
    .select(SELECT)
    .order("changed_at", { ascending: false })
    .limit(filters.limit ?? 200);

  if (filters.table && AUDITED_TABLES.includes(filters.table)) {
    q = q.eq("table_name", filters.table);
  }
  if (filters.action) {
    q = q.eq("action", filters.action);
  }

  const { data } = await q;
  return (data ?? []).map(shape);
}
