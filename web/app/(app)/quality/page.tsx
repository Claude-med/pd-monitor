import Link from "next/link";
import type { ReactNode } from "react";
import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import { getJobs } from "@/lib/data/jobs";
import {
  getQualityInbox,
  getRecentSignatures,
  type InboxJob,
} from "@/lib/data/quality-inbox";
import { fmtDateTime, fmtDate, displayJobNo } from "@/lib/format";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import {
  InprocessReviewButtons,
  SampleReviewButtons,
  SignButtons,
} from "./quick-actions";

export const metadata = { title: "ตรวจ QC / QA — PD Monitor" };

/**
 * Part I ก้อน 4 — หน้า "ตรวจ QC / QA" = กล่องงานของทั้ง 2 ฝ่าย
 *
 * ทุกการ์ดบอก: งานไหน · ขั้นตอน (สถานี) ไหน · ต้องทำอะไร
 *   · กดหัวการ์ด / ปุ่ม "เปิดดู" → เข้าไปที่จุดนั้นในหน้างาน
 *   · อะไรที่ "แค่ตัดสิน" (อนุมัติ/ไม่อนุมัติ/ลงนาม) ทำท้ายการ์ดได้เลย
 *   · อะไรที่ต้องกรอกค่า (ผลตรวจ in-process / จุดเก็บตัวอย่าง) → "เปิดดู" พาไปฟอร์มตรงจุด
 *
 * "ของฉัน" = เฉพาะหัวข้อที่สิทธิ์ของผู้ดูทำได้จริง · "ทั้งหมด" = ดูภาพรวมทั้ง 2 ฝ่าย (ปุ่มโชว์ตามสิทธิ์)
 */

function jobHref(jobNo: string, q = "", hash = ""): string {
  return `/board/${encodeURIComponent(jobNo)}${q}${hash}`;
}

function TaskCard({
  job,
  step,
  todo,
  meta,
  href,
  tone = "default",
  children,
}: {
  job: InboxJob;
  step: string;
  todo: string;
  meta?: ReactNode;
  href: string;
  tone?: "default" | "warn";
  children?: ReactNode;
}) {
  return (
    <li
      className={`rounded-lg border bg-background ${
        tone === "warn" ? "border-l-4 border-l-amber-500" : ""
      }`}
    >
      <Link href={href} className="block space-y-1 p-3 hover:bg-accent/40">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className="font-semibold text-primary">
            {displayJobNo(job.job_no)}
          </span>
          {job.company && (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
              {job.company}
            </span>
          )}
          <span className="font-medium">{job.product_name ?? "—"}</span>
          {job.lot_no && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              Lot {job.lot_no}
            </span>
          )}
        </div>
        <p className="text-xs">
          <span className="text-muted-foreground">ขั้นตอน:</span>{" "}
          <span className="font-medium">{step}</span>
        </p>
        <p className="text-xs">
          <span className="text-muted-foreground">ต้องทำ:</span>{" "}
          <span className="font-semibold">{todo}</span>
        </p>
        {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-2 border-t px-3 py-2">
        <div className="min-w-0 flex-1">{children}</div>
        <Link
          href={href}
          className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          เปิดดู →
        </Link>
      </div>
    </li>
  );
}

