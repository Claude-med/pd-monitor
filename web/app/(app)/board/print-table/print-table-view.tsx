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
  MARGIN_SIDES,
  MAX_MARGIN_IN,
  TABLE_DEFAULT_MARGINS,
  TABLE_DEFAULT_MARGIN_IN,
  fmtMm,
  isDefaultMargins,
  mm,
  toInches,
  type Margins,
  type Side,
} from "@/lib/print/paper-margins";
import {
  AUTO_FONT_RANGE,
  FONT_STEP_PT,
  MANUAL_FONT_RANGE,
  TABLE_FORMATS,
  columnsFor,
  footerFor,
  maxPackOf,
  orientationFor,
  type TableFormat,
} from "./table-columns";
import { FIT_REF_PT, fitTable } from "./fit-table";
import {
  FitProbe,
  MeasureTable,
  TablePrintStyle,
  TableSheets,
  type FitApplied,
} from "./table-sheet";

const inputCls =
  "rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

/** ระดับความละเอียดของตัวกรอง C.P.O DATE */
type CpoMode = "" | "year" | "month" | "day";

const ORIENTATION_LABEL = { portrait: "แนวตั้ง", landscape: "แนวนอน" } as const;

/** identity คงที่ — ใช้เป็นค่าว่างของ pages โดยไม่สร้าง array ใหม่ทุก render */
const NO_PAGES: JobRow[][] = [];

/** ขนาดฟอนต์ก่อนวัดเสร็จ (เฟรมแรก) — แค่กันตารางกระพริบตัวจิ๋ว ไม่ใช่ค่าที่พิมพ์จริง */
const INITIAL_FONT_PT = 9;

