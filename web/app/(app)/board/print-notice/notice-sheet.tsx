import type { JobRow } from "@/lib/data/job-constants";
import { dashOr, displayJobNo, fmtDdMmYy, fmtQtyPlain } from "@/lib/format";

/**
 * ใบแจ้งผลิต F.PLN.01 — ตัวกระดาษ (Part D)
 *
 * แปลงตรงจากฟอร์มกระดาษจริงที่ทีมส่งมา 2 ใบ (UMEDA / POND) — ขนาดทุกอย่างเป็น mm
 * เพราะต้องพิมพ์ลง "กระดาษต่อเนื่องเคมีแบบฉีกครึ่ง A4" แล้วช่องต้องตรงกับของเดิม
 *
 * 🚨 หน้าตาในไฟล์นี้ถอดจาก "ภาพสแกนฟอร์มจริง" ทั้ง 2 บริษัท (1 ก.ย. 69) ไม่ใช่ค่าที่คิดเอาเอง
 *    ก่อนแก้ขนาด/น้ำหนัก/เส้นอะไร ให้เทียบภาพต้นฉบับก่อนเสมอ — กติกาที่ยึด:
 *      · ตารางชนขอบกรอบฟอร์มพอดี (เส้นนอกของตาราง = เส้นกรอบ) ไม่มี padding ซ้าย/ขวาคั่น
 *      · หัวฟอร์ม (ชื่อบริษัท/ใบแจ้งผลิต) ไม่มีเส้นคาดใต้
 *      · ช่องเติมมือที่เป็น "วันที่/เลข" = เส้นทึบ · ช่องบรรยาย (หมายเหตุ/ขาด) = เส้นประจุด
 *      · ป้ายกำกับหนา ข้อมูลน้ำหนักปกติ (ต้นฉบับ dot-matrix หนาทั้งใบ แต่ผู้ใช้เลือกแบบนี้)
 *
 * โครง 1 แผ่น = A4 = 2 Job แนวตั้ง สูงเท่ากันเป๊ะ (flex: 1 1 50%) + เส้นประตรงกลางไว้เล็งฉีก
 * 1 Job = "กล่องแข็ง" ขนาดครึ่ง A4 (อยู่ในกรอบ A5 แนวนอน) — ยาวแค่ไหนก็ขยายไม่ได้ ดู .pn-half
 *
 * 🚨 CSS พิมพ์อยู่ในไฟล์นี้ ไม่ใช่ globals.css — @page เป็น global ถ้าเอาไปรวมจะทับกับ eBR
 *    (เหตุผลเต็มอยู่ในคอมเมนต์ globals.css)
 * 🚨 ตัว @page เองอยู่ที่ print-notice-view.tsx และเป็น margin: 0 เสมอ — ขอบกระดาษจริงมาจาก
 *    padding ของ .pn-sheet ที่นี่ (รับผ่าน --pn-mt/--pn-mr/--pn-mb/--pn-ml)
 *    เหตุผล: Chrome พิมพ์ชื่อเรื่อง/เวลา/URL ของตัวเองลงใน "พื้นที่ขอบของ @page"
 *    ไม่เหลือขอบให้ = ไม่มีที่พิมพ์ = หัว/ท้ายของเบราว์เซอร์หายไปเอง (สูตรเดียวกับตารางบอร์ดงาน)
 */

/* ============================================================
   CSS
   ============================================================ */
