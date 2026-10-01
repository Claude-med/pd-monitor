import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getBatchRecord } from "@/lib/data/ebr";
import { INPROCESS_STATUS_META } from "@/lib/data/inprocess-constants";
import { STATUS_LABEL, formatSubStatus } from "@/lib/data/job-constants";
import {
  SEVERITY_LABEL,
  DEV_STATUS_LABEL,
  DEV_TYPE_LABEL,
} from "@/lib/data/deviation-constants";
import {
  MATERIAL_TYPE_LABEL,
  READY_STATUS_LABEL,
} from "@/lib/data/job-material-constants";
import { QA_RESULT_META } from "@/lib/data/qa-sample-constants";
import type { ApprovalRow } from "@/lib/data/approvals";
import { fmtDateTime, displayJobNo } from "@/lib/format";
import { PrintButton } from "./print-button";

/**
 * ชื่อแท็บ = ชื่อไฟล์ตอน "บันทึกเป็น PDF" → ตั้งเป็นเลขงานให้ใช้ได้เลย
 * (ชื่อนี้ไม่ถูกพิมพ์ลงกระดาษแล้ว เพราะ @page margin: 0 — ดู EBR_CSS)
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ jobNo: string }>;
}): Promise<Metadata> {
  const { jobNo } = await params;
  return { title: `eBR-${displayJobNo(decodeURIComponent(jobNo))}` };
}

function fmt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("th-TH");
}

function dt(s: string | null): string {
  return fmtDateTime(s);
}

type Tone = "ok" | "bad" | "wait" | "none";

/** ป้ายผลลัพธ์ — มีข้อความ ✓/✗ กำกับเสมอ พิมพ์ขาวดำแล้วยังอ่านออก */
function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`ebr-badge ebr-${tone}`}>{children}</span>;
}