/** ผลของ auto-fit + ลายเซ็นของสิ่งที่ใช้คิด (ดู fitSig) */
type FitState = {
  sig: string;
  fit: FitApplied;
  fontPt: number;
  /** ขนาดที่ auto คำนวณได้ — โชว์ตอนผู้ใช้ปรับเอง */
  autoPt: number;
  squeezed: number;
};

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

  /**
   * ขอบกระดาษ 4 ด้าน (นิ้ว) — ไม่จำข้ามครั้ง เปิดหน้าใหม่เริ่มที่ 0.2" (5.08mm) เสมอ
   * บางกว่าใบแจ้งผลิตโดยตั้งใจ: ตารางนี้ต้องการที่ให้ตัวหนังสือมากที่สุด
   */
  const [margins, setMargins] = useState<Margins>(TABLE_DEFAULT_MARGINS);

  /** ขนาดฟอนต์ที่ผู้ใช้กด −/+ เอง · null = ปล่อยให้ auto-fit คิดให้ */
  const [fontOverride, setFontOverride] = useState<number | null>(null);

  /** ผลของ auto-fit (ขนาดฟอนต์ + ความกว้างคอลัมน์ + ช่องที่ต้องบีบ) */
  const [fitState, setFitState] = useState<FitState>({
    sig: "",
    fit: null,
    fontPt: INITIAL_FONT_PT,
    autoPt: INITIAL_FONT_PT,
    squeezed: 0,
  });

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

  /** ผลวัดดิบของ .pt-fit — cache ไว้เพื่อให้กด −/+ ขนาดฟอนต์แล้วคิดใหม่ได้โดยไม่ต้องแตะ DOM */
  const rawRef = useRef<{
    sig: string;
    textPx: number[][];
    fixedPx: number[];
    availPx: number;
  } | null>(null);

  const mIn = useMemo(() => toInches(margins), [margins]);
  const atDefaultMargins = isDefaultMargins(margins, TABLE_DEFAULT_MARGIN_IN);

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
     รวมเป็น memo เดียวเพราะทุกค่าผูกกันหมด (จำนวนช่องขนาดบรรจุ → คอลัมน์ → แนวกระดาษ)
     และ sig ต้องคิดจากชุดเดียวกันเป๊ะ ไม่งั้น "ผลที่วัดไว้" กับ "สิ่งที่กำลังโชว์" หลุดจากกันได้
     ขนาดฟอนต์ไม่ได้อยู่ในนี้แล้ว — มาจาก auto-fit ที่ต้องวัด DOM ก่อน (ดู fitSig ข้างล่าง) */
  const layout = useMemo(() => {
    const maxPack = maxPackOf(pickedJobs);
    return {
      maxPack,
      cols: columnsFor(format, maxPack),
      orientation: orientationFor(format, maxPack),
      footer: footerFor(format),
      /** ลายเซ็นของทุกอย่างที่ทำให้ต้องวัด/คิดใหม่ทั้งชุด (auto-fit ต่อด้วยการตัดหน้า) */
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

  const { maxPack, cols, orientation, footer } = layout;
  const paper = orientationOfPaper(orientation);

  /** ลายเซ็นของ auto-fit = ทุกอย่างที่ทำให้ขนาดฟอนต์/ความกว้างคอลัมน์เปลี่ยน */
  const fitSig = `${layout.sig}|${fontOverride ?? "auto"}`;
  const fitReady = fitState.sig === fitSig;
  const fontPt = fitState.fontPt;
  /** ลายเซ็นของผลตัดหน้า — ต้องรวมขนาดฟอนต์ด้วย เพราะตัวโตขึ้น = แถวสูงขึ้น = จำนวนหน้าเปลี่ยน */
  const pageSig = `${fitSig}|${fontPt}`;

  /* ============================================================
     auto-fit — "ตัวใหญ่ที่สุดเท่าที่ทุกช่องยังอยู่บรรทัดเดียว"

     วัดความกว้างข้อความจริงของทุกช่องจาก .pt-fit ครั้งเดียว (ที่ขนาดคงที่ FIT_REF_PT)
     แล้วคำนวณย้อนกลับเป็นขนาดฟอนต์ + ความกว้างคอลัมน์ + ช่องที่ต้องบีบ — คณิตศาสตร์อยู่ใน fit-table.ts
     🔑 ทิศทางเดียว: fit (กว้าง) → paginate (สูง) · ห้ามให้ผลของ fit ย้อนกลับไปเป็น input ของตัวเอง
     ============================================================ */

  /** อ่านความกว้างข้อความของทุกช่องจาก .pt-fit · null = DOM ยังเป็นของรอบก่อน (ยังวัดไม่ได้) */
  const readFitProbe = useCallback(() => {
    const box = measureRef.current?.querySelector<HTMLElement>(".pt-fit");
    const table = box?.querySelector<HTMLElement>("table");
    if (!box || !table) return null;

    const heads = [...table.querySelectorAll<HTMLElement>("thead th .pt-t")];
    const bodyRows = [...table.querySelectorAll<HTMLElement>("tbody tr")];
    if (heads.length !== cols.length || bodyRows.length !== pickedJobs.length) return null;
    if (bodyRows.length === 0) return null;

    // −1 = ขอบนอกของตาราง (border-collapse) ที่ไม่ได้เป็นของคอลัมน์ไหน
    const availPx = box.getBoundingClientRect().width - 1;
    if (availPx <= 0) return null;

    const textPx: number[][] = [heads.map((el) => el.getBoundingClientRect().width)];
    for (const tr of bodyRows) {
      const spans = [...tr.querySelectorAll<HTMLElement>(".pt-t")];
      if (spans.length !== cols.length) return null;
      textPx.push(spans.map((el) => el.getBoundingClientRect().width));
    }
    // ตอนพิมพ์ .pt-fit ถูก display:none → ทุกค่าเป็น 0 · คงผลรอบก่อนไว้ ดีกว่าล้างทิ้ง
    if (textPx[0].every((w) => w <= 0)) return null;

    /* padding + เส้นขอบของแต่ละคอลัมน์ = ส่วนที่ "ไม่ยืด" ตามขนาดฟอนต์
       อ่านจากช่องจริงแทนการ hard-code ค่า mm ซ้ำไว้อีกที่ (แก้ CSS แล้วตรงนี้ตามเองเสมอ)
       +1 = เส้นขอบที่ border-collapse ให้คอลัมน์ใช้ร่วมกันคอลัมน์ละเส้น */
    const firstCells = [...bodyRows[0].children] as HTMLElement[];
    if (firstCells.length !== cols.length) return null;
    const fixedPx = firstCells.map((td) => {
      const cs = getComputedStyle(td);
      return (
        (Number.parseFloat(cs.paddingLeft) || 0) +
        (Number.parseFloat(cs.paddingRight) || 0) +
        1
      );
    });

    return { textPx, fixedPx, availPx };
  }, [cols.length, pickedJobs.length]);

  const computeFit = useCallback(() => {
    if (pickedJobs.length === 0) {
      setFitState((prev) =>
        prev.sig === fitSig ? prev : { ...prev, sig: fitSig, fit: null, squeezed: 0 },
      );
      return;
    }

    // ผลวัดเดิมใช้ซ้ำได้ถ้าข้อมูล/คอลัมน์/ขอบยังเดิม → กด −/+ ขนาดฟอนต์ ไม่ต้องวัด DOM ใหม่
    let raw = rawRef.current;
    if (!raw || raw.sig !== layout.sig) {
      const m = readFitProbe();
      if (!m) return;
      raw = { sig: layout.sig, ...m };
      rawRef.current = raw;
    }

    const res = fitTable({
      textPx: raw.textPx,
      fixedPx: raw.fixedPx,
      availPx: raw.availPx,
      refPt: FIT_REF_PT,
      minPt: AUTO_FONT_RANGE.min,
      maxPt: AUTO_FONT_RANGE.max,
      forcedPt: fontOverride,
    });
    if (!res) return;

    // scaleX[0] = หัวตาราง · แถวข้อมูลคีย์ด้วย job.id เพราะหลังตัดหน้า index ไม่ตรงกับตอนวัด
    const rowScale = new Map<string, number[]>();
    pickedJobs.forEach((j, i) => rowScale.set(j.id, res.scaleX[i + 1]));

    const next: FitState = {
      sig: fitSig,
      fit: { widthPct: res.widthPct, headScale: res.scaleX[0], rowScale },
      fontPt: res.fontPt,
      autoPt: res.autoPt,
      squeezed: res.squeezed,
    };
    // 🚨 เทียบลายเซ็นก่อนเซ็ตเสมอ — setState ใน useLayoutEffect ที่ไม่เทียบจะวนไม่จบ
    setFitState((prev) => (prev.sig === next.sig ? prev : next));
  }, [pickedJobs, layout.sig, fitSig, fontOverride, readFitProbe]);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    computeFit();
  }, [computeFit]);

  /* ============================================================
     ตัดหน้า — วัดความสูงจริงของทุกแถวก่อน แล้วค่อยจัดลงหน้า

     ชื่อยาไทย/อังกฤษยาวไม่เท่ากัน แถวจึงตีบรรทัดไม่เท่ากัน จะ fix ว่า "หน้าละ N แถว" ไม่ได้
     แยก pass อ่าน/เขียนให้ชัด แบบเดียวกับ fitSheets() ของใบแจ้งผลิต
     ============================================================ */

  /** อ่าน DOM แล้วคืนผลการตัดหน้า · null = ยังวัดไม่ได้ (ให้คงผลรอบก่อนไว้) */
  const measurePages = useCallback((): JobRow[][] | null => {
    if (pickedJobs.length === 0) return NO_PAGES;
    // ยังไม่รู้ขนาดฟอนต์/ความกว้างคอลัมน์ของรอบนี้ = ความสูงแถวที่วัดได้จะเป็นของรอบก่อน
    if (!fitReady) return null;
    const root = measureRef.current;
    if (!root) return null;

    /* 🚨 ต้องเจาะเข้า .pt-measure ก่อนเสมอ — ในกล่องวัดมี 2 ตาราง (.pt-fit อีกตัว)
       querySelector("table") เฉย ๆ จะไปโดนตารางของ .pt-fit ที่ขนาดฟอนต์คนละตัว */
    const box = root.querySelector<HTMLElement>(".pt-measure");
    if (!box) return null;

    const probe = box.querySelector<HTMLElement>(".pt-probe");
    const table = box.querySelector<HTMLElement>("table");
    const thead = box.querySelector<HTMLElement>("thead");
    const foot = box.querySelector<HTMLElement>(".pt-foot");
    const trs = [...box.querySelectorAll<HTMLElement>("tbody tr")];
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
  }, [pickedJobs, fitReady]);

  const paginate = useCallback(() => {
    const next = measurePages();
    if (next === null) return;
    // 🚨 เทียบก่อนเซ็ตเสมอ — setState ใน useLayoutEffect ที่ไม่เทียบจะวนไม่จบ
    setPaged((prev) =>
      prev.sig === pageSig && samePages(prev.list, next)
        ? prev
        : { sig: pageSig, list: next },
    );
  }, [measurePages, pageSig]);

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
  const pages = paged.sig === pageSig ? paged.list : NO_PAGES;

  useEffect(() => {
    /* ฟอนต์ AngsanaUPC โหลดช้ากว่า layout รอบแรก → ทั้งความกว้างข้อความและความสูงแถวเปลี่ยน
       ต้องทิ้งผลวัดที่ cache ไว้แล้ววัดใหม่ทั้ง 2 ชั้น ไม่ใช่แค่ตัดหน้าใหม่ */
    const remeasure = () => {
      rawRef.current = null;
      computeFit();
      paginate();
    };
    document.fonts?.ready.then(remeasure).catch(() => {});
    // กัน Ctrl+P ตอนที่ยังไม่เคยเปิดตัวอย่าง
    window.addEventListener("beforeprint", remeasure);
    return () => window.removeEventListener("beforeprint", remeasure);
  }, [computeFit, paginate]);

  /* ============================================================
     ปุ่มต่าง ๆ
     ============================================================ */
  /** −/+ ขนาดตัวอักษร · ก้าวแรกเริ่มจากขนาดที่เห็นอยู่ (ที่ auto คิดให้) แล้วค่อยล็อกเป็นของผู้ใช้ */
  function stepFont(dir: 1 | -1) {
    setFontOverride((prev) => {
      const base = prev ?? fitState.fontPt;
      const next = Math.round((base + dir * FONT_STEP_PT) * 10) / 10;
      return Math.min(MANUAL_FONT_RANGE.max, Math.max(MANUAL_FONT_RANGE.min, next));
    });
  }

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
          แนวกระดาษก็อยู่ตรงนี้ เพราะเปลี่ยนตามจำนวนคอลัมน์ขนาดบรรจุ

          🚨 margin: 0 เสมอ ห้ามเอาขอบของผู้ใช้มาใส่ตรงนี้ — Chrome พิมพ์ชื่อเรื่อง/เวลา/URL
             ของตัวเองลงใน "พื้นที่ขอบของ @page" ไม่เหลือขอบให้ = ไม่มีที่พิมพ์ = หายไปเอง
             ขอบจริงไปอยู่ที่ padding ของ .pt-sheet แทน (ดู table-sheet.tsx) */}
      <style>{`@page { size: A4 ${orientation}; margin: 0; }`}</style>

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

      {/* ---------- ขนาดตัวอักษร + ขอบกระดาษ ---------- */}
      <div className="no-print space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3 border-b pb-3">
          <div className="mr-1">
            <div className="text-sm font-semibold">ขนาดตัวอักษรในตาราง</div>
            <p className="text-xs text-muted-foreground">
              ปกติระบบเลือกตัวที่ใหญ่ที่สุดเท่าที่ทุกช่องยังอยู่บรรทัดเดียวให้เอง
            </p>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepFont(-1)}
              disabled={fontPt <= MANUAL_FONT_RANGE.min}
              aria-label="ลดขนาดตัวอักษร"
              className="h-10 w-10 rounded-md border text-lg leading-none hover:bg-accent disabled:opacity-40"
            >
              −
            </button>
            <span className="w-20 text-center text-sm font-semibold tabular-nums">
              {fontPt} pt
            </span>
            <button
              type="button"
              onClick={() => stepFont(1)}
              disabled={fontPt >= MANUAL_FONT_RANGE.max}
              aria-label="เพิ่มขนาดตัวอักษร"
              className="h-10 w-10 rounded-md border text-lg leading-none hover:bg-accent disabled:opacity-40"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setFontOverride(null)}
              disabled={fontOverride === null}
              className="ml-1 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-40"
            >
              ↺ อัตโนมัติ
            </button>
          </div>

          <p className="mb-2 text-xs text-muted-foreground">
            {fontOverride === null
              ? "อัตโนมัติ"
              : `ปรับเอง · อัตโนมัติจะได้ ${fitState.autoPt}pt`}
            {fitState.squeezed > 0
              ? ` · บีบให้พอดีช่อง ${fitState.squeezed} ช่อง`
              : ""}
          </p>
        </div>

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
            onClick={() => setMargins(TABLE_DEFAULT_MARGINS)}
            disabled={atDefaultMargins}
            className="mb-[1.35rem] rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-40"
          >
            ↺ รีเซ็ตเป็นค่าเริ่มต้น ({TABLE_DEFAULT_MARGIN_IN}”)
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
            <b className="text-foreground">ค่าเริ่มต้น (Default)</b> และ “ขนาด / Scale”
            เป็น <b className="text-foreground">100%</b> — ขอบกระดาษถูกฝังมากับแผ่นแล้ว
            เลขที่ตั้งตรงนี้จึงเป็นระยะขาวจริงบนกระดาษ · อย่าลืมตั้งแนวกระดาษเป็น{" "}
            <b className="text-foreground">{ORIENTATION_LABEL[orientation]}</b>{" "}
            ถ้าเบราว์เซอร์ไม่เปลี่ยนให้เอง
          </p>
          <p>
            🖨️ เครื่องพิมพ์ส่วนใหญ่พิมพ์ชิดขอบกระดาษได้ไม่เกิน ~4 มม. — ตั้งขอบต่ำกว่านั้น
            เบราว์เซอร์อาจย่อทั้งหน้าลงให้พอดีพื้นที่พิมพ์ ระยะที่ตั้งไว้จะไม่ตรงของจริง
          </p>
          <p>
            ถ้ายังเห็นชื่อเรื่อง / เวลา / URL โผล่บนกระดาษ ให้เอาติ๊ก{" "}
            <b className="text-foreground">“หัวและท้ายกระดาษ (Headers and footers)”</b>{" "}
            ออกในหน้าต่างปริ้น
          </p>
        </div>
      </div>

      {/* ---------- ตัวชั่งวัด (นอกจอเสมอ) — ต้องมีก่อน preview เพื่อคำนวณการตัดหน้า ----------
          🚨 ต้องมี no-print: กล่องนี้สูง 0 (ลูกเป็น position:absolute) แต่ space-y-4 ใส่
             margin-top ให้มัน ตอนพิมพ์ margin นั้นจะดันแผ่นแรกลงมา แล้วบรรทัดล่างสุดหลุดหน้า */}
      <div ref={measureRef} className="no-print">
        {pickedJobs.length > 0 && (
          <>
            {/* วัดความกว้างข้อความ (ขนาดฟอนต์คงที่) → ได้ขนาดฟอนต์ + ความกว้างคอลัมน์ */}
            <FitProbe jobs={pickedJobs} cols={cols} orientation={orientation} />
            {/* แล้วค่อยวัดความสูงแถวที่ขนาดจริง → ตัดหน้า */}
            <MeasureTable
              jobs={pickedJobs}
              cols={cols}
              footer={footer}
              orientation={orientation}
              fit={fitReady ? fitState.fit : null}
            />
          </>
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
            fit={fitReady ? fitState.fit : null}
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
