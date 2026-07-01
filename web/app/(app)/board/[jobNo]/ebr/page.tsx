import { notFound } from "next/navigation";
import Link from "next/link";
import { getBatchRecord } from "@/lib/data/ebr";
import { STATUS_LABEL } from "@/lib/data/job-constants";
import { STATION_LABEL, STATION_ICON } from "@/lib/data/station-constants";
import {
  SEVERITY_LABEL,
  DEV_STATUS_LABEL,
  DEV_TYPE_LABEL,
} from "@/lib/data/deviation-constants";
import { REQ_STATUS_LABEL } from "@/lib/data/requisition-constants";
import { fmtDateTime } from "@/lib/format";
import { PrintButton } from "./print-button";

export const metadata = { title: "eBR — แฟ้มบันทึกการผลิต" };

function fmt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("th-TH");
}

function dt(s: string | null): string {
  return fmtDateTime(s);
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="break-inside-avoid border-t pt-4">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <span className="font-medium">{value ?? "—"}</span>
    </div>
  );
}

const th = "border-b px-2 py-1 text-left text-xs font-medium text-muted-foreground";
const td = "border-b px-2 py-1 align-top";

export default async function EbrPage({
  params,
}: {
  params: Promise<{ jobNo: string }>;
}) {
  const { jobNo } = await params;
  const r = await getBatchRecord(decodeURIComponent(jobNo));
  if (!r) notFound();

  const { job } = r;
  const yes = (b: boolean) => (b ? "✓ ผ่าน" : "— ยังไม่ครบ");

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* แถบเครื่องมือ (ไม่พิมพ์) */}
      <div className="no-print flex items-center justify-between gap-2">
        <Link
          href={`/board/${encodeURIComponent(job.job_no)}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับหน้างาน
        </Link>
        <PrintButton />
      </div>

      {/* แฟ้มเอกสาร (พิมพ์เฉพาะส่วนนี้) */}
      <div id="ebr" className="space-y-5 rounded-xl border bg-card p-6">
        {/* หัวเอกสาร */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
          <div>
            <h1 className="text-xl font-bold">แฟ้มบันทึกการผลิต (eBR)</h1>
            <p className="text-sm text-muted-foreground">
              Electronic Batch Record — PD Monitor
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>เลขงาน: <b className="text-foreground">{job.job_no}</b></p>
            <p>สถานะ: {STATUS_LABEL[job.status] ?? job.status}</p>
            <p>พิมพ์เมื่อ: {fmtDateTime(new Date())}</p>
          </div>
        </div>

        {/* 1. ข้อมูลงาน */}
        <Section title="1. ข้อมูลงาน / ล็อต">
          <div className="grid gap-1 sm:grid-cols-2">
            <Row label="ผลิตภัณฑ์" value={job.product_name} />
            <Row label="ลูกค้า" value={job.customer} />
            <Row label="ออเดอร์" value={job.order_no} />
            <Row
              label="จำนวนสั่งผลิต"
              value={
                job.quantity != null
                  ? `${fmt(job.quantity)} ${job.unit ?? ""}`.trim()
                  : null
              }
            />
            <Row label="ล็อต / Batch" value={job.lot_no} />
            <Row label="วันผลิต" value={job.mfg_date} />
            <Row label="วันหมดอายุ" value={job.exp_date} />
            <Row
              label="แผนเริ่ม–เสร็จ"
              value={
                job.planned_start || job.planned_end
                  ? `${job.planned_start ?? "—"} → ${job.planned_end ?? "—"}`
                  : null
              }
            />
          </div>
        </Section>

        {/* 2. Line Clearance */}
        <Section title="2. การเตรียมสายการผลิต (Line Clearance)">
          {r.lineClearance ? (
            <div className="grid gap-1 sm:grid-cols-2">
              <Row label="เคลียร์ของเก่า" value={yes(r.lineClearance.cleared_old)} />
              <Row label="ทำความสะอาด" value={yes(r.lineClearance.cleaned)} />
              <Row label="ตั้งเครื่อง (set-up)" value={yes(r.lineClearance.setup_done)} />
              <Row
                label="เวลา set-up"
                value={
                  r.lineClearance.setup_minutes != null
                    ? `${r.lineClearance.setup_minutes} นาที`
                    : null
                }
              />
              <Row label="ผู้เคลียร์" value={r.lineClearance.performed_by_name} />
              <Row label="ผู้ตรวจรับ" value={r.lineClearance.checked_by_name} />
              <Row
                label="สรุป"
                value={r.lineClearance.passed ? "✓ ผ่านครบ + ลงนามแล้ว" : "ยังไม่ผ่าน"}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">— ไม่มีบันทึก Line Clearance</p>
          )}
        </Section>

        {/* 3. วัตถุดิบที่เบิกใช้ */}
        <Section title="3. วัตถุดิบที่เบิกใช้ (RM/PM)">
          {r.requisitions.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>รหัส</th>
                  <th className={th}>ชื่อ</th>
                  <th className={th}>ล็อต</th>
                  <th className={`${th} text-right`}>จำนวน</th>
                  <th className={th}>สถานะ</th>
                  <th className={th}>ผู้เบิก</th>
                </tr>
              </thead>
              <tbody>
                {r.requisitions.map((m) => (
                  <tr key={m.id}>
                    <td className={td}>{m.material_code}</td>
                    <td className={td}>{m.material_name}</td>
                    <td className={td}>{m.lot_no}</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {fmt(m.qty)} {m.unit}
                    </td>
                    <td className={td}>
                      {REQ_STATUS_LABEL[m.status] ?? m.status}
                    </td>
                    <td className={td}>{m.requested_by_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">— ไม่มีการเบิกวัตถุดิบ</p>
          )}
        </Section>

        {/* 4. เครื่องจักรที่ใช้ */}
        <Section title="4. เครื่องจักรที่ใช้">
          {r.machinesUsed.length > 0 ? (
            <ul className="list-inside list-disc text-sm">
              {r.machinesUsed.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">— ไม่ระบุเครื่องจักร</p>
          )}
        </Section>

        {/* 5. บันทึกผลผลิต */}
        <Section title="5. บันทึกผลผลิตรายสถานี">
          {r.records.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>วันที่</th>
                  <th className={th}>สถานี</th>
                  <th className={`${th} text-right`}>ตั้งต้น</th>
                  <th className={`${th} text-right`}>ผลิตได้</th>
                  <th className={`${th} text-right`}>ของเสีย</th>
                  <th className={`${th} text-right`}>ชม.</th>
                  <th className={`${th} text-right`}>คน</th>
                  <th className={th}>ผู้บันทึก</th>
                </tr>
              </thead>
              <tbody>
                {r.records.map((rec) => (
                  <tr key={rec.id}>
                    <td className={td}>{rec.record_date}</td>
                    <td className={td}>
                      {STATION_ICON[rec.station]} {STATION_LABEL[rec.station] ?? rec.station}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{fmt(rec.input_qty)}</td>
                    <td className={`${td} text-right tabular-nums`}>{fmt(rec.output_qty)}</td>
                    <td className={`${td} text-right tabular-nums`}>{fmt(rec.loss_qty)}</td>
                    <td className={`${td} text-right tabular-nums`}>{rec.hours ?? "—"}</td>
                    <td className={`${td} text-right tabular-nums`}>{rec.headcount ?? "—"}</td>
                    <td className={td}>{rec.operator_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">— ไม่มีบันทึกผลผลิต</p>
          )}
        </Section>

        {/* 6. ตรวจระหว่างผลิต (in-process QC) */}
        <Section title="6. ตรวจระหว่างผลิต (In-process QC)">
          {r.inprocessChecks.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>เวลา</th>
                  <th className={th}>สถานี</th>
                  <th className={th}>หัวข้อ</th>
                  <th className={th}>ค่า</th>
                  <th className={th}>ผล</th>
                  <th className={th}>ผู้ตรวจ</th>
                </tr>
              </thead>
              <tbody>
                {r.inprocessChecks.map((c) => (
                  <tr key={c.id}>
                    <td className={td}>{dt(c.checked_at)}</td>
                    <td className={td}>{STATION_LABEL[c.station] ?? c.station}</td>
                    <td className={td}>{c.param}</td>
                    <td className={td}>
                      {c.value ?? "—"} {c.unit ?? ""}
                    </td>
                    <td className={td}>{c.result === "pass" ? "ผ่าน" : "ไม่ผ่าน"}</td>
                    <td className={td}>{c.checker_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">— ไม่มีผลตรวจระหว่างผลิต</p>
          )}
        </Section>

        {/* 7. จุดเก็บตัวอย่าง QA */}
        <Section title="7. จุดเก็บตัวอย่าง (QA Sample)">
          {r.qaSamples.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>เวลา</th>
                  <th className={th}>จุด/รอบ</th>
                  <th className={`${th} text-right`}>จำนวน</th>
                  <th className={th}>ผู้เก็บ</th>
                </tr>
              </thead>
              <tbody>
                {r.qaSamples.map((s) => (
                  <tr key={s.id}>
                    <td className={td}>{dt(s.collected_at)}</td>
                    <td className={td}>{s.sample_point}</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {s.qty == null ? "—" : fmt(s.qty)} {s.unit ?? ""}
                    </td>
                    <td className={td}>{s.collector_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">— ไม่มีบันทึกจุดเก็บตัวอย่าง</p>
          )}
        </Section>

        {/* 8. Deviation */}
        <Section title="8. เหตุผิดปกติ (Deviation)">
          {r.deviations.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {r.deviations.map((d) => (
                <li key={d.id} className="rounded border p-2">
                  <p className="font-medium">
                    [{DEV_STATUS_LABEL[d.status] ?? d.status} ·{" "}
                    {SEVERITY_LABEL[d.severity] ?? d.severity}] {d.title}
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({DEV_TYPE_LABEL[d.dev_type] ?? d.dev_type})
                    </span>
                  </p>
                  {d.description && <p className="text-muted-foreground">{d.description}</p>}
                  {d.root_cause && <p>สาเหตุ: {d.root_cause}</p>}
                  {d.capa && <p>การแก้ไข/ป้องกัน (CAPA): {d.capa}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">— ไม่มี deviation</p>
          )}
        </Section>

        {/* 9. ลายเซ็นอนุมัติ QC/QA */}
        <Section title="9. ลายเซ็นอนุมัติคุณภาพ (QC / QA)">
          {r.approvals.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {r.approvals.map((a) => (
                <li key={a.id} className="flex flex-wrap gap-2">
                  <span className="font-medium">
                    {a.stage.toUpperCase()} {a.decision === "approve" ? "อนุมัติ" : "ตีกลับ"}
                  </span>
                  <span>{a.signer_name ?? "—"}</span>
                  <span className="text-muted-foreground">{dt(a.signed_at)}</span>
                  {a.reason && <span className="w-full text-muted-foreground">เหตุผล: {a.reason}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">— ยังไม่มีการลงนาม</p>
          )}
        </Section>

        {/* 10. สรุปเข้าคลัง FG */}
        <Section title="10. รับเข้าคลังสินค้าสำเร็จรูป (FG)">
          {r.fg ? (
            <div className="grid gap-1 sm:grid-cols-2">
              <Row label="จำนวนรับเข้า" value={`${fmt(r.fg.qty)} ${r.fg.unit ?? ""}`} />
              <Row label="ล็อต FG" value={r.fg.lot_no} />
              <Row label="ตำแหน่งจัดเก็บ" value={r.fg.location} />
              <Row label="วันที่รับเข้า" value={r.fg.received_date} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">— ยังไม่ได้รับเข้าคลัง</p>
          )}
        </Section>
      </div>
    </div>
  );
}
