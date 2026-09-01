import { Fragment } from "react";
import type { JobRow } from "@/lib/data/job-constants";
import { FIT_REF_PT } from "./fit-table";
import type { Orientation, TableCol } from "./table-columns";

/**
 * ตารางบอร์ดงาน F.PLN.10 — ตัวกระดาษ (Part D4)
 *
 * 1 แผ่น = A4 1 หน้า (แนวตั้งหรือแนวนอนตามจำนวนคอลัมน์ขนาดบรรจุ) · หัวตารางซ้ำทุกหน้า
 * จำนวนแถวต่อหน้า **ไม่ได้ fix ไว้** — print-table-view.tsx วัดความสูงจริงของทุกแถวแล้วค่อยตัดหน้า
 *
 * 🚨 CSS พิมพ์อยู่ในไฟล์นี้ ไม่ใช่ globals.css — @page เป็น global ถ้าเอาไปรวมจะทับกับ eBR/ใบแจ้งผลิต
 * 🚨 ตัว @page เองอยู่ที่ print-table-view.tsx (ต้อง build เป็น string เพราะ var() ใช้ใน @page ไม่ได้)
 *    และตั้งแต่รอบแก้ที่ 1 มันคือ margin: 0 เสมอ — ขอบกระดาษจริงมาจาก padding ของ .pt-sheet ที่นี่
 *    เหตุผล: Chrome พิมพ์ชื่อเรื่อง/เวลา/URL ของตัวเองลงใน "พื้นที่ขอบของ @page"
 *    ไม่เหลือขอบให้ = ไม่มีที่พิมพ์ = หัว/ท้ายของเบราว์เซอร์หายไปเอง
 *    ไฟล์นี้รับค่าผ่าน --pt-mt/-mr/-mb/-ml และ --pt-fs
 */

