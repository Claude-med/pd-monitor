import Link from "next/link";
import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import {
  getAuditLog,
  TABLE_LABEL,
  AUDITED_TABLES,
  ACTION_LABEL,
  ACTION_COLOR,
  type AuditAction,
} from "@/lib/data/audit";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "ประวัติ / Audit — PD Monitor" };

const ACTIONS: AuditAction[] = ["INSERT", "UPDATE", "DELETE"];
const PAGE_SIZE = 30;

function tableLabel(t: string): string {
  return TABLE_LABEL[t] ?? t;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; action?: string; page?: string }>;
}) {
  const profile = await getProfile();
  const roles = profile?.roles ?? [];

  if (!hasAnyRole(roles, ["manager", "qa"])) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 text-2xl font-bold tracking-tight">ประวัติ / Audit</h1>
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          เฉพาะผู้บริหาร / QA เข้าหน้านี้ได้ — บัญชีของคุณไม่มีสิทธิ์
        </p>
      </div>
    );
  }

  const sp = await searchParams;
  const table = sp.table && AUDITED_TABLES.includes(sp.table) ? sp.table : undefined;
  const action =
    sp.action && (ACTIONS as string[]).includes(sp.action)
      ? (sp.action as AuditAction)
      : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const { rows, hasNext } = await getAuditLog({
    table,
    action,
    limit: PAGE_SIZE,
    page,
  });

  // สร้าง URL ไปหน้าอื่น โดยคงตัวกรอง table/action ไว้
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (table) params.set("table", table);
    if (action) params.set("action", action);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/audit?${qs}` : "/audit";
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ประวัติ / Audit</h1>
        <p className="text-sm text-muted-foreground">
          บันทึกการเปลี่ยนแปลงข้อมูลทั้งหมด (ใคร · เมื่อไร · ทำอะไร) — แก้ไข/ลบไม่ได้
          (append-only) ตามมาตรฐาน GMP
        </p>
      </div>

      {/* ตัวกรอง */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            ประเภทข้อมูล
          </label>
          <select
            name="table"
            defaultValue={table ?? ""}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— ทั้งหมด —</option>
            {AUDITED_TABLES.map((t) => (
              <option key={t} value={t}>
                {tableLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            การกระทำ
          </label>
          <select
            name="action"
            defaultValue={action ?? ""}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— ทั้งหมด —</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          กรอง
        </button>
      </form>

      <p className="text-xs text-muted-foreground">
        หน้า {page} · แสดง {rows.length} รายการ ({PAGE_SIZE}/หน้า)
      </p>

      {/* ตาราง */}
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">เวลา</th>
                <th className="px-3 py-2 font-medium">ผู้ทำ</th>
                <th className="px-3 py-2 font-medium">ประเภทข้อมูล</th>
                <th className="px-3 py-2 font-medium">การกระทำ</th>
                <th className="px-3 py-2 font-medium">เหตุผล / หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {fmtDateTime(r.changed_at)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    {r.actor_name ?? (
                      <span className="text-muted-foreground">ระบบ / ไม่ระบุ</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {tableLabel(r.table_name)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                      style={{ backgroundColor: ACTION_COLOR[r.action] }}
                    >
                      {ACTION_LABEL[r.action]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.reason ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          ไม่มีประวัติตามเงื่อนไขที่เลือก
        </p>
      )}

      {/* แบ่งหน้า */}
      {(page > 1 || hasNext) && (
        <div className="flex items-center justify-between gap-2">
          {page > 1 ? (
            <Link
              href={pageHref(page - 1)}
              className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
            >
              ← ก่อนหน้า
            </Link>
          ) : (
            <span className="cursor-not-allowed rounded-md border px-4 py-2 text-sm text-muted-foreground opacity-50">
              ← ก่อนหน้า
            </span>
          )}
          <span className="text-xs text-muted-foreground">หน้า {page}</span>
          {hasNext ? (
            <Link
              href={pageHref(page + 1)}
              className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
            >
              ถัดไป →
            </Link>
          ) : (
            <span className="cursor-not-allowed rounded-md border px-4 py-2 text-sm text-muted-foreground opacity-50">
              ถัดไป →
            </span>
          )}
        </div>
      )}
    </div>
  );
}