const NOTICE_PRINT_CSS = `
/* ---------- 1 แผ่น = A4 เต็มใบ (ไม่หักขอบ) ----------
   ขอบ 4 ด้านที่ผู้ใช้ตั้ง = padding ของแผ่น → เลขที่ตั้ง = ระยะขาวจริงบนกระดาษ ไม่มีอะไรซ่อน
   และเป็นตัวเดียวกันทั้งบนจอกับบนกระดาษ (เดิมบนจอวาดด้วย border บนกระดาษใช้ @page คนละทาง)

   🚨 เผื่อ 0.8/1.5mm ไว้เสมอ ห้ามเอาออก: Chrome ปัดขนาดหน้ากระดาษเป็น device pixel ตาม DPI
      ของเครื่องพิมพ์ ถ้าแผ่นสูงเท่าพื้นที่พิมพ์เป๊ะ ๆ เศษที่ปัดจะดันขอบล่างของแผ่น (= บรรทัด
      "วันที่บังคับใช้ · F.PLN.01") หลุดไปหน้าถัดไปทีละนิด — อาการที่ผู้ใช้เจอตอนปริ้นจริง

   overflow: hidden — แผ่นเป็นกล่องแข็ง ไม่มีอะไรไหลพ้นขอบล่างไปหน้าถัดไปได้เลย */
.pn-sheet {
  box-sizing: border-box;
  width: calc(210mm - 0.8mm);
  height: calc(297mm - 1.5mm);
  padding: var(--pn-mt, 0.32in) var(--pn-mr, 0.32in) var(--pn-mb, 0.32in) var(--pn-ml, 0.32in);
  border: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 3mm;
  background: #fff;
  color: #000;
  /* ต้นฉบับเป็นฟอนต์มีหัวตระกูล Angsana (ไทย) + Times (อังกฤษ)
     🚨 ห้ามใส่ Cordia / TH Sarabun กลับเข้ามาใน fallback — เป็นฟอนต์ไม่มีหัว
        เครื่องไหนตกมาใช้จะหน้าตาผิดจากฟอร์มกระดาษทันที */
  font-family: 'AngsanaUPC', 'Angsana New', 'Times New Roman', serif;
  break-inside: avoid;
}
.pn-sheet + .pn-sheet { break-before: page; }

/* 🚨 overflow: hidden = 1 Job เป็น "กล่องแข็ง" ขนาดครึ่งแผ่น ขยายไม่ได้ไม่ว่าข้อความจะตีกี่บรรทัด
   ตัวย่ออัตโนมัติ (print-notice-view.tsx) ทำให้เนื้อหาพอดีกล่องอยู่แล้ว บรรทัดนี้คือ "ตาข่ายกันตก"
   เผื่อกรณีที่ JS วัดพลาด/ยังไม่ทันรัน — ของจะถูกตัดในกล่อง ไม่ไหลไปทับอีกครึ่งหรือหลุดไปหน้าถัดไป
   (ถ้าโดนตัดจริง UI จะขึ้นแถบเตือนพร้อมเลขงาน ไม่ปล่อยให้ข้อมูลหายเงียบ ๆ)
   .pn-fit ชดเชยความกว้างเป็น 100/scale % (เช่น 113%) — กล่องแข็งนี้กันไม่ให้มันโผล่พ้นขอบขวาด้วย */
.pn-half { flex: 1 1 50%; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.pn-tear { border-top: 1px dashed #b0b0b0; }

/* ตัวย่ออัตโนมัติ — JS ใส่ transform/width ให้เมื่อฟอร์มสูงเกินครึ่งแผ่น (ดู print-notice-view.tsx) */
.pn-fit { transform-origin: top left; }

/* ---------- กรอบฟอร์ม ----------
   padding: 0 — ตารางต้องชนขอบกรอบเหมือนต้นฉบับ · บล็อกที่เป็นข้อความเว้นระยะเองด้วย .pn-pad */
.pn-form { border: 1px solid #000; }
.pn-pad { padding-left: 2mm; padding-right: 2mm; }

/* หัวฟอร์ม — 🚨 ไม่มีเส้นคาดใต้ (ต้นฉบับไม่มี) */
.pn-header { text-align: center; padding: 1mm 2mm 0.5mm; }
.pn-company { font-size: 14pt; font-weight: 700; letter-spacing: 1.5px; line-height: 1.15; }
/* POND CHEMICAL COMPANY LIMITED ยาวกว่ามาก — ลดลงหน่อยให้ความยาวบรรทัดใกล้ต้นฉบับ */
.pn-company--wide { font-size: 13pt; }
.pn-title { font-size: 15pt; font-weight: 700; line-height: 1.2; }

/* ---------- แถว REG / LOT ---------- */
.pn-row { display: flex; align-items: flex-end; margin: 0.6mm 0; }
.pn-row .pn-col { display: flex; align-items: flex-end; min-width: 0; }
.pn-label { font-size: 11pt; font-weight: 700; white-space: nowrap; line-height: 1.5; }
/* ช่องเติมมือ (LOT/MFG/EXP) = เส้นทึบ ตามต้นฉบับ */
.pn-fill { flex: 1; border-bottom: 1px solid #000; margin-left: 2mm; min-height: 5mm; }
.pn-regno { font-size: 14.5pt; font-weight: 700; line-height: 1.2; padding: 0 2mm; }
.pn-jobno-label { font-size: 11pt; font-weight: 700; white-space: nowrap; line-height: 1.5; }
/* เลขงานคือของที่เด่นที่สุดบนฟอร์ม — ตัวใหญ่สุดในใบ เส้นใต้ยาวถึงขอบขวาของกรอบ */
.pn-jobno { font-size: 18pt; font-weight: 700; line-height: 1.2; text-align: center; }

/* ---------- ตาราง ----------
   🚨 ตัดเส้นนอกซ้าย/ขวาของตารางทิ้ง แล้วใช้เส้นกรอบฟอร์มแทน — ไม่งั้นได้เส้นคู่ 2px ที่ขอบ
      (ต้นฉบับเป็นเส้นเดียว เพราะตารางกับกรอบเป็นเส้นเดียวกัน) */
.pn-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12pt; }
.pn-table th, .pn-table td {
  border: 1px solid #000;
  padding: 0.8mm 1.2mm;
  text-align: center;
  line-height: 1.25;
  word-break: break-word;
}
.pn-table tr > *:first-child { border-left: 0; }
.pn-table tr > *:last-child { border-right: 0; }
.pn-table th { font-weight: 700; height: 7mm; }
.pn-table td { height: 7.5mm; }
/* แถว "รายการ / รูปร่างลักษณะยา" สูงกว่าแถวอื่น ตามต้นฉบับ */
.pn-table tr.pn-item-row td { height: 11mm; }
/* ชื่อยาอยู่กึ่งกลางช่อง (ต้นฉบับ) · ลักษณะยาชิดซ้าย
   🚨 ต้องเขียนเป็น ".pn-table td.pn-desc" ไม่ใช่ ".pn-desc" เฉย ๆ — กฎ ".pn-table td" ข้างบน
      specificity สูงกว่า class เดี่ยว แล้วจะทับ text-align: left ให้กลายเป็นกึ่งกลาง
      (และห้ามใช้ backtick ในคอมเมนต์นี้ — ทั้งก้อนอยู่ใน template literal จะปิดสตริงกลางคัน) */
.pn-table td.pn-name { font-size: 13pt; }
.pn-table td.pn-name--lg { font-size: 14pt; }
.pn-table td.pn-desc { text-align: left; padding-left: 2.5mm; }

/* ---------- ความพร้อมผลิต — UMEDA ---------- */
.pn-ready-um { display: flex; align-items: baseline; font-size: 12pt; margin-top: 1.5mm; }
.pn-ready-um .pn-label { margin-right: 8mm; }
/* ช่องบรรยาย = เส้นประจุด (ต้นฉบับ) ไม่ใช่เส้นทึบ */
.pn-dot-fill { flex: 1; border-bottom: 1px dotted #000; margin-left: 2mm; min-height: 4.5mm; }
.pn-check-row { display: flex; align-items: center; font-size: 12pt; margin: 1.5mm 0; }
.pn-check-row .pn-item { width: 29mm; font-weight: 700; flex-shrink: 0; }
.pn-check-opt { display: flex; align-items: center; flex-shrink: 0; }
.pn-check-opt--ready { width: 17mm; }
.pn-check-opt--not { width: 24mm; }
.pn-box { width: 3.6mm; height: 3.6mm; border: 1px solid #000; display: inline-block; margin-right: 1.5mm; flex-shrink: 0; }
.pn-khad { flex-shrink: 0; }

/* ---------- ความพร้อมผลิต — POND ----------
   ต้นฉบับยัดไว้ 2 บรรทัด: [หัวข้อ] [วัตถุดิบ ☐ ครบ ลงชื่อ ___] [บรรจุภัณฑ์ ☐ ครบ ลงชื่อ ___]
   บรรทัดล่างคือ ☐ ไม่ครบ ของทั้งสองกลุ่ม (ชื่อกลุ่มไม่ซ้ำ) */
.pn-ready-po { display: flex; align-items: center; font-size: 12pt; margin: 1.5mm 0; }
.pn-ready-po-title { width: 46mm; font-weight: 700; flex-shrink: 0; }
.pn-ready-po-grp { flex: 1; display: flex; align-items: center; min-width: 0; }
.pn-ready-po-name { width: 20mm; font-weight: 700; text-align: right; margin-right: 2mm; flex-shrink: 0; }
.pn-check-label { margin-right: 2mm; white-space: nowrap; }
.pn-signline { flex: 1; border-bottom: 1px solid #000; min-height: 4.5mm; margin-right: 3mm; }
.pn-missing { display: flex; font-size: 12pt; margin-top: 1.5mm; }
.pn-missing .pn-col { flex: 1; display: flex; align-items: baseline; min-width: 0; }
.pn-missing .pn-col:first-child { margin-right: 6mm; }
.pn-dotted { flex: 1; border-bottom: 1px dotted #000; margin-left: 2mm; min-height: 4mm; }

/* ---------- ลงชื่อและวันที่ ---------- */
.pn-sign-title { text-align: center; font-size: 11pt; margin: 1mm 0 0.5mm; }
.pn-footer { width: 100%; border-collapse: collapse; table-layout: fixed; }
.pn-footer th, .pn-footer td { border: 1px solid #000; text-align: center; }
.pn-footer tr > *:first-child { border-left: 0; }
.pn-footer tr > *:last-child { border-right: 0; }
/* แถวล่างสุดชนขอบกรอบพอดี — ไม่ให้เส้นซ้อนกันเป็น 2px */
.pn-footer tr:last-child > * { border-bottom: 0; }
.pn-footer th { font-size: 12pt; font-weight: 700; height: 7mm; }
/* ช่องเซ็น: เส้นอยู่ใกล้ก้นช่อง (ต้นฉบับ) — UMEDA เส้นประ · POND เส้นทึบ */
.pn-footer td { height: 12mm; vertical-align: bottom; padding: 0 4mm 2.5mm; }
.pn-sign-dot { border-bottom: 1px dotted #000; }
.pn-sign-solid { border-bottom: 1px solid #000; }

/* บรรทัดนอกกรอบ — เลขฟอร์ม/วันที่บังคับใช้ */
.pn-bottom { display: flex; justify-content: space-between; font-size: 9pt; font-weight: 700; margin-top: 1mm; padding: 0 1mm; }

@media screen {
  .pn-preview { background: #e9e9ec; padding: 6mm; overflow-x: auto; border-radius: 0.75rem; }
  /* ปิดตัวอย่าง = ย้ายออกนอกจอ ไม่ใช่ display:none — ต้องคง layout ไว้ให้ auto-fit วัดความสูงได้ */
  .pn-preview[data-open="false"] { position: absolute; left: -20000px; top: 0; width: 220mm; padding: 0; background: none; }
  /* บนจอ ขอบกระดาษมาจาก padding เหมือนตอนพิมพ์แล้ว เหลือแค่เส้น/เงาให้เห็นว่าเป็นแผ่นกระดาษ */
  .pn-sheet {
    outline: 1px solid #c9c9d2;
    margin: 0 auto 6mm;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
  }
}

@media print {
  /* 🚨 app-shell ครอบด้วย flex + min-h-screen และ space-y-* ใส่ margin-top ให้ลูกทุกตัว
     ถ้าไม่ล้างทิ้ง แผ่นแรกจะถูกดันลงมา ~4mm แล้วทุกแผ่นตกไปขึ้นหน้าใหม่ (ได้กระดาษเปล่าคั่น)
     จำกัดขอบเขตด้วย :has(.pn-preview) → มีผลเฉพาะหน้านี้ ไม่กระทบหน้าอื่น */
  body:has(.pn-preview),
  body:has(.pn-preview) > div,
  body:has(.pn-preview) > div > div { display: block !important; min-height: 0 !important; }
  body:has(.pn-preview) main { display: block !important; padding: 0 !important; }
  /* กล่องครอบของหน้านี้ (page.tsx + print-notice-view.tsx) — space-y-* ใส่ margin-top ให้
     ถ้าไม่ล้าง แผ่นแรกจะเริ่มที่ ~5mm แล้วล้นไปหน้าถัดไปทันที */
  .pn-page { margin: 0 !important; padding: 0 !important; }
  .pn-preview {
    position: static !important;
    left: auto !important;
    width: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    background: none !important;
    overflow: visible !important;
  }
  /* ล้างเฉพาะของประดับบนจอ — 🚨 padding ของ .pn-sheet คือขอบกระดาษ ห้ามล้าง */
  .pn-sheet { margin: 0; box-shadow: none; outline: 0; }
}
`;