function Section({
  no,
  title,
  children,
}: {
  no: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ebr-section">
      <h2 className="ebr-h2">
        <span className="ebr-no">{no}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="ebr-empty">{children}</p>;
}

/** ช่องข้อมูลในกรอบ (label เล็กบน · ค่าตัวหนาล่าง) */
function Field({
  label,
  value,
  wide,
}: {
  label: string;
  value: React.ReactNode;
  wide?: boolean;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className={wide ? "ebr-field ebr-wide" : "ebr-field"}>
      <span className="ebr-label">{label}</span>
      <span className="ebr-value">{empty ? "—" : value}</span>
    </div>
  );
}

/** การลงนามอนุมัติล่าสุดของขั้นนั้น (ใช้เติมช่องลงนามท้ายเล่ม) */
function latestApprove(list: ApprovalRow[], stage: "qc" | "qa") {
  return list
    .filter((a) => a.stage === stage && a.decision === "approve")
    .sort((a, b) => b.signed_at.localeCompare(a.signed_at))[0];
}

/**
 * CSS ของหน้านี้โดยเฉพาะ — อยู่ในหน้า ไม่ใช่ globals.css (กติกาใน globals.css)
 * ไม่ใส่ prop precedence เพื่อให้ React คงไว้ตรงนี้ ไม่ hoist ขึ้น head
 *
 * 🚨 @page margin: 0 เสมอ — Chrome พิมพ์วันที่/ชื่อแท็บ/URL ของตัวเองลงใน "พื้นที่ขอบของ @page"
 *    ไม่เหลือขอบให้ = ไม่มีที่พิมพ์ = หายไปเอง (แพทเทิร์นเดียวกับใบแจ้งผลิต/ตารางบอร์ดงาน)
 *    ขอบกระดาษจริง: ซ้าย/ขวา = padding ของ .ebr-sheet · บน/ล่าง = ช่องว่างใน thead/tfoot
 *    ของตาราง .ebr-frame ซึ่ง Chrome พิมพ์ซ้ำ "ทุกหน้า" (padding ธรรมดาได้แค่หน้าแรก/หน้าสุดท้าย)
 */
const EBR_CSS = `
.ebr-preview { background: #e9e9ec; padding: 6mm; overflow-x: auto; border-radius: 0.75rem; }
.ebr-sheet {
  width: 210mm; min-height: 297mm; margin: 0 auto; box-sizing: border-box;
  padding: 0 14mm; background: #fff; color: #111;
  font-size: 9.5pt; line-height: 1.45;
  box-shadow: 0 2px 10px rgba(0,0,0,.25); outline: 1px solid #c9c9d2;
}
.ebr-frame { width: 100%; border-collapse: collapse; }
.ebr-frame > thead > tr > td, .ebr-frame > tfoot > tr > td, .ebr-frame > tbody > tr > td { padding: 0; }

/* หัว/ท้ายกระดาษซ้ำทุกหน้า (.ebr-pg-* = ตัวเดียวกันบนแผ่นที่จัดหน้าแล้วสำหรับ PDF) */
.ebr-run-head { padding-top: 10mm !important; }
.ebr-run-head > div, .ebr-pg-head {
  display: flex; justify-content: space-between; gap: 4mm;
  font-size: 7.5pt; color: #555; border-bottom: 0.4mm solid #111; padding-bottom: 1.2mm; margin-bottom: 4mm;
}
.ebr-run-foot { padding-bottom: 10mm !important; }
.ebr-run-foot > div, .ebr-pg-foot {
  display: flex; justify-content: space-between; gap: 4mm;
  font-size: 7.5pt; color: #666; border-top: 0.2mm solid #999; padding-top: 1.2mm; margin-top: 4mm;
}

/* หัวเอกสาร */
.ebr-title { display: flex; justify-content: space-between; align-items: flex-end; gap: 6mm;
  border-bottom: 0.6mm double #111; padding-bottom: 2.5mm; }
.ebr-title h1 { font-size: 17pt; font-weight: 800; line-height: 1.15; margin: 0; }
.ebr-title .ebr-sub { font-size: 9pt; color: #555; letter-spacing: .04em; }
.ebr-docno { text-align: right; font-size: 8pt; color: #444; }
.ebr-docno b { font-size: 11pt; color: #111; }

.ebr-grid { display: grid; grid-template-columns: repeat(4, 1fr); border: 0.25mm solid #999; border-right: 0; border-bottom: 0; margin-top: 3mm; }
.ebr-field { display: flex; flex-direction: column; padding: 1.2mm 2mm; border-right: 0.25mm solid #999; border-bottom: 0.25mm solid #999; min-width: 0; }
.ebr-wide { grid-column: span 2; }
.ebr-label { font-size: 7pt; color: #666; text-transform: uppercase; letter-spacing: .03em; }
.ebr-value { font-weight: 600; overflow-wrap: anywhere; }

/* สรุปผล */
.ebr-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2.5mm; margin-top: 3mm; }
.ebr-kpi { border: 0.25mm solid #bbb; border-radius: 1.5mm; padding: 1.8mm 2.5mm; background: #fafafa; }
.ebr-kpi .ebr-label { display: block; }
.ebr-kpi b { font-size: 13pt; font-variant-numeric: tabular-nums; }
.ebr-kpi small { font-size: 8pt; color: #555; margin-left: 1mm; }

/* หัวข้อ */
.ebr-section { margin-top: 5mm; }
.ebr-h2 {
  display: flex; align-items: center; gap: 2mm; margin: 0 0 2mm;
  font-size: 10.5pt; font-weight: 700; background: #eef0f3; border-left: 1.2mm solid #1f2937;
  padding: 1.2mm 2.5mm; break-after: avoid; page-break-after: avoid;
}
.ebr-no { display: inline-flex; align-items: center; justify-content: center; width: 5mm; height: 5mm;
  border-radius: 50%; background: #1f2937; color: #fff; font-size: 8pt; }
.ebr-empty { color: #777; font-style: italic; padding: 1mm 2.5mm; }
.ebr-note { font-size: 7.5pt; color: #666; margin-top: 1.2mm; }

/* ตาราง */
.ebr-t { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
.ebr-t th, .ebr-t td { border: 0.25mm solid #aaa; padding: 1mm 1.5mm; vertical-align: top; text-align: left; }
.ebr-t th { background: #e5e7eb; font-weight: 700; font-size: 7.8pt; }
.ebr-t tbody tr:nth-child(even) td { background: #f7f7f8; }
.ebr-t .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ebr-t thead { display: table-header-group; }
.ebr-t tr, .ebr-kv, .ebr-inc, .ebr-signs, .ebr-grid, .ebr-kpis { break-inside: avoid; page-break-inside: avoid; }
.ebr-h2 + * { break-before: avoid; }

.ebr-kv { display: grid; grid-template-columns: 1fr 1fr; column-gap: 6mm; }
.ebr-kv > div { display: flex; gap: 2mm; padding: 0.8mm 0; border-bottom: 0.2mm dotted #bbb; }
.ebr-kv .ebr-k { width: 30mm; flex-shrink: 0; color: #555; }
.ebr-kv .ebr-v { font-weight: 600; }

.ebr-list { margin: 0; padding-left: 5mm; }
.ebr-inc { border: 0.25mm solid #bbb; border-left: 1mm solid #b45309; padding: 1.5mm 2.5mm; margin-bottom: 2mm; }
.ebr-inc p { margin: 0.5mm 0 0; }

.ebr-badge { display: inline-block; padding: 0 1.5mm; border-radius: 1mm; font-weight: 600; font-size: 7.8pt; white-space: nowrap; border: 0.2mm solid; }
.ebr-ok { color: #166534; background: #dcfce7; border-color: #86efac; }
.ebr-bad { color: #991b1b; background: #fee2e2; border-color: #fca5a5; }
.ebr-wait { color: #92400e; background: #fef3c7; border-color: #fcd34d; }
.ebr-none { color: #555; background: #f3f4f6; border-color: #d1d5db; }

/* ช่องลงนาม */
.ebr-signs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; margin-top: 3mm; }
.ebr-sign { border: 0.25mm solid #999; padding: 2mm 3mm; text-align: center; }
.ebr-sign .ebr-role { font-weight: 700; font-size: 8.5pt; }
.ebr-sign .ebr-line { height: 13mm; border-bottom: 0.25mm solid #111; margin: 0 2mm 1.2mm; display: flex; align-items: flex-end; justify-content: center; font-style: italic; color: #333; }
.ebr-sign .ebr-meta { font-size: 7.5pt; color: #444; }

/* แผ่น A4 ตายตัวที่ paginate.ts สร้างนอกจอ → sheetsToPdf จับภาพทีละแผ่น (ขอบ 10/14mm เท่าตอน window.print) */
.ebr-paged { position: absolute; left: -20000px; top: 0; }
.ebr-pg {
  width: 210mm; height: 297mm; box-sizing: border-box; padding: 10mm 14mm;
  display: flex; flex-direction: column; overflow: hidden;
  background: #fff; color: #111; font-size: 9.5pt; line-height: 1.45;
}
.ebr-pg-body { flex: 1 1 auto; min-height: 0; overflow: hidden; }
.ebr-pg-body > :first-child { margin-top: 0; }
.ebr-pg-foot { margin-top: auto; }

@media screen and (max-width: 640px) { .ebr-preview { padding: 3mm; } }

@media print {
  @page { size: A4; margin: 0; }
  /* app-shell ครอบด้วย flex + min-h-screen · space-y-* ใส่ margin-top ให้ลูก → ล้างทิ้ง
     จำกัดขอบเขตด้วย :has(.ebr-preview) → มีผลเฉพาะหน้านี้ (แพทเทิร์นเดียวกับ notice-sheet.tsx) */
  body:has(.ebr-preview),
  body:has(.ebr-preview) > div,
  body:has(.ebr-preview) > div > div { display: block !important; min-height: 0 !important; }
  body:has(.ebr-preview) main { display: block !important; padding: 0 !important; }
  .ebr-page { margin: 0 !important; padding: 0 !important; max-width: none !important; }
  .ebr-preview { padding: 0 !important; background: none !important; overflow: visible !important; border-radius: 0 !important; margin: 0 !important; }
  /* 🚨 padding ซ้าย/ขวาของ .ebr-sheet คือขอบกระดาษ ห้ามล้าง */
  .ebr-sheet { width: auto; min-height: 0; box-shadow: none; outline: 0; margin: 0; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

export default async function EbrPage({
  params,
}: {
  params: Promise<{ jobNo: string }>;
}) {
  const { jobNo } = await params;
  const r = await getBatchRecord(decodeURIComponent(jobNo));
  if (!r) notFound();

  const { job } = r;
  const jobLabel = displayJobNo(job.job_no);
  const printedAt = fmtDateTime(new Date());
  const check = (b: boolean) =>
    b ? <Badge tone="ok">✓ ผ่าน</Badge> : <Badge tone="none">— ยังไม่ครบ</Badge>;

  // สรุปผลบนสุด — รวมจากข้อมูลที่มีอยู่แล้วในแฟ้ม (ไม่ query เพิ่ม)
  const totalLoss = r.records.reduce((s, x) => s + (x.loss_qty ?? 0), 0);
  const openIncidents = r.deviations.filter(
    (d) => d.status !== "closed" && d.status !== "cancelled",
  ).length;
  const qc = latestApprove(r.approvals, "qc");
  const qa = latestApprove(r.approvals, "qa");

  return (
    <div className="ebr-page mx-auto max-w-5xl space-y-3">
      <style>{EBR_CSS}</style>
      {/* แถบเครื่องมือ (ไม่พิมพ์) */}
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/board/${encodeURIComponent(job.job_no)}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับหน้างาน
        </Link>
        <PrintButton fileName={`eBR-${jobLabel}.pdf`} />
      </div>

      {/* แผ่นเอกสาร — บนจอแสดงเป็นกระดาษ A4 · ตอนพิมพ์ใช้ตัวเดียวกัน */}
      <div className="ebr-preview">
        <div id="ebr" className="ebr-sheet">
          <table className="ebr-frame">
            <thead>
              <tr>
                <td className="ebr-run-head">
                  <div>
                    <span>
                      <b>eBR · แฟ้มบันทึกการผลิต</b> · {jobLabel}
                      {job.lot_no ? ` · Lot ${job.lot_no}` : ""}
                    </span>
                    <span>{job.product_name ?? ""}</span>
                  </div>
                </td>
              </tr>
            </thead>
            <tfoot>
              <tr>
                <td className="ebr-run-foot">
                  <div>
                    <span>PD Monitor — เอกสารพิมพ์จากระบบ (Electronic Batch Record)</span>
                    <span>พิมพ์เมื่อ {printedAt}</span>
                  </div>
                </td>
              </tr>
            </tfoot>
            <tbody>
              <tr>
                <td>
                  {/* หัวเอกสาร */}
                  <div className="ebr-title">
                    <div>
                      <h1>แฟ้มบันทึกการผลิต</h1>
                      <div className="ebr-sub">BATCH MANUFACTURING RECORD (eBR)</div>
                    </div>
                    <div className="ebr-docno">
                      เลขงาน<br />
                      <b>{jobLabel}</b>
                      <br />
                      {job.company ?? ""}
                    </div>
                  </div>

                  <div className="ebr-grid">
                    <Field label="ผลิตภัณฑ์" value={job.product_name} wide />
                    <Field label="Reg No." value={job.reg_no} />
                    <Field label="ล็อต / Batch" value={job.lot_no} />
                    <Field
                      label="Batch Size"
                      value={
                        job.quantity != null
                          ? `${fmt(job.quantity)} ${job.unit ?? ""}`.trim()
                          : null
                      }
                    />
                    <Field label="วันผลิต (MFG)" value={job.mfg_date} />
                    <Field label="วันหมดอายุ (EXP)" value={job.exp_date} />
                    <Field label="สถานะงาน" value={STATUS_LABEL[job.status] ?? job.status} />
                    <Field label="ลูกค้า" value={job.customer} wide />
                    <Field label="ใบคำขอ" value={job.request_no} />
                    <Field label="พิมพ์เมื่อ" value={printedAt} />
                  </div>

                  <div className="ebr-kpis">
                    <div className="ebr-kpi">
                      <span className="ebr-label">Batch Size</span>
                      <b>{fmt(job.quantity)}</b>
                      <small>{job.unit ?? ""}</small>
                    </div>
                    <div className="ebr-kpi">
                      <span className="ebr-label">รับเข้าคลัง FG</span>
                      <b>{r.fg ? fmt(r.fg.qty) : "—"}</b>
                      <small>{r.fg?.unit ?? ""}</small>
                    </div>
                    <div className="ebr-kpi">
                      <span className="ebr-label">ของเสียรวม (ทุกสถานี)</span>
                      <b>{r.records.length ? fmt(totalLoss) : "—"}</b>
                    </div>
                    <div className="ebr-kpi">
                      <span className="ebr-label">Incident เปิดอยู่ / ทั้งหมด</span>
                      <b>
                        {openIncidents} / {r.deviations.length}
                      </b>
                    </div>
                  </div>

                  {/* 1. ข้อมูลงาน */}
                  <Section no={1} title="ข้อมูลงาน / ล็อต">
                    <div className="ebr-kv">
                      {(
                        [
                          ["Job No.", jobLabel],
                          ["บริษัท", job.company],
                          ["C.P.O DATE", job.cpo_date],
                          ["กำหนดส่ง", job.due_date],
                          ["Status", formatSubStatus(job.sub_status, job.plan_month)],
                          ["รูปแบบบรรจุ", job.pack_type],
                          [
                            "แผนเริ่ม–เสร็จ",
                            job.planned_start || job.planned_end
                              ? `${job.planned_start ?? "—"} → ${job.planned_end ?? "—"}`
                              : null,
                          ],
                          [
                            "Pack Size",
                            job.pack_patterns.length
                              ? job.pack_patterns.map((p, i) => `(${i + 1}) ${p}`).join("  ")
                              : null,
                          ],
                        ] as [string, React.ReactNode][]
                      ).map(([k, v]) => (
                        <div key={k}>
                          <span className="ebr-k">{k}</span>
                          <span className="ebr-v">{v === null || v === undefined || v === "" ? "—" : v}</span>
                        </div>
                      ))}
                    </div>
                  </Section>

                  {/* 2. Line Clearance */}
                  <Section no={2} title="การเตรียมสายการผลิต (Line Clearance)">
                    {r.lineClearances.length > 0 ? (
                      <table className="ebr-t">
                        <thead>
                          <tr>
                            <th>ขั้นตอน</th>
                            <th>เครื่องจักร</th>
                            <th>ห้อง</th>
                            <th>เคลียร์ของเก่า</th>
                            <th>ทำความสะอาด</th>
                            <th>ตั้งเครื่อง</th>
                            <th className="r">คน</th>
                            <th>ผู้ทำ</th>
                            <th>ผู้ยืนยัน</th>
                            <th>สรุป</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.lineClearances.map((c) => (
                            <tr key={c.id}>
                              <td>
                                {c.step_no}. {c.station_name}
                              </td>
                              <td>{c.machine_label}</td>
                              <td>{c.room ?? "—"}</td>
                              <td>
                                {check(c.cleared_old)}
                                {c.cleared_old_time ? ` ${c.cleared_old_time}` : ""}
                              </td>
                              <td>
                                {check(c.cleaned)}
                                {c.cleaned_time ? ` ${c.cleaned_time}` : ""}
                              </td>
                              <td>
                                {check(c.setup_done)}
                                {c.setup_minutes != null ? ` ${c.setup_minutes} นาที` : ""}
                              </td>
                              <td className="r">{c.headcount ?? "—"}</td>
                              <td>{c.performed_by_name ?? "—"}</td>
                              <td>{c.checked_by_name ?? "—"}</td>
                              <td>
                                {c.passed ? (
                                  <Badge tone="ok">✓ ผ่าน</Badge>
                                ) : (
                                  <Badge tone="wait">ยังไม่ผ่าน</Badge>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <Empty>— ไม่มีบันทึก Line Clearance</Empty>
                    )}
                  </Section>

                  {/* 3. วัตถุดิบ/บรรจุภัณฑ์ที่ต้องใช้ (Part C.2 — บันทึกหน้างาน ไม่ผูกล็อตคลัง) */}
                  <Section no={3} title="วัตถุดิบ/บรรจุภัณฑ์ที่ต้องใช้ (RM/PM)">
                    {r.materials.length > 0 ? (
                      <>
                        <table className="ebr-t">
                          <thead>
                            <tr>
                              <th>ประเภท</th>
                              <th>ชื่อ</th>
                              <th className="r">จำนวน</th>
                              <th>สถานะ</th>
                              <th>หมายเหตุ</th>
                              <th>ผู้บันทึก</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.materials.map((m) => (
                              <tr key={m.id}>
                                <td>{MATERIAL_TYPE_LABEL[m.item_type] ?? m.item_type}</td>
                                <td>{m.item_name}</td>
                                <td className="r">
                                  {fmt(m.qty)} {m.qty_unit ?? ""}
                                </td>
                                <td>{READY_STATUS_LABEL[m.status] ?? m.status}</td>
                                <td>{m.note ?? "—"}</td>
                                <td>{m.created_by_name ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="ebr-note">
                          บันทึกหน้างาน — ไม่ผูกเลขล็อตวัตถุดิบในระบบ
                          (สถานะ &ldquo;พร้อม&rdquo; = ฝ่ายคลังยืนยันว่ามีของ)
                        </p>
                      </>
                    ) : (
                      <Empty>— ไม่มีรายการเบิกวัตถุดิบ/บรรจุภัณฑ์</Empty>
                    )}
                  </Section>

                  {/* 4. เครื่องจักรที่ใช้ */}
                  <Section no={4} title="เครื่องจักรที่ใช้">
                    {r.machinesUsed.length > 0 ? (
                      <ul className="ebr-list">
                        {r.machinesUsed.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    ) : (
                      <Empty>— ไม่ระบุเครื่องจักร</Empty>
                    )}
                  </Section>

                  {/* 5. บันทึกผลผลิต */}
                  <Section no={5} title="บันทึกผลผลิตรายสถานี">
                    {r.records.length > 0 ? (
                      <table className="ebr-t">
                        <thead>
                          <tr>
                            <th>วันที่</th>
                            <th>สถานี</th>
                            <th className="r">ตั้งต้น</th>
                            <th className="r">ผลิตได้</th>
                            <th className="r">ของเสีย</th>
                            <th className="r">นาที</th>
                            <th className="r">คน</th>
                            <th>ผู้บันทึก</th>
                            {/* eBR เป็นเอกสารแบตช์ตามแนว GMP — ต้องเห็นลายเซ็นที่สองด้วย (Part E) */}
                            <th>ผู้อนุมัติ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.records.map((rec) => (
                            <tr key={rec.id}>
                              <td>{rec.record_date}</td>
                              <td>{rec.station_name ?? "—"}</td>
                              <td className="r">{fmt(rec.input_qty)}</td>
                              <td className="r">{fmt(rec.output_qty)}</td>
                              <td className="r">{fmt(rec.loss_qty)}</td>
                              <td className="r">{rec.minutes ?? "—"}</td>
                              <td className="r">{rec.headcount ?? "—"}</td>
                              <td>{rec.operator_name ?? "—"}</td>
                              <td>
                                {rec.status === "approved" ? (
                                  <Badge tone="ok">✓ {rec.approver_name ?? "อนุมัติแล้ว"}</Badge>
                                ) : rec.status === "rejected" ? (
                                  <Badge tone="bad">
                                    ✗ ไม่อนุมัติ{rec.approve_note ? ` — ${rec.approve_note}` : ""}
                                  </Badge>
                                ) : (
                                  <Badge tone="wait">รออนุมัติ</Badge>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <Empty>— ไม่มีบันทึกผลผลิต</Empty>
                    )}
                  </Section>

                  {/* 6. ตรวจระหว่างผลิต (in-process QC) */}
                  <Section no={6} title="ตรวจระหว่างผลิต (In-process QC)">
                    {r.inprocessChecks.length > 0 ? (
                      <table className="ebr-t">
                        <thead>
                          <tr>
                            <th>เวลา</th>
                            <th>สถานี</th>
                            <th>หัวข้อ</th>
                            <th>ค่า</th>
                            <th>ผล</th>
                            <th>Valid date</th>
                            <th>ผู้ตรวจ</th>
                            <th>อนุมัติ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.inprocessChecks.map((c) => (
                            <tr key={c.id}>
                              <td>{dt(c.checked_at)}</td>
                              <td>{c.station_name ?? "—"}</td>
                              <td>{c.param}</td>
                              <td>
                                {c.value ?? "—"} {c.unit ?? ""}
                              </td>
                              <td>
                                {c.result === "pass" ? (
                                  <Badge tone="ok">✓ ผ่าน</Badge>
                                ) : (
                                  <Badge tone="bad">✗ ไม่ผ่าน</Badge>
                                )}
                              </td>
                              <td>{c.valid_date ?? "—"}</td>
                              <td>{c.checker_name ?? "—"}</td>
                              <td>
                                <Badge
                                  tone={
                                    c.status === "approved"
                                      ? "ok"
                                      : c.status === "rejected"
                                        ? "bad"
                                        : "wait"
                                  }
                                >
                                  {INPROCESS_STATUS_META[c.status].label}
                                </Badge>
                                {c.approver_name ? ` ${c.approver_name}` : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <Empty>— ไม่มีผลตรวจระหว่างผลิต</Empty>
                    )}
                  </Section>

                  {/* 7. จุดเก็บตัวอย่าง (ตรวจ Finished product) */}
                  <Section no={7} title="จุดเก็บตัวอย่าง (ตรวจ Finished product)">
                    {r.qaSamples.length > 0 ? (
                      <table className="ebr-t">
                        <thead>
                          <tr>
                            <th>วันที่/เวลาที่เก็บ</th>
                            <th>ผลตรวจ</th>
                            <th className="r">จำนวน</th>
                            <th>ผู้เก็บ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.qaSamples.map((s) => (
                            <tr key={s.id}>
                              <td>{dt(s.collected_at)}</td>
                              <td>
                                {/* Part G (0096): ยังไม่อนุมัติ = ยังไม่ใช่ผลจริง */}
                                {s.review_status === "pending" ? (
                                  <Badge tone="wait">รอหัวหน้า QA อนุมัติ</Badge>
                                ) : s.display_result ? (
                                  <Badge tone={s.display_result === "pass" ? "ok" : "bad"}>
                                    {s.display_result === "pass" ? "✓ " : "✗ "}
                                    {QA_RESULT_META[s.display_result].label}
                                  </Badge>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="r">
                                {s.qty == null ? "—" : fmt(s.qty)} {s.unit ?? ""}
                              </td>
                              <td>{s.collector_name ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <Empty>— ไม่มีบันทึกจุดเก็บตัวอย่าง</Empty>
                    )}
                  </Section>

                  {/* 8. Incident Case */}
                  <Section no={8} title="เหตุผิดปกติ (Incident Case)">
                    {r.deviations.length > 0 ? (
                      <div>
                        {r.deviations.map((d) => (
                          <div key={d.id} className="ebr-inc">
                            <p>
                              <b>{d.title}</b>{" "}
                              <Badge
                                tone={
                                  d.status === "closed" || d.status === "cancelled"
                                    ? "none"
                                    : "wait"
                                }
                              >
                                {DEV_STATUS_LABEL[d.status] ?? d.status}
                              </Badge>{" "}
                              <span style={{ color: "#555", fontSize: "8pt" }}>
                                ความรุนแรง: {SEVERITY_LABEL[d.severity] ?? d.severity} · ประเภท:{" "}
                                {DEV_TYPE_LABEL[d.dev_type] ?? d.dev_type}
                              </span>
                            </p>
                            {d.description && <p>{d.description}</p>}
                            {/* root cause เลิกใช้ตั้งแต่ Part C.4 — พิมพ์เฉพาะเคสเก่าที่เคยกรอก */}
                            {d.root_cause && <p>สาเหตุ (ข้อมูลเดิม): {d.root_cause}</p>}
                            {d.capa && <p>การแก้ไขเบื้องต้น: {d.capa}</p>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty>— ไม่มี Incident Case</Empty>
                    )}
                  </Section>

                  {/* 9. ประวัติการลงนาม QC/QA */}
                  <Section no={9} title="ประวัติการลงนามอนุมัติคุณภาพ (QC / QA)">
                    {r.approvals.length > 0 ? (
                      <table className="ebr-t">
                        <thead>
                          <tr>
                            <th>ขั้น</th>
                            <th>ผลการลงนาม</th>
                            <th>ผู้ลงนาม</th>
                            <th>วันเวลา</th>
                            <th>เหตุผล</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.approvals.map((a) => (
                            <tr key={a.id}>
                              <td>{a.stage.toUpperCase()}</td>
                              <td>
                                {a.decision === "approve" ? (
                                  <Badge tone="ok">✓ อนุมัติ</Badge>
                                ) : (
                                  <Badge tone="bad">✗ ตีกลับ</Badge>
                                )}
                              </td>
                              <td>{a.signer_name ?? "—"}</td>
                              <td>{dt(a.signed_at)}</td>
                              <td>{a.reason ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <Empty>— ยังไม่มีการลงนาม</Empty>
                    )}
                  </Section>

                  {/* 10. สรุปเข้าคลัง FG */}
                  <Section no={10} title="รับเข้าคลังสินค้าสำเร็จรูป (FG)">
                    {r.fg ? (
                      <div className="ebr-kv">
                        <div>
                          <span className="ebr-k">จำนวนรับเข้า</span>
                          <span className="ebr-v">
                            {fmt(r.fg.qty)} {r.fg.unit ?? ""}
                          </span>
                        </div>
                        <div>
                          <span className="ebr-k">ล็อต FG</span>
                          <span className="ebr-v">{r.fg.lot_no ?? "—"}</span>
                        </div>
                        <div>
                          <span className="ebr-k">ตำแหน่งจัดเก็บ</span>
                          <span className="ebr-v">{r.fg.location ?? "—"}</span>
                        </div>
                        <div>
                          <span className="ebr-k">วันที่รับเข้า</span>
                          <span className="ebr-v">{r.fg.received_date ?? "—"}</span>
                        </div>
                      </div>
                    ) : (
                      <Empty>— ยังไม่ได้รับเข้าคลัง</Empty>
                    )}
                  </Section>

                  {/* ช่องลงนามท้ายเล่ม — QC/QA เติมชื่อให้เองถ้าลงนามในระบบแล้ว */}
                  <section className="ebr-section">
                    <h2 className="ebr-h2">การรับรองเอกสาร</h2>
                    <div className="ebr-signs">
                      <div className="ebr-sign">
                        <div className="ebr-role">ผู้จัดทำ (ฝ่ายผลิต)</div>
                        <div className="ebr-line" />
                        <div className="ebr-meta">
                          ชื่อ ........................................
                          <br />
                          วันที่ ......../......../........
                        </div>
                      </div>
                      <div className="ebr-sign">
                        <div className="ebr-role">ผู้ตรวจสอบ (QC)</div>
                        <div className="ebr-line">{qc ? "ลงนามในระบบแล้ว" : ""}</div>
                        <div className="ebr-meta">
                          {qc ? (
                            <>
                              {qc.signer_name ?? "—"}
                              <br />
                              {dt(qc.signed_at)}
                            </>
                          ) : (
                            <>
                              ชื่อ ........................................
                              <br />
                              วันที่ ......../......../........
                            </>
                          )}
                        </div>
                      </div>
                      <div className="ebr-sign">
                        <div className="ebr-role">ผู้อนุมัติปล่อยผ่าน (QA)</div>
                        <div className="ebr-line">{qa ? "ลงนามในระบบแล้ว" : ""}</div>
                        <div className="ebr-meta">
                          {qa ? (
                            <>
                              {qa.signer_name ?? "—"}
                              <br />
                              {dt(qa.signed_at)}
                            </>
                          ) : (
                            <>
                              ชื่อ ........................................
                              <br />
                              วันที่ ......../......../........
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