const TABLE_PRINT_CSS = `
/* ---------- 1 แผ่น = A4 1 หน้า (เต็มแผ่น ไม่หักขอบ) ----------
   ขอบ 4 ด้านที่ผู้ใช้ตั้ง = padding ของแผ่น → เลขที่ตั้ง = ระยะขาวจริงบนกระดาษ ไม่มีอะไรซ่อน
   และเป็นตัวเดียวกันทั้งบนจอกับบนกระดาษ (เดิมบนจอวาดด้วย border บนกระดาษใช้ @page คนละทาง)

   🚨 เผื่อ 0.8/1.5mm ไว้เสมอ ห้ามเอาออก: Chrome ปัดขนาดหน้ากระดาษเป็น device pixel ตาม DPI
      ของเครื่องพิมพ์ ถ้าแผ่นสูงเท่าพื้นที่พิมพ์เป๊ะ ๆ เศษที่ปัดจะดันบรรทัดล่างสุด (= F.PLN.10)
      หลุดไปหน้าถัดไปทีละนิด — อาการเดียวกับที่เคยเจอกับใบแจ้งผลิต

   overflow: hidden — แผ่นเป็นกล่องแข็ง ไม่มีอะไรไหลพ้นขอบล่างไปหน้าถัดไปได้ */
.pt-sheet, .pt-measure, .pt-fit {
  box-sizing: border-box;
  border: 0;
  background: #fff;
  color: #000;
  font-family: AngsanaUPC, "Angsana New", CordiaUPC, "Cordia New",
               "TH SarabunPSK", "Times New Roman", serif;
}
.pt-measure, .pt-fit { padding: 0; }
.pt-sheet {
  padding: var(--pt-mt, 0.2in) var(--pt-mr, 0.2in) var(--pt-mb, 0.2in) var(--pt-ml, 0.2in);
  overflow: hidden;
  break-inside: avoid;
}
.pt-sheet[data-o="portrait"]  { width: calc(210mm - 0.8mm); height: calc(297mm - 1.5mm); }
.pt-sheet[data-o="landscape"] { width: calc(297mm - 0.8mm); height: calc(210mm - 1.5mm); }

/* ตัวชั่งวัดทั้ง 2 ตัวต้องกว้างเท่า "พื้นที่ในกรอบ" ของแผ่นเป๊ะ ๆ
   ไม่งั้นความกว้างที่วัดได้กับความสูงแถวที่วัดได้จะโกหกทั้งคู่ */
.pt-measure[data-o="portrait"], .pt-fit[data-o="portrait"] {
  width: calc(210mm - var(--pt-ml, 0.2in) - var(--pt-mr, 0.2in) - 0.8mm);
}
.pt-measure[data-o="landscape"], .pt-fit[data-o="landscape"] {
  width: calc(297mm - var(--pt-ml, 0.2in) - var(--pt-mr, 0.2in) - 0.8mm);
}

/* ตัววัดความสูง "พื้นที่ว่างต่อ 1 หน้า" — ต้องเท่ากับ height ของ .pt-sheet ลบ padding บน/ล่าง
   ตั้งใจให้ JS อ่านความสูงจากตรงนี้แทนที่จะคำนวณ mm→px เอง ตัวเลขจึงแตกจากกระดาษจริงไม่ได้ */
.pt-probe[data-o="portrait"] {
  height: calc(297mm - var(--pt-mt, 0.2in) - var(--pt-mb, 0.2in) - 1.5mm);
}
.pt-probe[data-o="landscape"] {
  height: calc(210mm - var(--pt-mt, 0.2in) - var(--pt-mb, 0.2in) - 1.5mm);
}

/* 🚨 ใช้ ~ ไม่ใช่ + เพราะมีป้าย "หน้า 1 / 3" (ซ่อนตอนพิมพ์) คั่นระหว่างแผ่นอยู่
   display:none ไม่ได้ทำให้ element หายจาก DOM → ตัวถัดไปไม่ใช่ adjacent sibling อีกต่อไป */
.pt-sheet ~ .pt-sheet { break-before: page; }

/* ---------- ตาราง ---------- */
.pt-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: var(--pt-fs, 9pt);
}
/* 🚨 nowrap ทุกช่อง: ข้อมูล 1 ตัว = 1 บรรทัดเสมอ (requirement ของผู้ใช้)
   ตัวที่ยาวเกินช่องจะถูก "บีบให้แคบลง" ด้วย transform ที่ .pt-t ไม่ใช่ตัดบรรทัด/ตัดข้อความทิ้ง */
.pt-table th, .pt-table td {
  border: 1px solid #000;
  padding: 0.7mm 0.8mm;
  /* AngsanaUPC เผื่อช่องไฟบน-ล่างไว้เยอะมาก (line-height ปกติ ~1.45em) แถวเลยสูงเกินจำเป็น
     1.2 คือจุดที่แถวกระชับขึ้นแต่ยังไม่กินวรรณยุกต์/สระบนของไทย (เช่น "เข้าคลัง") */
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
}
.pt-table th { font-weight: 700; }
.pt-table td.pt-left { text-align: left; padding-left: 1.2mm; }

/* ตัวห่อข้อความในช่อง — 2 หน้าที่: ให้ JS วัดความกว้างข้อความจริง และเป็นตัวรับ scaleX ตอนบีบ */
.pt-t { display: inline-block; transform-origin: center; }
.pt-left .pt-t { transform-origin: left; }

/* ท้ายกระดาษ — เฉพาะฟอร์ม "รอแจ้งผลิต" · ต่อจากตารางเลย ไม่ดันไปติดขอบล่าง (ตามต้นแบบ) */
.pt-foot {
  display: flex;
  justify-content: space-between;
  font-size: calc(var(--pt-fs, 9pt) * 0.85);
  margin-top: 2mm;
  padding: 0 0.5mm;
}

/* ---------- ตัวชั่งวัด (นอกจอเสมอ) ----------
   🚨 ห้ามใส่ transform / zoom ครอบตัวนี้เด็ดขาด — getBoundingClientRect() จะคืนค่าที่ถูกสเกลแล้ว */
.pt-measure, .pt-fit { position: absolute; left: -20000px; top: 0; visibility: hidden; }

/* .pt-fit = ตัววัด "ความกว้างข้อความ" · ตรึงขนาดฟอนต์ไว้คงที่เสมอ ไม่ผูกกับ --pt-fs
   เพราะผลการวัดของมันคือ input ที่ใช้คำนวณ --pt-fs — ถ้าผูกกันจะวนไม่จบ (ดู fit-table.ts) */
.pt-fit .pt-table { font-size: ${FIT_REF_PT}pt; }

@media screen {
  .pt-preview { background: #e9e9ec; padding: 6mm; overflow-x: auto; border-radius: 0.75rem; }
  /* ปิดตัวอย่าง = ย้ายออกนอกจอ ไม่ใช่ display:none — ต้องคง layout ไว้ให้วัดความสูงแถวได้ */
  .pt-preview[data-open="false"] {
    position: absolute; left: -20000px; top: 0; width: 320mm; padding: 0; background: none;
  }
  .pt-pagelabel {
    max-width: 297mm;
    margin: 0 auto 1.5mm;
    font-size: 11px;
    color: #5b5b66;
    text-align: center;
  }
  /* บนจอ ขอบกระดาษมาจาก padding เหมือนตอนพิมพ์แล้ว เหลือแค่เส้น/เงาให้เห็นว่าเป็นแผ่นกระดาษ */
  .pt-sheet {
    outline: 1px solid #c9c9d2;
    margin: 0 auto 6mm;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
  }
}

@media print {
  /* 🚨 app-shell ครอบด้วย flex + min-h-screen และ space-y-* ใส่ margin-top ให้ลูกทุกตัว
     ถ้าไม่ล้างทิ้ง แผ่นแรกจะถูกดันลงมา แล้วทุกแผ่นตกไปขึ้นหน้าใหม่ (ได้กระดาษเปล่าคั่น)
     จำกัดขอบเขตด้วย :has(.pt-preview) → มีผลเฉพาะหน้านี้ ไม่กระทบหน้าอื่น */
  body:has(.pt-preview),
  body:has(.pt-preview) > div,
  body:has(.pt-preview) > div > div { display: block !important; min-height: 0 !important; }
  body:has(.pt-preview) main { display: block !important; padding: 0 !important; }
  .pt-page { margin: 0 !important; padding: 0 !important; }
  .pt-preview {
    position: static !important;
    left: auto !important;
    width: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    background: none !important;
    overflow: visible !important;
  }
  /* ล้างเฉพาะของประดับบนจอ — 🚨 padding ของ .pt-sheet คือขอบกระดาษ ห้ามล้าง */
  .pt-sheet { margin: 0; box-shadow: none; outline: 0; }
  .pt-pagelabel, .pt-measure, .pt-fit { display: none !important; }
}
`;