/** <style> ของหน้าใบแจ้งผลิต — ไม่ใส่ prop precedence เพื่อไม่ให้ React hoist ขึ้น head */
export function NoticePrintStyle() {
  return <style>{NOTICE_PRINT_CSS}</style>;
}

/* ============================================================
   ตัวช่วยแปลงค่า
   ============================================================ */

/* dashOr() / fmtQtyPlain() อยู่ที่ lib/format.ts — ใช้ร่วมกับตารางบอร์ดงาน (F.PLN.10)
   สูตรเดียวกันต้องอยู่ที่เดียว ไม่งั้นวันหนึ่งเอกสาร 2 ใบจะเขียนเลขคนละแบบ */

/** ขนาดบรรจุช่องที่ i (0–2) — ไม่มีก็ "-" */
function pack(job: JobRow, i: number): string {
  return dashOr(job.pack_patterns[i]);
}

/* ============================================================
   บล็อกที่ 2 ฟอร์มใช้ร่วมกัน
   ============================================================ */
function ItemTable({
  job,
  nameWidth,
  bigName,
}: {
  job: JobRow;
  /** ความกว้างช่อง "รายการ" — วัดจากฟอร์มกระดาษของแต่ละบริษัท */
  nameWidth: string;
  /** POND พิมพ์ชื่อยาตัวใหญ่กว่า UMEDA */
  bigName?: boolean;
}) {
  return (
    <table className="pn-table">
      <tbody>
        <tr>
          <th style={{ width: nameWidth }}>รายการ</th>
          <th>รูปร่างลักษณะยา</th>
        </tr>
        <tr className="pn-item-row">
          <td className={bigName ? "pn-name pn-name--lg" : "pn-name"}>
            {dashOr(job.product_name)}
          </td>
          <td className="pn-desc">{dashOr(job.appearance)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** แถว REG. NO. + JOB. NO. — ตำแหน่งช่องถอดจากฟอร์มกระดาษ (REG ~30% · JOB เริ่ม ~62%) */
function RegJobRow({ job }: { job: JobRow }) {
  return (
    <div className="pn-row pn-pad">
      <div className="pn-col" style={{ flex: "0 0 30%" }}>
        <span className="pn-label">REG. NO.</span>
        <span className="pn-fill pn-regno">{dashOr(job.reg_no)}</span>
      </div>
      <div style={{ flex: "1 1 auto" }} />
      <div className="pn-col" style={{ flex: "0 0 38%" }}>
        <span className="pn-jobno-label">JOB. NO.</span>
        <span className="pn-fill pn-jobno">{displayJobNo(job.job_no)}</span>
      </div>
    </div>
  );
}

/** LOT / MFG / EXP — เว้นว่างเสมอ ให้ฝ่ายผลิตเขียนมือ (ตามฟอร์มกระดาษ) */
function LotRow({ expLabel }: { expLabel: string }) {
  return (
    <div className="pn-row pn-pad">
      <div className="pn-col" style={{ flex: "0 0 30%" }}>
        <span className="pn-label">LOT. NO.</span>
        <span className="pn-fill" />
      </div>
      <div className="pn-col" style={{ flex: "0 0 32%" }}>
        <span className="pn-label">MFG. DATE</span>
        <span className="pn-fill" />
      </div>
      <div className="pn-col" style={{ flex: "0 0 38%" }}>
        <span className="pn-label">{expLabel}</span>
        <span className="pn-fill" />
      </div>
    </div>
  );
}

/** ตารางลงชื่อ — หัวช่อง 1 แถว + ช่องเซ็นสูง ๆ ที่มีเส้นอยู่ใกล้ก้นช่อง */
function SignTable({ heads, dotted }: { heads: string[]; dotted: boolean }) {
  const width = `${(100 / heads.length).toFixed(2)}%`;
  return (
    <table className="pn-footer">
      <tbody>
        <tr>
          {heads.map((h) => (
            <th key={h} style={{ width }}>
              {h}
            </th>
          ))}
        </tr>
        <tr>
          {heads.map((h) => (
            <td key={h}>
              <div className={dotted ? "pn-sign-dot" : "pn-sign-solid"} />
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/* ============================================================
   ฟอร์ม UMEDA — F.PLN.01 REV.04
   ต่างจาก POND: มีช่อง "กำหนดส่ง" · ความพร้อมผลิต 3 บรรทัด (RM/ปฐมภูมิ/ทุติยภูมิ)
   · ช่องลงชื่อ 3 ช่อง (มี "ผู้อนุมัติ")
   ============================================================ */
function UmedaForm({ job, companyName }: { job: JobRow; companyName: string }) {
  return (
    <>
      <div className="pn-form">
        <div className="pn-header">
          <div className="pn-company">{companyName}</div>
          <div className="pn-title">ใบแจ้งผลิต</div>
        </div>

        <RegJobRow job={job} />
        <LotRow expLabel="EXP.DATE" />

        <ItemTable job={job} nameWidth="23.5%" />

        {/* ความกว้างคอลัมน์วัดจากฟอร์มกระดาษจริง (รวมได้ 100%) */}
        <table className="pn-table">
          <tbody>
            <tr>
              <th style={{ width: "17%" }}>จำนวนผลิต</th>
              <th style={{ width: "6.5%" }}>หน่วย</th>
              <th style={{ width: "19%" }}>ขนาดบรรจุ (1)</th>
              <th style={{ width: "12%" }}>ขนาดบรรจุ (2)</th>
              <th style={{ width: "11%" }}>ขนาดบรรจุ (3)</th>
              <th style={{ width: "9.5%" }}>กำหนดส่ง</th>
              <th style={{ width: "10%" }}>ลูกค้า</th>
              <th style={{ width: "15%" }}>ใบคำขอ</th>
            </tr>
            <tr>
              <td>{fmtQtyPlain(job.quantity)}</td>
              <td>{dashOr(job.unit)}</td>
              <td>{pack(job, 0)}</td>
              <td>{pack(job, 1)}</td>
              <td>{pack(job, 2)}</td>
              <td>{dashOr(fmtDdMmYy(job.due_date))}</td>
              <td>{dashOr(job.customer)}</td>
              <td>{dashOr(job.request_no)}</td>
            </tr>
          </tbody>
        </table>

        <div className="pn-ready-um pn-pad">
          <span className="pn-label">ความพร้อมผลิต</span>
          <span>หมายเหตุ</span>
          <span className="pn-dot-fill" />
        </div>

        {["วัตถุดิบ", "บรรจุภัณฑ์ปฐมภูมิ", "บรรจุภัณฑ์ทุติยภูมิ"].map((name) => (
          <div className="pn-check-row pn-pad" key={name}>
            <span className="pn-item">{name}</span>
            <span className="pn-check-opt pn-check-opt--ready">
              <span className="pn-box" />
              พร้อม
            </span>
            <span className="pn-check-opt pn-check-opt--not">
              <span className="pn-box" />
              ไม่พร้อม
            </span>
            <span className="pn-khad">ขาด</span>
            <span className="pn-dot-fill" />
          </div>
        ))}

        <div className="pn-sign-title">ลงชื่อและวันที่</div>

        <SignTable heads={["ฝ่ายวางแผน", "ผู้อนุมัติ", "ฝ่ายผลิต"]} dotted />
      </div>

      <div className="pn-bottom">
        <span>วันที่มีผลบังคับใช้ 25/10/2568</span>
        <span>F.PLN.01 REV.04</span>
      </div>
    </>
  );
}

/* ============================================================
   ฟอร์ม POND — F.PLN.01
   ต่างจาก UMEDA: มีช่อง "หมายเหตุ" แทน "กำหนดส่ง" · ความพร้อมผลิต 2 บรรทัด
   (ครบ/ไม่ครบ + ลงชื่อ ของวัตถุดิบกับบรรจุภัณฑ์อยู่บรรทัดเดียวกัน) · ช่องลงชื่อ 2 ช่อง
   ============================================================ */
function PondForm({ job, companyName }: { job: JobRow; companyName: string }) {
  return (
    <>
      <div className="pn-form">
        <div className="pn-header">
          <div className="pn-company pn-company--wide">{companyName}</div>
          <div className="pn-title">ใบแจ้งผลิต</div>
        </div>

        <RegJobRow job={job} />
        <LotRow expLabel="EXP.DATE." />

        <ItemTable job={job} nameWidth="26%" bigName />

        <table className="pn-table">
          <tbody>
            <tr>
              <th style={{ width: "18%" }}>จำนวนผลิต</th>
              <th style={{ width: "8%" }}>หน่วย</th>
              <th style={{ width: "14%" }}>ขนาดบรรจุ (1)</th>
              <th style={{ width: "11%" }}>ขนาดบรรจุ (2)</th>
              <th style={{ width: "11%" }}>ขนาดบรรจุ (3)</th>
              <th style={{ width: "12.5%" }}>ลูกค้า</th>
              <th style={{ width: "12.5%" }}>ใบคำขอ</th>
              <th style={{ width: "13%" }}>หมายเหตุ</th>
            </tr>
            <tr>
              <td>{fmtQtyPlain(job.quantity)}</td>
              <td>{dashOr(job.unit)}</td>
              <td>{pack(job, 0)}</td>
              <td>{pack(job, 1)}</td>
              <td>{pack(job, 2)}</td>
              <td>{dashOr(job.customer)}</td>
              <td>{dashOr(job.request_no)}</td>
              <td>{dashOr(job.note)}</td>
            </tr>
          </tbody>
        </table>

        {/* 2 บรรทัด: บรรทัดแรกมีหัวข้อ + ชื่อกลุ่ม · บรรทัดสองเป็น "ไม่ครบ" ของทั้งสองกลุ่ม */}
        {[
          { label: "ครบ ลงชื่อ", showName: true },
          { label: "ไม่ครบ ลงชื่อ", showName: false },
        ].map((line, i) => (
          <div className="pn-ready-po pn-pad" key={line.label}>
            <span className="pn-ready-po-title">
              {i === 0 ? "ตรวจสอบความพร้อมผลิต ดังนี้" : ""}
            </span>
            {["วัตถุดิบ", "บรรจุภัณฑ์"].map((name) => (
              <span className="pn-ready-po-grp" key={name}>
                <span className="pn-ready-po-name">
                  {line.showName ? name : ""}
                </span>
                <span className="pn-box" />
                <span className="pn-check-label">{line.label}</span>
                <span className="pn-signline" />
              </span>
            ))}
          </div>
        ))}

        <div className="pn-missing pn-pad">
          <div className="pn-col">
            วัตถุดิบ ขาด<span className="pn-dotted" />
          </div>
          <div className="pn-col">
            บรรจุภัณฑ์ ขาด<span className="pn-dotted" />
          </div>
        </div>
        <div className="pn-missing pn-pad">
          <div className="pn-col">
            กำหนดสินค้าเข้า<span className="pn-dotted" />
          </div>
          <div className="pn-col">
            กำหนดสินค้าเข้า<span className="pn-dotted" />
          </div>
        </div>

        <div className="pn-sign-title">ลงชื่อและวันที่</div>

        <SignTable heads={["ฝ่ายวางแผน", "ฝ่ายผลิต"]} dotted={false} />
      </div>

      <div className="pn-bottom">
        <span>วันที่บังคับใช้ 20/3/2017</span>
        <span>F.PLN.01</span>
      </div>
    </>
  );
}

/* ============================================================
   ประกอบเป็นแผ่น — A4 ละ 2 Job
   ============================================================ */
export function NoticeSheets({
  jobs,
  companyCode,
  companyName,
}: {
  jobs: JobRow[];
  /** companies.code — 'UMEDA' | 'POND' · ตัวเลือก layout (ไม่ใช้ชื่อเต็มเพราะยาวและเปลี่ยนได้) */
  companyCode: string;
  companyName: string;
}) {
  const Form = companyCode === "UMEDA" ? UmedaForm : PondForm;

  // จับคู่ทีละ 2 ใบ = 1 แผ่น · จำนวนคี่ → ครึ่งล่างว่าง (ถูกต้องตามกระดาษฉีกครึ่ง)
  const sheets: JobRow[][] = [];
  for (let i = 0; i < jobs.length; i += 2) sheets.push(jobs.slice(i, i + 2));

  return (
    <>
      {sheets.map((pair) => (
        <div className="pn-sheet" key={pair[0].id}>
          <div className="pn-half">
            {/* data-job — ให้ตัวย่ออัตโนมัติแจ้งได้ว่า "งานไหน" ยาวเกินจนอาจถูกตัด */}
            <div className="pn-fit" data-job={displayJobNo(pair[0].job_no)}>
              <Form job={pair[0]} companyName={companyName} />
            </div>
          </div>
          <div className="pn-tear" />
          <div className="pn-half">
            {pair[1] && (
              <div className="pn-fit" data-job={displayJobNo(pair[1].job_no)}>
                <Form job={pair[1]} companyName={companyName} />
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
