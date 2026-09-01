import { Fragment } from "react";
import type { JobRow } from "@/lib/data/job-constants";
import type { Orientation, TableCol } from "./table-columns";

/**
 * ตารางบอร์ดงาน F.PLN.10 — ตัวกระดาษ (Part D4)
 *
 * 1 แผ่น = A4 1 หน้า (แนวตั้งหรือแนวนอนตามจำนวนคอลัมน์ขนาดบรรจุ) · หัวตารางซ้ำทุกหน้า
 * จำนวนแถวต่อหน้า **ไม่ได้ fix ไว้** — print-table-view.tsx วัดความสูงจริงของทุกแถวแล้วค่อยตัดหน้า
 * (ชื่อยายาวไม่เท่ากัน แถวตีบรรทัดไม่เท่ากัน จะเดาว่าหน้าละ N แถวไม่ได้)
 *
 * 🚨 CSS พิมพ์อยู่ในไฟล์นี้ ไม่ใช่ globals.css — @page เป็น global ถ้าเอาไปรวมจะทับกับ eBR/ใบแจ้งผลิต
 * 🚨 ตัว @page เองอยู่ที่ print-table-view.tsx เพราะทั้งแนวกระดาษและขอบ 4 ด้านมาจาก state
 *    (var() ใช้ใน @page ไม่ได้ — Chrome ไม่รับ) ไฟล์นี้รับค่าผ่าน --pt-mt/-mr/-mb/-ml และ --pt-fs
 */

const TABLE_PRINT_CSS = `
/* ---------- 1 แผ่น = A4 1 หน้า ----------
   ไม่มี padding ในตัวแผ่น — เลขขอบ 4 ด้านที่ผู้ใช้ตั้ง = ระยะขาวจริงบนกระดาษ ไม่มีอะไรซ่อน

   🚨 เผื่อ 0.8/1.5mm ไว้เสมอ ห้ามเอาออก: Chrome ปัดขนาดหน้ากระดาษเป็น device pixel ตาม DPI
      ของเครื่องพิมพ์ ถ้าแผ่นสูงเท่าพื้นที่พิมพ์เป๊ะ ๆ เศษที่ปัดจะดันบรรทัดล่างสุด (= F.PLN.10)
      หลุดไปหน้าถัดไปทีละนิด — อาการเดียวกับที่เคยเจอกับใบแจ้งผลิต

   overflow: hidden — แผ่นเป็นกล่องแข็ง ไม่มีอะไรไหลพ้นขอบล่างไปหน้าถัดไปได้ */
.pt-sheet, .pt-measure {
  box-sizing: border-box;
  padding: 0;
  border: 0;
  background: #fff;
  color: #000;
  font-family: AngsanaUPC, "Angsana New", CordiaUPC, "Cordia New",
               "TH SarabunPSK", "Times New Roman", serif;
}
.pt-sheet[data-o="portrait"], .pt-measure[data-o="portrait"] {
  width: calc(210mm - var(--pt-ml, 0.32in) - var(--pt-mr, 0.32in) - 0.8mm);
}
.pt-sheet[data-o="landscape"], .pt-measure[data-o="landscape"] {
  width: calc(297mm - var(--pt-ml, 0.32in) - var(--pt-mr, 0.32in) - 0.8mm);
}
.pt-sheet[data-o="portrait"] {
  height: calc(297mm - var(--pt-mt, 0.32in) - var(--pt-mb, 0.32in) - 1.5mm);
}
.pt-sheet[data-o="landscape"] {
  height: calc(210mm - var(--pt-mt, 0.32in) - var(--pt-mb, 0.32in) - 1.5mm);
}
.pt-sheet { overflow: hidden; break-inside: avoid; }

/* ตัววัดความสูง "พื้นที่ว่างต่อ 1 หน้า" — ใช้สูตร calc ชุดเดียวกับ .pt-sheet เป๊ะ ๆ
   ตั้งใจให้ JS อ่านความสูงจากตรงนี้แทนที่จะคำนวณ mm→px เอง ตัวเลขจึงแตกจากกระดาษจริงไม่ได้ */
.pt-probe[data-o="portrait"] {
  height: calc(297mm - var(--pt-mt, 0.32in) - var(--pt-mb, 0.32in) - 1.5mm);
}
.pt-probe[data-o="landscape"] {
  height: calc(210mm - var(--pt-mt, 0.32in) - var(--pt-mb, 0.32in) - 1.5mm);
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
.pt-table th, .pt-table td {
  border: 1px solid #000;
  padding: 1mm 0.9mm;
  text-align: center;
  word-wrap: break-word;
  overflow-wrap: anywhere;
}
.pt-table th { font-weight: 700; }
.pt-table td.pt-left { text-align: left; padding-left: 1.5mm; }

/* ท้ายกระดาษ — เฉพาะฟอร์ม "รอแจ้งผลิต" · ต่อจากตารางเลย ไม่ดันไปติดขอบล่าง (ตามต้นแบบ) */
.pt-foot {
  display: flex;
  justify-content: space-between;
  font-size: 8pt;
  margin-top: 2mm;
  padding: 0 0.5mm;
}

/* ---------- ตัวชั่งวัด (นอกจอเสมอ) ----------
   ต้องกว้างเท่ากับตารางบนกระดาษจริงเป๊ะ ๆ ไม่งั้นแถวตีบรรทัดคนละแบบ แล้วเลขที่วัดได้จะโกหก
   🚨 ห้ามใส่ transform / zoom ครอบตัวนี้เด็ดขาด — getBoundingClientRect() จะคืนค่าที่ถูกสเกลแล้ว */
.pt-measure { position: absolute; left: -20000px; top: 0; visibility: hidden; }

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
  /* วาดพื้นที่ "ขอบ" เป็นสีขาวรอบแผ่น → บนจอได้กระดาษ A4 เต็มตามค่าที่ตั้งจริง
     ใช้ border + content-box แทน div ครอบ เพราะกฎ .pt-sheet ~ .pt-sheet ข้างบนเป็น sibling selector */
  .pt-sheet {
    box-sizing: content-box;
    border-top: var(--pt-mt, 0.32in) solid #fff;
    border-right: var(--pt-mr, 0.32in) solid #fff;
    border-bottom: var(--pt-mb, 0.32in) solid #fff;
    border-left: var(--pt-ml, 0.32in) solid #fff;
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
  /* ล้างขอบขาวที่วาดไว้เฉพาะบนจอ — ตอนพิมพ์ ขอบมาจาก @page ไม่ใช่ border */
  .pt-sheet { margin: 0; box-shadow: none; border: 0; outline: 0; box-sizing: border-box; }
  .pt-pagelabel, .pt-measure { display: none !important; }
}
`;