/** <style> ของหน้าตารางบอร์ดงาน — ไม่ใส่ prop precedence เพื่อไม่ให้ React hoist ขึ้น head */
export function TablePrintStyle() {
  return <style>{TABLE_PRINT_CSS}</style>;
}

export type PageFooter = { left: string; right: string } | null;

/**
 * ผลของ auto-fit ที่เอามาใช้วาดจริง — null = ยังวัดไม่เสร็จ (เฟรมแรก/SSR) ให้ตกกลับไปใช้ weight
 * `rowScale` คีย์ด้วย job.id เพราะแถวถูกตัดแบ่งหน้าแล้ว index ในหน้าไม่ตรงกับตอนวัด
 */
export type FitApplied = {
  widthPct: number[];
  headScale: number[];
  rowScale: Map<string, number[]>;
} | null;

/** style ของช่อง — ใส่ transform เฉพาะช่องที่ต้องบีบจริง ๆ (ส่วนใหญ่ไม่ต้อง) */
function cellStyle(scale: number | undefined) {
  return scale != null && scale < 1 ? { transform: `scaleX(${scale})` } : undefined;
}

/* ============================================================
   ตัวตาราง
   ============================================================ */
function TableBlock({
  cols,
  rows,
  fit,
}: {
  cols: TableCol[];
  rows: JobRow[];
  fit: FitApplied;
}) {
  /* ก่อนวัดเสร็จ: normalize น้ำหนัก → % รวม 100 เสมอ แม้ตัดคอลัมน์ขนาดบรรจุออกไปแล้ว

     🚨 เช็กจำนวนคอลัมน์ให้ตรงกันก่อนใช้ผล fit เสมอ — ผลของรอบก่อน (เช่นตอนยังมีขนาดบรรจุ 3 ช่อง)
        มีสิทธิ์ค้างมาถึงเฟรมที่คอลัมน์เปลี่ยนไปแล้ว แล้ว widthPct[i] จะเป็น undefined
        → .toFixed() ระเบิดทั้งหน้า (เจอจริงตอนทดสอบ) */
  const usable = fit && fit.widthPct.length === cols.length ? fit : null;
  const total = cols.reduce((sum, c) => sum + c.weight, 0) || 1;
  const widthOf = (i: number) =>
    usable ? usable.widthPct[i] : (cols[i].weight / total) * 100;

  return (
    <table className="pt-table">
      <colgroup>
        {cols.map((c, i) => (
          <col key={c.key} style={{ width: `${widthOf(i).toFixed(3)}%` }} />
        ))}
      </colgroup>
      {/* ตัดหน้าเองแล้ว ทุกแผ่นจึงมี <thead> ของตัวเอง → หัวตารางซ้ำทุกหน้าโดยอัตโนมัติ */}
      <thead>
        <tr>
          {cols.map((c, i) => (
            <th key={c.key}>
              <span className="pt-t" style={cellStyle(usable?.headScale[i])}>
                {c.header}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((j) => {
          const scales = usable?.rowScale.get(j.id);
          return (
            <tr key={j.id}>
              {cols.map((c, i) => (
                <td key={c.key} className={c.left ? "pt-left" : undefined}>
                  <span className="pt-t" style={cellStyle(scales?.[i])}>
                    {c.value(j)}
                  </span>
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Foot({ footer }: { footer: PageFooter }) {
  if (!footer) return null;
  return (
    <div className="pt-foot">
      <span>{footer.left}</span>
      <span>{footer.right}</span>
    </div>
  );
}

/* ============================================================
   ตัวชั่งวัดที่ 1 — ความกว้างข้อความจริงของทุกช่อง (ขนาดฟอนต์คงที่ FIT_REF_PT)
   print-table-view.tsx อ่าน .pt-t ทุกตัวจากตรงนี้ไปคำนวณขนาดฟอนต์ + ความกว้างคอลัมน์
   🔑 ส่ง fit={null} เสมอ — ตัววัดต้องไม่ถูกผลของตัวเองย้อนกลับมาเปลี่ยน
   ============================================================ */
export function FitProbe({
  jobs,
  cols,
  orientation,
}: {
  jobs: JobRow[];
  cols: TableCol[];
  orientation: Orientation;
}) {
  return (
    <div className="pt-fit" data-o={orientation} aria-hidden="true">
      <TableBlock cols={cols} rows={jobs} fit={null} />
    </div>
  );
}

/* ============================================================
   ตัวชั่งวัดที่ 2 — ความสูงแถวที่ขนาดฟอนต์/ความกว้างจริง (ตารางเดียวยาว ๆ)
   print-table-view.tsx อ่านความสูงจากตรงนี้ไปตัดหน้า
   ============================================================ */
export function MeasureTable({
  jobs,
  cols,
  footer,
  orientation,
  fit,
}: {
  jobs: JobRow[];
  cols: TableCol[];
  footer: PageFooter;
  orientation: Orientation;
  fit: FitApplied;
}) {
  return (
    <div className="pt-measure" data-o={orientation} aria-hidden="true">
      <div className="pt-probe" data-o={orientation} />
      <TableBlock cols={cols} rows={jobs} fit={fit} />
      <Foot footer={footer} />
    </div>
  );
}

/* ============================================================
   ประกอบเป็นแผ่น — หน้าละ 1 แผ่น
   ============================================================ */
export function TableSheets({
  pages,
  cols,
  footer,
  orientation,
  fit,
}: {
  /** งานที่ตัดหน้าไว้แล้ว — pages[i] = แถวของแผ่นที่ i */
  pages: JobRow[][];
  cols: TableCol[];
  footer: PageFooter;
  orientation: Orientation;
  fit: FitApplied;
}) {
  return (
    <>
      {pages.map((rows, i) => (
        <Fragment key={rows[0]?.id ?? i}>
          {/* ป้ายบอกหน้า — บนจอเท่านั้น ตอนพิมพ์ถูกซ่อน */}
          <div className="pt-pagelabel">
            หน้า {i + 1} / {pages.length}
          </div>
          <div className="pt-sheet" data-o={orientation}>
            <TableBlock cols={cols} rows={rows} fit={fit} />
            <Foot footer={footer} />
          </div>
        </Fragment>
      ))}
    </>
  );
}
