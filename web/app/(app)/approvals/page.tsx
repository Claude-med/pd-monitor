import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import {
  APPROVAL_GROUP_LABEL,
  APPROVER_ROLES,
  getMyApprovals,
  type ApprovalItem,
} from "@/lib/data/pending-approvals";
import { getPendingEditCount } from "@/lib/data/edit-requests";
import { EDIT_REVIEWER_ROLES } from "@/lib/data/edit-request-constants";
import { PENDING_FOCUS } from "@/lib/data/notification-constants";
import { fmtDate, fmtDateTime, displayJobNo } from "@/lib/format";
import { RealtimeRefresh } from "@/components/realtime-refresh";

/**
 * Part H — "รออนุมัติของฉัน"
 * รวมของที่หัวหน้าคนนี้ต้องอนุมัติจากทุกงานทุกสถานี · กดแล้วไปหน้างานตรงขั้นตอน/ส่วนนั้นเลย
 * (อนุมัติจริงยังทำที่หน้างาน — ปุ่มเดิมที่มีการตรวจสองลายเซ็นครบอยู่แล้ว)
 */
export default async function ApprovalsPage() {
  const profile = await getProfile();
  if (!profile || !hasAnyRole(profile.roles, APPROVER_ROLES)) redirect("/");

  const [items, editCount] = await Promise.all([
    getMyApprovals(profile),
    hasAnyRole(profile.roles, EDIT_REVIEWER_ROLES)
      ? getPendingEditCount(profile.roles)
      : Promise.resolve(0),
  ]);

  const groups = PENDING_FOCUS.map((focus) => ({
    focus,
    rows: items.filter((i) => i.focus === focus),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <RealtimeRefresh
        tables={[
          "production_records",
          "inprocess_checks",
          "qa_samples",
          "line_clearances",
          "edit_requests",
        ]}
      />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">⏳ รออนุมัติของฉัน</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          รายการจากทุกงานที่คุณกดอนุมัติได้ · กด &quot;ไปอนุมัติ&quot; แล้วระบบจะพาไปขั้นตอนและส่วนนั้นในหน้างานให้เลย
        </p>
      </div>

      {editCount > 0 && (
        <Link
          href="/edit-requests"
          className="flex items-center justify-between rounded-xl border border-amber-400 bg-amber-500/10 p-4 text-sm hover:bg-amber-500/15"
        >
          <span>
            ✏️ คำขอแก้ไข (Amendment) รออนุมัติ <b>{editCount}</b> รายการ
          </span>
          <span className="font-medium text-primary">ไปที่คำขอแก้ไข →</span>
        </Link>
      )}

      {groups.length === 0 && editCount === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          🎉 ไม่มีรายการรออนุมัติ
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.focus} className="rounded-xl border bg-card p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-semibold">{APPROVAL_GROUP_LABEL[g.focus]}</h2>
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
                {g.rows.length}
              </span>
            </div>
            <ul className="divide-y">
              {g.rows.map((r) => (
                <ApprovalRow key={r.id} item={r} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function ApprovalRow({ item }: { item: ApprovalItem }) {
  const when =
    item.when && item.when.length > 10 ? fmtDateTime(item.when) : item.when ? fmtDate(item.when) : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">งาน {displayJobNo(item.jobNo)}</span>
          {item.station && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {item.station}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {item.summary}
          {item.by ? ` · โดย ${item.by}` : ""}
          {when ? ` · ${when}` : ""}
        </p>
      </div>
      <Link
        href={item.href}
        className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
      >
        ไปอนุมัติ →
      </Link>
    </li>
  );
}
