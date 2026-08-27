import Link from "next/link";
import type { JobRouteStepFull } from "@/lib/data/job-routes";

/**
 * แถบแท็บ "ขั้นตอนการผลิต" ของหน้ารายละเอียดงาน (Part C.3 ก้อน 3)
 *
 * เป็น Server Component ล้วน — สลับแท็บด้วย `?step=<job_routes.id>` ไม่ใช้ state ฝั่ง client
 * เหตุผล: ข้อมูลของแต่ละแท็บ (บันทึกผลผลิต · ผลตรวจ QC · เครื่องจักร) มาจาก server อยู่แล้ว
 * ถ้าทำเป็น client state จะต้องส่งข้อมูลทุกขั้นตอนลงไปทั้งก้อน แล้วซ่อน/แสดงเอา
 * · แถมลิงก์แท็บแชร์/บุ๊กมาร์กได้ และปุ่ม "QC" จากตารางบันทึกผลผลิตจะลิงก์ข้ามแท็บได้ (ก้อน 5)
 *
 * โปรเจคนี้ไม่มี shadcn Tabs (components/ui มีแค่ button) — ทำเป็น pill-buttons เอง
 */
export function RouteTabs({
  jobNo,
  steps,
  activeId,
}: {
  jobNo: string;
  steps: JobRouteStepFull[];
  activeId: string;
}) {
  return (
    <div className="-mx-1 overflow-x-auto pb-1">
      <div
        className="flex min-w-max items-stretch gap-2 px-1"
        role="tablist"
        aria-label="ขั้นตอนการผลิตของงาน"
      >
        {steps.map((s) => {
          const active = s.id === activeId;
          return (
            <Link
              key={s.id}
              href={`/board/${encodeURIComponent(jobNo)}?step=${s.id}`}
              scroll={false}
              role="tab"
              aria-selected={active}
              className={
                "flex flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors " +
                (active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card hover:bg-accent")
              }
            >
              <span className="whitespace-nowrap text-sm font-medium">
                {s.step_no}. {s.station_name}
              </span>
              <span className="flex flex-wrap items-center gap-1">
                <Badge active={active} tone="neutral">
                  🔧 {s.machines.length} เครื่อง
                </Badge>
                <Badge active={active} tone="neutral">
                  📋 {s.recordCount}
                </Badge>
                {s.failCount > 0 && (
                  <Badge active={active} tone="danger">
                    ✕ QC ไม่ผ่าน {s.failCount}
                  </Badge>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** ป้ายเล็กบนแท็บ — ตอนแท็บ active พื้นหลังเป็นสีเข้ม ต้องกลับสีตัวอักษร */
function Badge({
  children,
  active,
  tone,
}: {
  children: React.ReactNode;
  active: boolean;
  tone: "neutral" | "danger";
}) {
  const cls =
    tone === "danger"
      ? active
        ? "bg-white/25 text-white"
        : "bg-destructive/15 text-destructive"
      : active
        ? "bg-white/20 text-white"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] ${cls}`}>
      {children}
    </span>
  );
}
