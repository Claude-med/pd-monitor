"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  JOB_STATUS,
  STATUS_COLOR,
  STATUS_LABEL,
  formatSubStatus,
  type JobRow,
} from "@/lib/data/job-constants";
import type { CompanyOption } from "@/lib/data/companies";
import type { JobSubStatusOption } from "@/lib/data/job-sub-statuses";
import { displayJobNo } from "@/lib/format";
import {
  DEFAULT_MARGINS,
  DEFAULT_MARGIN_IN,
  MARGIN_SIDES,
  MAX_MARGIN_IN,
  fmtMm,
  isDefaultMargins,
  mm,
  toInches,
  type Margins,
  type Side,
} from "@/lib/print/paper-margins";
import {
  TABLE_FORMATS,
  columnsFor,
  fontPtFor,
  footerFor,
  maxPackOf,
  orientationFor,
  type TableFormat,
} from "./table-columns";
import { MeasureTable, TablePrintStyle, TableSheets } from "./table-sheet";

const inputCls =
  "rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

/** ระดับความละเอียดของตัวกรอง C.P.O DATE */
type CpoMode = "" | "year" | "month" | "day";

const ORIENTATION_LABEL = { portrait: "แนวตั้ง", landscape: "แนวนอน" } as const;

/** identity คงที่ — ใช้เป็นค่าว่างของ pages โดยไม่สร้าง array ใหม่ทุก render */
const NO_PAGES: JobRow[][] = [];

/** วันนี้ตามเวลาไทยแบบ YYYYMMDD — ใช้ต่อท้ายชื่อไฟล์ Excel */
function todayStamp(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replaceAll("-", "");
}

/** เทียบผลการตัดหน้า 2 รอบว่าเหมือนกันไหม — กัน setState วนไม่จบใน useLayoutEffect */
function samePages(a: JobRow[][], b: JobRow[][]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false;
    for (let k = 0; k < a[i].length; k++) if (a[i][k].id !== b[i][k].id) return false;
  }
  return true;
}