function Section({
  title,
  who,
  count,
  children,
}: {
  title: string;
  who: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            count > 0 ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground"
          }`}
        >
          {count}
        </span>
        <span className="text-xs text-muted-foreground">{who}</span>
      </div>
      {count > 0 ? (
        <ul className="space-y-2">{children}</ul>
      ) : (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          ✓ ไม่มีงานค้าง
        </p>
      )}
    </section>
  );
}

export default async function QualityPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const profile = await getProfile();
  const roles = profile?.roles ?? [];

  if (!profile || !hasAnyRole(roles, ["qc", "qa", "manager"])) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 text-2xl font-bold tracking-tight">ตรวจ QC / QA</h1>
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          เฉพาะ QC / QA / ผู้บริหารเข้าหน้านี้ได้ — บัญชีของคุณไม่มีสิทธิ์
        </p>
      </div>
    );
  }

  const [jobs, recent, sp] = await Promise.all([
    getJobs(),
    getRecentSignatures(30),
    searchParams,
  ]);
  const inbox = await getQualityInbox(profile, jobs);
  const can = inbox.can;

  // หัวข้อที่ "เป็นงานของฉัน" — ไม่มีสักหัวข้อ (เช่น ผู้บริหาร) → เปิดมุมมองทั้งหมดให้เลย
  const mineAny =
    can.recordInprocess ||
    can.approveInprocess ||
    can.signQc ||
    can.recordSample ||
    can.reviewSample ||
    can.signQa;
  const showAll = sp.view === "all" || !mineAny;
  const show = (mine: boolean) => showAll || mine;

  const qcCount =
    (show(can.recordInprocess) ? inbox.inprocessDue.length : 0) +
    (show(can.approveInprocess) ? inbox.inprocessPending.length : 0) +
    (show(can.signQc) ? inbox.qcSign.length : 0);
  const qaCount =
    (show(can.recordSample) ? inbox.sampleDue.length : 0) +
    (show(can.reviewSample) ? inbox.samplePending.length : 0) +
    (show(can.signQa) ? inbox.qaSign.length : 0);
  const showQc = show(can.recordInprocess) || show(can.approveInprocess) || show(can.signQc);
  const showQa = show(can.recordSample) || show(can.reviewSample) || show(can.signQa);

  const tab = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${
      active ? "bg-primary text-primary-foreground" : "border hover:bg-accent"
    }`;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <RealtimeRefresh
        tables={[
          "jobs",
          "approvals",
          "inprocess_checks",
          "qa_samples",
          "production_records",
          "deviations",
        ]}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ตรวจ QC / QA</h1>
          <p className="text-sm text-muted-foreground">
            งานที่ต้องดำเนินการของฝ่าย QC และ QA — อนุมัติ/ลงนามท้ายการ์ดได้เลย
            หรือกด &ldquo;เปิดดู&rdquo; เพื่อเข้าไปในงาน
          </p>
        </div>
        {mineAny && (
          <div className="flex gap-2">
            <Link href="/quality" className={tab(!showAll)}>
              ของฉัน
            </Link>
            <Link href="/quality?view=all" className={tab(showAll)}>
              ทั้งหมด (QC + QA)
            </Link>
          </div>
        )}
      </div>

      {inbox.sampleEditRequests > 0 && (
        <Link
          href="/edit-requests"
          className="block rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300"
        >
          ✏️ มีคำขอแก้ไขจุดเก็บตัวอย่างรออนุมัติ {inbox.sampleEditRequests} รายการ — ไปที่หน้าคำขอแก้ไข →
        </Link>
      )}

      <div className={`grid gap-6 ${showQc && showQa ? "lg:grid-cols-2" : ""}`}>
        {showQc && (
          <div className="space-y-5 rounded-xl border bg-card p-4">
            <h2 className="flex items-center gap-2 font-semibold">
              🔬 ฝ่าย QC
              <span className="text-sm font-normal text-muted-foreground">
                {qcCount} รายการ
              </span>
            </h2>

            {show(can.recordInprocess) && (
              <Section
                title="รอตรวจ in-process"
                who="ลูกน้อง QC · บันทึกผลตรวจ"
                count={inbox.inprocessDue.length}
              >
                {inbox.inprocessDue.map((r) => (
                  <TaskCard
                    key={r.recordId}
                    job={r.job}
                    step={r.station ?? "—"}
                    todo={r.redo ? "ตรวจ in-process ใหม่ (ผลเดิมไม่อนุมัติ)" : "ตรวจ in-process + บันทึกผล"}
                    tone={r.redo ? "warn" : "default"}
                    meta={
                      <>
                        บันทึกผลผลิตวันที่ {fmtDate(r.recordDate)} · {r.output}
                      </>
                    }
                    href={jobHref(
                      r.job.job_no,
                      r.stepId ? `?step=${r.stepId}&qc=${r.recordId}` : "",
                      "#inprocess",
                    )}
                  >
                    <p className="text-xs text-muted-foreground">
                      ต้องกรอกค่าที่วัดได้ — กด &ldquo;เปิดดู&rdquo; ระบบเลือกบันทึกนี้ไว้ให้แล้ว
                    </p>
                  </TaskCard>
                ))}
              </Section>
            )}

            {show(can.approveInprocess) && (
              <Section
                title="อนุมัติผลตรวจ in-process"
                who="หัวหน้า QC"
                count={inbox.inprocessPending.length}
              >
                {inbox.inprocessPending.map((c) => (
                  <TaskCard
                    key={c.id}
                    job={c.job}
                    step={c.station ?? "—"}
                    todo={`อนุมัติผลตรวจ ${c.summary}`}
                    meta={
                      <>
                        เสนอ:{" "}
                        <b className={c.proposed === "fail" ? "text-red-600" : "text-emerald-700"}>
                          {c.proposed === "fail" ? "ไม่ผ่าน" : "ผ่าน"}
                        </b>{" "}
                        · โดย {c.checker ?? "—"} · {fmtDateTime(c.checkedAt)}
                      </>
                    }
                    href={jobHref(
                      c.job.job_no,
                      c.stepId ? `?step=${c.stepId}&pending=inprocess` : "?pending=inprocess",
                      "#inprocess",
                    )}
                  >
                    {!can.approveInprocess ? null : c.mine ? (
                      <p className="text-xs text-amber-700">
                        คุณเป็นผู้ลงผลเอง — ให้หัวหน้า QC คนอื่นอนุมัติ
                      </p>
                    ) : (
                      <InprocessReviewButtons jobNo={c.job.job_no} id={c.id} />
                    )}
                  </TaskCard>
                ))}
              </Section>
            )}

            {show(can.signQc) && (
              <Section
                title="ลงนาม QC (ทั้งงาน)"
                who="หัวหน้า QC · ต้องกรอกรหัสผ่าน"
                count={inbox.qcSign.length}
              >
                {inbox.qcSign.map((s) => (
                  <TaskCard
                    key={s.job.id}
                    job={s.job}
                    step="ตรวจ QC ปลายทาง (ทั้งงาน)"
                    todo="ลงนาม QC ผ่าน → ส่ง QA หรือตีกลับ"
                    meta={s.info.join(" · ")}
                    href={jobHref(s.job.job_no)}
                  >
                    {can.signQc && (
                      <SignButtons
                        jobId={s.job.id}
                        jobNo={s.job.job_no}
                        stage="qc"
                        blocked={s.blockers.length > 0}
                      />
                    )}
                  </TaskCard>
                ))}
              </Section>
            )}
          </div>
        )}

        {showQa && (
          <div className="space-y-5 rounded-xl border bg-card p-4">
            <h2 className="flex items-center gap-2 font-semibold">
              🧪 ฝ่าย QA
              <span className="text-sm font-normal text-muted-foreground">
                {qaCount} รายการ
              </span>
            </h2>

            {show(can.recordSample) && (
              <Section
                title="รอเก็บตัวอย่าง"
                who="ลูกน้อง QA · บันทึกจุดเก็บตัวอย่าง"
                count={inbox.sampleDue.length}
              >
                {inbox.sampleDue.map((j) => (
                  <TaskCard
                    key={j.id}
                    job={j}
                    step="ตรวจ Finished product (QA)"
                    todo="เก็บตัวอย่าง + บันทึกผล"
                    href={jobHref(j.job_no, "", "#qa-sample")}
                  >
                    <p className="text-xs text-muted-foreground">
                      ต้องกรอกจำนวน/ผล — กด &ldquo;เปิดดู&rdquo; ไปที่ฟอร์มจุดเก็บตัวอย่าง
                    </p>
                  </TaskCard>
                ))}
              </Section>
            )}

            {show(can.reviewSample) && (
              <Section
                title="อนุมัติจุดเก็บตัวอย่าง"
                who="หัวหน้า QA"
                count={inbox.samplePending.length}
              >
                {inbox.samplePending.map((s) => (
                  <TaskCard
                    key={s.id}
                    job={s.job}
                    step="ตรวจ Finished product (QA)"
                    todo={`อนุมัติผลตัวอย่าง${s.summary ? ` (${s.summary})` : ""}`}
                    meta={
                      <>
                        เสนอ:{" "}
                        <b>
                          {s.proposed === "fail"
                            ? "ไม่ผ่าน"
                            : s.proposed === "pass"
                              ? "ผ่าน"
                              : "ยังไม่ลงผล"}
                        </b>{" "}
                        · โดย {s.collector ?? "—"} · {fmtDateTime(s.collectedAt)}
                      </>
                    }
                    href={jobHref(s.job.job_no, "?pending=qa-sample", "#qa-sample")}
                  >
                    {can.reviewSample && (
                      <SampleReviewButtons jobNo={s.job.job_no} id={s.id} />
                    )}
                  </TaskCard>
                ))}
              </Section>
            )}

            {show(can.signQa) && (
              <Section
                title="ลงนาม QA ปล่อยผ่าน FG (ทั้งงาน)"
                who="ฝ่าย QA · ต้องกรอกรหัสผ่าน"
                count={inbox.qaSign.length}
              >
                {inbox.qaSign.map((s) => (
                  <TaskCard
                    key={s.job.id}
                    job={s.job}
                    step="ปล่อยผ่าน QA → คลัง FG"
                    todo={
                      s.blockers.length > 0
                        ? "เคลียร์รายการที่ติดก่อน แล้วจึงลงนามปล่อยผ่าน"
                        : "ลงนาม QA ปล่อยผ่าน → FG หรือตีกลับ"
                    }
                    tone={s.blockers.length > 0 ? "warn" : "default"}
                    meta={
                      <div className="space-y-0.5">
                        <p>{s.info.join(" · ")}</p>
                        {s.blockers.map((b) => (
                          <p key={b} className="font-medium text-red-600">
                            {b}
                          </p>
                        ))}
                      </div>
                    }
                    href={jobHref(s.job.job_no)}
                  >
                    {can.signQa && (
                      <SignButtons
                        jobId={s.job.id}
                        jobNo={s.job.job_no}
                        stage="qa"
                        blocked={s.blockers.length > 0}
                        canApprove={can.releaseQa}
                      />
                    )}
                  </TaskCard>
                ))}
              </Section>
            )}
          </div>
        )}
      </div>

      {/* การลงนามล่าสุด — รวม ลงนาม QC/QA · อนุมัติ in-process · อนุมัติตัวอย่าง */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-3 font-semibold">การลงนามล่าสุด</h2>
        {recent.length > 0 ? (
          <ul className="space-y-2">
            {recent.map((a) => {
              const color = a.ok ? "#16a34a" : "#ef4444";
              return (
                <li
                  key={a.key}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-l-4 bg-background p-3 text-sm"
                  style={{ borderLeftColor: color }}
                >
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                    style={{ backgroundColor: color }}
                  >
                    {a.label}
                  </span>
                  {a.jobNo ? (
                    <Link
                      href={jobHref(a.jobNo)}
                      className="font-semibold text-primary hover:underline"
                    >
                      {displayJobNo(a.jobNo)}
                    </Link>
                  ) : (
                    <span className="font-semibold">—</span>
                  )}
                  {a.detail && (
                    <span className="text-muted-foreground">{a.detail}</span>
                  )}
                  <span className="font-medium">{a.signer ?? "—"}</span>
                  <span className="text-muted-foreground">{fmtDateTime(a.at)}</span>
                  {a.reason && (
                    <span className="w-full text-muted-foreground">
                      เหตุผล: {a.reason}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">ยังไม่มีการลงนาม</p>
        )}
      </div>
    </div>
  );
}