/** <style> ของหน้าตารางบอร์ดงาน — ไม่ใส่ prop precedence เพื่อไม่ให้ React hoist ขึ้น head */
export function TablePrintStyle() {
  return <style>{TABLE_PRINT_CSS}</style>;
}

export type PageFooter = { left: string; right: string } | null;

/* ============================================================
   ตัวตาราง
   ============================================================ */
function TableBlock({ cols, rows }: { cols: TableCol[]; rows: JobRow[] }) {
  // normalize น้ำหนัก → % รวม 100 เสมอ แม้ตัดคอลัมน์ขนาดบรรจุออกไปแล้ว
  const total = cols.reduce((sum, c) => sum + c.weight, 0) || 1;
  return (
    <table className="pt-table">
      <colgroup>
        {cols.map((c) => (
          <col
            key={c.key}
            style={{ width: `${((c.weight / total) * 100).toFixed(3)}%` }}
          />
        ))}
      </colgroup>
      {/* ตัดหน้าเองแล้ว ทุกแผ่นจึงมี <thead> ของตัวเอง → หัวตารางซ้ำทุกหน้าโดยอัตโนมัติ */}
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.key}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((j) => (
          <tr key={j.id}>
            {cols.map((c) => (
              <td key={c.key} className={c.left ? "pt-left" : undefined}>
                {c.value(j)}
              </td>
            ))}
          </tr>
        ))}
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
   ตัวชั่งวัด — ตารางเดียวยาว ๆ ที่ความกว้างจริงบนกระดาษ
   print-table-view.tsx อ่านความสูงจากตรงนี้ไปตัดหน้า
   ============================================================ */
export function MeasureTable({
  jobs,
  cols,
  footer,
  orientation,
}: {
  jobs: JobRow[];
  cols: TableCol[];
  footer: PageFooter;
  orientation: Orientation;
}) {
  return (
    <div className="pt-measure" data-o={orientation} aria-hidden="true">
      <div className="pt-probe" data-o={orientation} />
      <TableBlock cols={cols} rows={jobs} />
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
}: {
  /** งานที่ตัดหน้าไว้แล้ว — pages[i] = แถวของแผ่นที่ i */
  pages: JobRow[][];
  cols: TableCol[];
  footer: PageFooter;
  orientation: Orientation;
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
            <TableBlock cols={cols} rows={rows} />
            <Foot footer={footer} />
          </div>
        </Fragment>
      ))}
    </>
  );
}