export function PrintTableView({
  jobs,
  companies,
  subStatuses,
}: {
  jobs: JobRow[];
  companies: CompanyOption[];
  subStatuses: JobSubStatusOption[];
}) {
  /**
   * บริษัท — บังคับเลือก 1 บริษัทเสมอ ไม่มีตัวเลือก "ทุกบริษัท"
   * 🚨 displayJobNo() ตัดอักษรนำของบริษัททิ้ง → UMEDA 690001 กับ POND P690001 พิมพ์ออกมา
   *    เป็นเลขเดียวกันเป๊ะ ปนกันบนกระดาษแล้วแยกไม่ออก
   */
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [format, setFormat] = useState<TableFormat>("planned");
  const [status, setStatus] = useState("");
  const [subStatus, setSubStatus] = useState("");
  const [subStatusMonth, setSubStatusMonth] = useState("");
  const [cpoMode, setCpoMode] = useState<CpoMode>("");
  const [cpoValue, setCpoValue] = useState("");
  const [search, setSearch] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  /** ขอบกระดาษ 4 ด้าน (นิ้ว) — ไม่จำข้ามครั้ง เปิดหน้าใหม่เริ่มที่ 0.32" เสมอ */
  const [margins, setMargins] = useState<Margins>(DEFAULT_MARGINS);

  /**
   * ผลการตัดหน้า + ลายเซ็นของสิ่งที่ใช้ตัด (ดู layout.sig)
   * 🔑 ผูก sig ไว้ด้วยเพื่อให้ "ผลเก่าที่ยังไม่ทันคำนวณใหม่" ถูกมองเป็นว่าง แทนที่จะโชว์/พิมพ์ของผิด
   */
  const [paged, setPaged] = useState<{ sig: string; list: JobRow[][] }>({
    sig: "",
    list: NO_PAGES,
  });

  /**
   * งานที่ติ๊กไว้ (เก็บ job.id)
   * 🔑 เก็บแยกจากตัวกรองโดยตั้งใจ — เปลี่ยนตัวกรองแล้วของที่ติ๊กต้องไม่หาย (requirement)
   */
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const company = companies.find((c) => c.id === companyId) ?? null;
  const measureRef = useRef<HTMLDivElement>(null);

  const mIn = useMemo(() => toInches(margins), [margins]);
  const atDefaultMargins = isDefaultMargins(margins);

  /** ขนาดพื้นที่พิมพ์จริง — ต้องใช้สูตรเดียวกับ .pt-sheet ใน table-sheet.tsx เป๊ะ ๆ */
  const orientationOfPaper = (o: "portrait" | "landscape") =>
    o === "portrait"
      ? { w: 210 - mm(mIn.left) - mm(mIn.right) - 0.8, h: 297 - mm(mIn.top) - mm(mIn.bottom) - 1.5 }
      : { w: 297 - mm(mIn.left) - mm(mIn.right) - 0.8, h: 210 - mm(mIn.top) - mm(mIn.bottom) - 1.5 };

  const companyJobs = useMemo(
    () => jobs.filter((j) => j.company_id === companyId),
    [jobs, companyId],
  );

  /** ปี ค.ศ. ที่มี C.P.O DATE จริงในข้อมูลของบริษัทนี้ (ใหม่ → เก่า) */
  const cpoYears = useMemo(() => {
    const set = new Set<string>();
    for (const j of companyJobs) if (j.cpo_date) set.add(j.cpo_date.slice(0, 4));
    return [...set].sort().reverse();
  }, [companyJobs]);

  const selectedSubStatus = subStatuses.find((o) => o.name === subStatus) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // 🚨 เทียบวันที่ด้วย string prefix ล้วน ('2026-08-14'.startsWith('2026-08'))
    //    ห้ามผ่าน new Date() — timezone ทำให้เลื่อนวัน/เดือนได้ (บทเรียน 0048)
    const prefix = cpoMode && cpoValue ? cpoValue : "";
    return companyJobs.filter((j) => {
      if (status && j.status !== status) return false;
      if (subStatus && j.sub_status !== subStatus) return false;
      if (subStatusMonth && (j.plan_month ?? "").slice(0, 7) !== subStatusMonth)
        return false;
      if (prefix && !(j.cpo_date ?? "").startsWith(prefix)) return false;
      if (q) {
        const hay =
          `${j.job_no} ${displayJobNo(j.job_no)} ${j.product_name ?? ""} ${j.product_code ?? ""} ${j.customer ?? ""} ${j.request_no ?? ""} ${j.lot_no ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [companyJobs, status, subStatus, subStatusMonth, search, cpoMode, cpoValue]);

  /** งานที่จะพิมพ์จริง — เฉพาะบริษัทที่เลือก เรียงตามเลขงาน (getJobs() เรียงมาให้แล้ว) */
  const pickedJobs = useMemo(
    () => companyJobs.filter((j) => picked.has(j.id)),
    [companyJobs, picked],
  );

  /** ติ๊กไว้แต่ตัวกรองปัจจุบันซ่อนอยู่ — ต้องโชว์ ไม่งั้นพิมพ์งานที่มองไม่เห็นออกมา */
  const hiddenPicked = useMemo(() => {
    const shown = new Set(filtered.map((j) => j.id));
    return pickedJobs.filter((j) => !shown.has(j.id));
  }, [filtered, pickedJobs]);

  const allFilteredPicked =
    filtered.length > 0 && filtered.every((j) => picked.has(j.id));
  const otherCompanyPicked = picked.size - pickedJobs.length;

  /* ---------- รูปร่างกระดาษ — คิดจาก "งานที่ติ๊กไว้" เพราะนั่นคือสิ่งที่จะออกมาจริง ----------
     รวมเป็น memo เดียวเพราะทุกค่าผูกกันหมด (จำนวนช่องขนาดบรรจุ → คอลัมน์ → แนวกระดาษ → ฟอนต์)
     และ sig ต้องคิดจากชุดเดียวกันเป๊ะ ไม่งั้น "ผลที่วัดไว้" กับ "สิ่งที่กำลังโชว์" หลุดจากกันได้ */
  const layout = useMemo(() => {
    const maxPack = maxPackOf(pickedJobs);
    return {
      maxPack,
      cols: columnsFor(format, maxPack),
      orientation: orientationFor(format, maxPack),
      fontPt: fontPtFor(format, maxPack),
      footer: footerFor(format),
      /** ลายเซ็นของทุกอย่างที่ทำให้ผลการตัดหน้าเปลี่ยน */
      sig: [
        pickedJobs.map((j) => j.id).join(","),
        format,
        maxPack,
        margins.top,
        margins.right,
        margins.bottom,
        margins.left,
      ].join("|"),
    };
  }, [pickedJobs, format, margins]);

  const { maxPack, cols, orientation, fontPt, footer } = layout;
  const paper = orientationOfPaper(orientation);

  /* ============================================================
     ตัดหน้า — วัดความสูงจริงของทุกแถวก่อน แล้วค่อยจัดลงหน้า

     ชื่อยาไทย/อังกฤษยาวไม่เท่ากัน แถวจึงตีบรรทัดไม่เท่ากัน จะ fix ว่า "หน้าละ N แถว" ไม่ได้
     แยก pass อ่าน/เขียนให้ชัด แบบเดียวกับ fitSheets() ของใบแจ้งผลิต
     ============================================================ */

  /** อ่าน DOM แล้วคืนผลการตัดหน้า · null = ยังวัดไม่ได้ (ให้คงผลรอบก่อนไว้) */
  const measurePages = useCallback((): JobRow[][] | null => {
    if (pickedJobs.length === 0) return NO_PAGES;
    const root = measureRef.current;
    if (!root) return null;

    const probe = root.querySelector<HTMLElement>(".pt-probe");
    const table = root.querySelector<HTMLElement>("table");
    const thead = root.querySelector<HTMLElement>("thead");
    const foot = root.querySelector<HTMLElement>(".pt-foot");
    const trs = [...root.querySelectorAll<HTMLElement>("tbody tr")];
    // จำนวนแถวไม่ตรง = DOM ยังเป็นของรอบก่อน ยังวัดไม่ได้
    if (!probe || !table || !thead || trs.length !== pickedJobs.length) return null;

    // อ่านอย่างเดียว · getBoundingClientRect เพราะได้ทศนิยม (offsetHeight ปัดเป็น px เต็ม)
    const pageH = probe.getBoundingClientRect().height;
    const theadH = thead.getBoundingClientRect().height;
    const rowH = trs.map((tr) => tr.getBoundingClientRect().height);
    // ตอนพิมพ์ .pt-measure ถูก display:none → ทุกค่าเป็น 0 · คงผลรอบก่อนไว้ ดีกว่าล้างทิ้ง
    if (pageH <= 0 || theadH <= 0) return null;

    /* 🚨 ท้ายกระดาษกินที่ = ความสูง + margin-top (2mm) — ลืม margin ไปแล้วหน้าแรกจะล้น ~3px
       แล้วแถวสุดท้ายโดน overflow:hidden ตัดหัวขาด (เจอจริงตอนทดสอบ) */
    const footOuter = foot
      ? foot.getBoundingClientRect().height +
        (Number.parseFloat(getComputedStyle(foot).marginTop) || 0)
      : 0;

    /* ตารางสูงกว่าผลรวมของแถวอยู่เล็กน้อย (~0.8px) เพราะ border-collapse ยังเหลือขอบนอกของตัวตาราง
       วัดส่วนเกินนี้จากของจริงแทนที่จะเดา — ค่าจะถูกเสมอไม่ว่าเบราว์เซอร์จะปัดเศษยังไง */
    const sumRows = rowH.reduce((a, b) => a + b, 0);
    const tableExtra = Math.max(
      0,
      table.getBoundingClientRect().height - theadH - sumRows,
    );

    const avail = pageH - theadH - footOuter - tableExtra - 1; // เผื่ออีก 1px กันเศษปัด
    if (avail <= 0) return null;

    const out: JobRow[][] = [];
    let cur: JobRow[] = [];
    let used = 0;
    for (let i = 0; i < pickedJobs.length; i++) {
      // 🚨 หน้าละอย่างน้อย 1 แถวเสมอ — ไม่งั้นแถวที่สูงกว่าหน้ากระดาษจะทำให้วนไม่จบ
      if (cur.length > 0 && used + rowH[i] > avail) {
        out.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(pickedJobs[i]);
      used += rowH[i];
    }
    if (cur.length > 0) out.push(cur);
    return out;
  }, [pickedJobs]);

  const paginate = useCallback(() => {
    const next = measurePages();
    if (next === null) return;
    // 🚨 เทียบก่อนเซ็ตเสมอ — setState ใน useLayoutEffect ที่ไม่เทียบจะวนไม่จบ
    setPaged((prev) =>
      prev.sig === layout.sig && samePages(prev.list, next)
        ? prev
        : { sig: layout.sig, list: next },
    );
  }, [measurePages, layout.sig]);

  useLayoutEffect(() => {
    // กรณี "measure แล้วค่อย layout" ที่ทำใน useLayoutEffect เท่านั้น — ความสูงจริงของแต่ละแถว
    // รู้ได้หลังเบราว์เซอร์จัดหน้าแล้ว จะคำนวณจาก state ล้วนไม่ได้ (ชื่อยาตีบรรทัดไม่เท่ากัน)
    // ไม่วนไม่จบเพราะ paginate() เทียบผลก่อนเซ็ตทุกครั้ง (sig + samePages)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    paginate();
  }, [paginate]);

  /**
   * หน้าที่เอาไปโชว์/พิมพ์จริง
   * ผลเก่าที่ sig ไม่ตรง (เพิ่งเปลี่ยนตัวเลือกแต่ยังไม่ทันวัดใหม่) = ไม่แสดงอะไรเลย
   * — ยอมกระพริบ 1 เฟรม ดีกว่าพิมพ์ตารางของรอบก่อนออกมา
   */
  const pages = paged.sig === layout.sig ? paged.list : NO_PAGES;

  useEffect(() => {
    // ฟอนต์ AngsanaUPC โหลดช้ากว่า layout รอบแรก → ความสูงแถวเปลี่ยน ต้องวัดซ้ำ
    document.fonts?.ready.then(paginate).catch(() => {});
    // กัน Ctrl+P ตอนที่ยังไม่เคยเปิดตัวอย่าง
    window.addEventListener("beforeprint", paginate);
    return () => window.removeEventListener("beforeprint", paginate);
  }, [paginate]);

  /* ============================================================
     ปุ่มต่าง ๆ
     ============================================================ */
  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllFiltered() {
    setPicked((prev) => {
      const next = new Set(prev);
      if (allFilteredPicked) for (const j of filtered) next.delete(j.id);
      else for (const j of filtered) next.add(j.id);
      return next;
    });
  }

  function clearCompanyPicked() {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const j of companyJobs) next.delete(j.id);
      return next;
    });
  }

  function changeCpoMode(mode: CpoMode) {
    setCpoMode(mode);
    setCpoValue(""); // เปลี่ยนระดับความละเอียด = เริ่มเลือกค่าใหม่
  }

  function changeSubStatus(name: string) {
    setSubStatus(name);
    const opt = subStatuses.find((o) => o.name === name);
    // สถานะที่ไม่ผูกกับเดือนแผน → ล้างเดือนทิ้ง ไม่ให้ค้างแล้วกรองงานหายหมด
    if (!opt?.requires_plan_month) setSubStatusMonth("");
  }

  /**
   * ออกไฟล์ Excel — ใช้ cols ชุดเดียวกับที่พิมพ์ลงกระดาษ หัวตาราง/ลำดับคอลัมน์จึงตรงกันเสมอ
   * โหลด SheetJS แบบ dynamic ตอนกดเท่านั้น (ไลบรารีใหญ่ ~900KB ไม่ควรติดไปกับ bundle ของหน้า)
   */
  async function exportExcel() {
    if (pickedJobs.length === 0) return;
    setBusy(true);
    setExportError(null);
    try {
      const XLSX = await import("xlsx");
      const header = cols.map((c) => c.header);
      const body = pickedJobs.map((j) =>
        // raw() = คอลัมน์ที่ควรเป็นตัวเลขจริงในชีต (บวก/เรียงได้) · ที่เหลือเป็นข้อความตามกระดาษ
        cols.map((c) => (c.raw ? (c.raw(j) ?? "") : c.value(j))),
      );
      const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
      ws["!cols"] = cols.map((c) => ({ wch: Math.round(c.weight * 1.6) + 4 }));
      // ช่องตัวเลขจริง → ใส่รูปแบบคั่นหลักพัน ให้อ่านเหมือนบนกระดาษ แต่ยังบวก/เรียงใน Excel ได้
      cols.forEach((c, i) => {
        if (!c.raw) return;
        for (let r = 1; r <= body.length; r++) {
          const cell = ws[XLSX.utils.encode_cell({ c: i, r })];
          if (cell?.t === "n") cell.z = "#,##0";
        }
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "ตารางบอร์ดงาน");
      XLSX.writeFile(
        wb,
        `ตารางบอร์ดงาน-${company?.code ?? "ALL"}-${todayStamp()}.xlsx`,
      );
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "สร้างไฟล์ Excel ไม่สำเร็จ",
      );
    } finally {
      setBusy(false);
    }
  }

  if (companies.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        ยังไม่มีบริษัทในระบบ — ตั้งค่าที่เมนู “บริษัท / เลขงาน” ก่อน
      </p>
    );
  }

  return (
    <div
      className="pt-page space-y-4"
      style={
        {
          "--pt-mt": `${mIn.top}in`,
          "--pt-mr": `${mIn.right}in`,
          "--pt-mb": `${mIn.bottom}in`,
          "--pt-ml": `${mIn.left}in`,
          "--pt-fs": `${fontPt}pt`,
        } as CSSProperties
      }
    >
      <TablePrintStyle />
      {/* @page ต้อง build เป็น string — var() ใช้ใน @page ไม่ได้ (Chrome ไม่รับ)
          แนวกระดาษก็อยู่ตรงนี้ เพราะเปลี่ยนตามจำนวนคอลัมน์ขนาดบรรจุ */}
      <style>{`@page { size: A4 ${orientation}; margin: ${mIn.top}in ${mIn.right}in ${mIn.bottom}in ${mIn.left}in; }`}</style>

      {/* ---------- รูปแบบตาราง ---------- */}
      <div className="no-print space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              รูปแบบตาราง
            </div>
            <div className="flex gap-2">
              {TABLE_FORMATS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFormat(f.key)}
                  className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                    format === f.key
                      ? "border-primary bg-primary/10 text-foreground"
                      : "hover:bg-accent"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              บริษัท
            </label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className={inputCls}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>

          <p className="mb-2 text-xs text-muted-foreground">
            A4 <b className="text-foreground">{ORIENTATION_LABEL[orientation]}</b> ·{" "}
            <b className="text-foreground">{cols.length}</b> คอลัมน์ ·{" "}
            <b className="text-foreground">{pages.length}</b> หน้า
            <br />
            {format === "planned" && maxPack === 1
              ? "งานที่เลือกมีขนาดบรรจุช่องเดียว → ตัดคอลัมน์ (2)(3) ทิ้ง"
              : `แสดงขนาดบรรจุ ${maxPack} ช่อง`}
          </p>
        </div>
      </div>

      {/* ---------- ตัวกรอง ---------- */}
      <div className="no-print space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              ขั้นตอน
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={inputCls}
            >
              <option value="">ทุกขั้นตอน</option>
              {JOB_STATUS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Status
            </label>
            <select
              value={subStatus}
              onChange={(e) => changeSubStatus(e.target.value)}
              className={inputCls}
            >
              <option value="">ทุก Status</option>
              {subStatuses.map((o) => (
                <option key={o.id} value={o.name}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          {/* สถานะที่ผูกกับเดือนแผน (เช่น "มีแผน") → เลือกเดือน/ปีของแผนนั้นต่อได้ */}
          {selectedSubStatus?.requires_plan_month && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                เดือนแผน
              </label>
              <input
                type="month"
                value={subStatusMonth}
                onChange={(e) => setSubStatusMonth(e.target.value)}
                className={inputCls}
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              C.P.O DATE
            </label>
            <select
              value={cpoMode}
              onChange={(e) => changeCpoMode(e.target.value as CpoMode)}
              className={inputCls}
            >
              <option value="">ไม่กรองวันที่</option>
              <option value="year">ปี</option>
              <option value="month">เดือน + ปี</option>
              <option value="day">วัน เดือน ปี</option>
            </select>
          </div>

          {cpoMode === "year" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                ปี
              </label>
              <select
                value={cpoValue}
                onChange={(e) => setCpoValue(e.target.value)}
                className={inputCls}
              >
                <option value="">เลือกปี</option>
                {cpoYears.map((y) => (
                  <option key={y} value={y}>
                    {y} (พ.ศ. {Number(y) + 543})
                  </option>
                ))}
              </select>
            </div>
          )}
          {cpoMode === "month" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                เดือน + ปี
              </label>
              <input
                type="month"
                value={cpoValue}
                onChange={(e) => setCpoValue(e.target.value)}
                className={inputCls}
              />
            </div>
          )}
          {cpoMode === "day" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                วันที่
              </label>
              <input
                type="date"
                value={cpoValue}
                onChange={(e) => setCpoValue(e.target.value)}
                className={inputCls}
              />
            </div>
          )}

          <div className="min-w-[12rem] flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              ค้นหา
            </label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="เลขงาน / ชื่อยา / รหัสยา / ลูกค้า / ใบคำขอ / Lot"
              className={`${inputCls} w-full`}
            />
          </div>
        </div>

        {/* ---------- สรุป + ปุ่ม ---------- */}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={allFilteredPicked}
              disabled={filtered.length === 0}
              onChange={toggleAllFiltered}
            />
            ติ๊กทั้งหมดที่กรองอยู่ ({filtered.length})
          </label>

          <button
            type="button"
            onClick={clearCompanyPicked}
            disabled={pickedJobs.length === 0}
            className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent disabled:opacity-40"
          >
            ล้างที่เลือก
          </button>

          <span className="text-sm text-muted-foreground">
            เลือกไว้ <b className="text-foreground">{pickedJobs.length}</b> งาน ={" "}
            <b className="text-foreground">{pages.length}</b> หน้า
            {otherCompanyPicked > 0 && (
              <span className="ml-1">
                (อีก {otherCompanyPicked} งานอยู่บริษัทอื่น — ไม่ถูกพิมพ์รอบนี้)
              </span>
            )}
          </span>

          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              disabled={pickedJobs.length === 0}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40"
            >
              {showPreview ? "🙈 ซ่อนตัวอย่าง" : "👁 ดูตัวอย่าง"}
            </button>
            <button
              type="button"
              onClick={exportExcel}
              disabled={pickedJobs.length === 0 || busy}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40"
            >
              {busy ? "กำลังสร้างไฟล์…" : "📊 Excel (.xlsx)"}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={pickedJobs.length === 0}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              🖨️ ปริ้นตารางบอร์ดงาน / PDF
            </button>
          </div>
        </div>

        {exportError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {exportError}
          </p>
        )}

        {hiddenPicked.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t pt-3 text-xs">
            <span className="text-muted-foreground">
              เลือกไว้แต่ตัวกรองซ่อนอยู่ ({hiddenPicked.length}):
            </span>
            {hiddenPicked.map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => toggle(j.id)}
                title="เอาออกจากรายการที่เลือก"
                className="rounded-full border border-primary bg-primary/10 px-2 py-0.5 font-medium hover:bg-primary/20"
              >
                {displayJobNo(j.job_no)} ✕
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ---------- รายการงานให้ติ๊ก ---------- */}
      <div className="no-print rounded-xl border bg-card">
        {filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            ไม่พบงานตามตัวกรองนี้
          </p>
        ) : (
          <ul className="divide-y">
            {filtered.map((j) => (
              <li key={j.id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-accent/50">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0"
                    checked={picked.has(j.id)}
                    onChange={() => toggle(j.id)}
                  />
                  <span className="w-20 shrink-0 text-sm font-semibold">
                    {displayJobNo(j.job_no)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {j.product_name ?? "—"}
                  </span>
                  <span className="hidden w-32 shrink-0 truncate text-xs text-muted-foreground sm:block">
                    {j.customer ?? "—"}
                  </span>
                  <span className="hidden w-24 shrink-0 text-xs text-muted-foreground md:block">
                    {j.cpo_date ?? "—"}
                  </span>
                  <span className="hidden w-24 shrink-0 truncate text-xs text-muted-foreground lg:block">
                    {formatSubStatus(j.sub_status, j.plan_month) ?? "—"}
                  </span>
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                    style={{ backgroundColor: STATUS_COLOR[j.status] }}
                  >
                    {STATUS_LABEL[j.status]}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------- ขนาดขอบกระดาษ ---------- */}
      <div className="no-print space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-1">
            <div className="text-sm font-semibold">ขนาดขอบกระดาษ</div>
            <p className="text-xs text-muted-foreground">
              หน่วยนิ้ว · ใช้ตอนกด “ปริ้นตารางบอร์ดงาน / PDF”
            </p>
          </div>

          {MARGIN_SIDES.map(({ key, label }) => (
            <div key={key}>
              <label
                htmlFor={`pt-m-${key}`}
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                {label}
              </label>
              <input
                id={`pt-m-${key}`}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                max={MAX_MARGIN_IN}
                value={margins[key]}
                onChange={(e) =>
                  setMargins((prev) => ({ ...prev, [key as Side]: e.target.value }))
                }
                className={`${inputCls} w-24`}
              />
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                = {mm(mIn[key]).toFixed(2)} มม.
              </p>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setMargins(DEFAULT_MARGINS)}
            disabled={atDefaultMargins}
            className="mb-[1.35rem] rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-40"
          >
            ↺ รีเซ็ตเป็นค่าเริ่มต้น ({DEFAULT_MARGIN_IN}”)
          </button>
        </div>

        <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
          <p>
            พื้นที่พิมพ์ต่อหน้า{" "}
            <b className="text-foreground">
              {fmtMm(paper.w)} × {fmtMm(paper.h)} มม.
            </b>{" "}
            (A4 {ORIENTATION_LABEL[orientation]}) · ตัวอักษร {fontPt}pt
          </p>
          <p>
            💡 ตอนกด Ctrl+P ให้ตั้ง “ระยะขอบ / Margins” เป็น{" "}
            <b className="text-foreground">ค่าเริ่มต้น (Default)</b>{" "}
            ไม่งั้นเบราว์เซอร์จะใช้ขอบของตัวเองแทนค่าที่ตั้งไว้ตรงนี้ ·
            และอย่าลืมตั้งแนวกระดาษให้เป็น{" "}
            <b className="text-foreground">{ORIENTATION_LABEL[orientation]}</b>{" "}
            ถ้าเบราว์เซอร์ไม่เปลี่ยนให้เอง
          </p>
        </div>
      </div>

      {/* ---------- ตัวชั่งวัด (นอกจอเสมอ) — ต้องมีก่อน preview เพื่อคำนวณการตัดหน้า ----------
          🚨 ต้องมี no-print: กล่องนี้สูง 0 (ลูกเป็น position:absolute) แต่ space-y-4 ใส่
             margin-top ให้มัน ตอนพิมพ์ margin นั้นจะดันแผ่นแรกลงมา แล้วบรรทัดล่างสุดหลุดหน้า */}
      <div ref={measureRef} className="no-print">
        {pickedJobs.length > 0 && (
          <MeasureTable
            jobs={pickedJobs}
            cols={cols}
            footer={footer}
            orientation={orientation}
          />
        )}
      </div>

      {/* ---------- ตัวอย่างกระดาษ (= สิ่งที่จะถูกพิมพ์) ----------
          render อยู่ใน DOM เสมอ · ซ่อนบนจอด้วย data-open="false"
          แต่ @media print บังคับให้กลับมา — ถ้าใช้ hidden จริงจะพิมพ์ไม่ออก */}
      <div className="pt-preview" data-open={showPreview ? "true" : "false"}>
        {pages.length > 0 && (
          <TableSheets
            pages={pages}
            cols={cols}
            footer={footer}
            orientation={orientation}
          />
        )}
      </div>

      {showPreview && pickedJobs.length === 0 && (
        <p className="no-print rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          ยังไม่ได้ติ๊กงาน — เลือกงานที่จะพิมพ์ก่อน
        </p>
      )}
    </div>
  );
}
