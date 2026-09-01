import type { JobRow } from "@/lib/data/job-constants";
import { dashOr, displayJobNo, fmtDdMmYy, fmtQtyPlain } from "@/lib/format";

/**
 * ใบแจ้งผลิต F.PLN.01 — ตัวกระดาษ (Part D)
 *
 * แปลงตรงจากฟอร์มกระดาษจริงที่ทีมส่งมา 2 ไฟล์ (UMEDA / POND) — ขนาดทุกอย่างเป็น mm
 * เพราะต้องพิมพ์ลง "กระดาษต่อเนื่องเคมีแบบฉีกครึ่ง A4" แล้วช่องต้องตรงกับของเดิม
 *
 * โครง 1 แผ่น = A4 = 2 Job แนวตั้ง สูงเท่ากันเป๊ะ (flex: 1 1 50%) + เส้นประตรงกลางไว้เล็งฉีก
 * 1 Job = "กล่องแข็ง" ขนาดครึ่ง A4 (อยู่ในกรอบ A5 แนวนอน) — ยาวแค่ไหนก็ขยายไม่ได้ ดู .pn-half
 *
 * 🚨 CSS พิมพ์อยู่ในไฟล์นี้ ไม่ใช่ globals.css — @page เป็น global ถ้าเอาไปรวมจะทับกับ eBR
 *    (เหตุผลเต็มอยู่ในคอมเมนต์ globals.css)
 * 🚨 ตัว @page เองย้ายไปอยู่ที่ print-notice-view.tsx แล้ว เพราะขอบ 4 ด้านผู้ใช้ปรับได้
 *    และ var() ใช้ใน @page ไม่ได้ → ต้อง build เป็น string จาก state
 *    ไฟล์นี้รับค่าผ่านตัวแปร --pn-mt/--pn-mr/--pn-mb/--pn-ml (inline style บน .pn-page)
 */

/* ============================================================
   CSS
   ============================================================ */
const NOTICE_PRINT_CSS = `
/* ขนาดแผ่น = A4 หักขอบที่ผู้ใช้ตั้ง · ค่า fallback 0.32in = 8.13mm (เท่าของเดิม)
   ไม่มี padding ในตัวแผ่น — เลขขอบ 4 ด้านที่ผู้ใช้ตั้ง = ระยะขาวจริงบนกระดาษ ไม่มีอะไรซ่อน

   🚨 เผื่อ 0.8/1.5mm ไว้เสมอ ห้ามเอาออก: Chrome ปัดขนาดหน้ากระดาษเป็น device pixel ตาม DPI
      ของเครื่องพิมพ์ ถ้าแผ่นสูงเท่าพื้นที่พิมพ์เป๊ะ ๆ เศษที่ปัดจะดันขอบล่างของแผ่น (= บรรทัด
      "วันที่บังคับใช้ · F.PLN.01") หลุดไปหน้าถัดไปทีละนิด — อาการที่ผู้ใช้เจอตอนปริ้นจริง
      1.5mm จาก 280mm = 0.5% ตาเปล่าไม่เห็น แต่กันหลุดหน้าได้แน่นอน (ของเดิมเผื่อไว้แค่ 1mm)

   overflow: hidden — แผ่นเป็นกล่องแข็ง ไม่มีอะไรไหลพ้นขอบล่างไปหน้าถัดไปได้เลย */
.pn-sheet {
  box-sizing: border-box;
  width: calc(210mm - var(--pn-ml, 0.32in) - var(--pn-mr, 0.32in) - 0.8mm);
  height: calc(297mm - var(--pn-mt, 0.32in) - var(--pn-mb, 0.32in) - 1.5mm);
  padding: 0;
  border: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 3mm;
  background: #fff;
  color: #000;
  font-family: 'AngsanaUPC', 'Angsana New', 'CordiaUPC', 'Cordia New',
               'TH SarabunPSK', 'Times New Roman', serif;
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

.pn-form { border: 2px solid #000; padding: 3mm 5mm; }
.pn-header { border-bottom: 1.5px solid #000; padding-bottom: 1.5mm; margin-bottom: 1.5mm; text-align: center; }
.pn-company { font-size: 17pt; font-weight: 700; letter-spacing: 1px; }
.pn-company--wide { font-size: 18pt; }
.pn-title { font-size: 15pt; font-weight: 700; margin-top: 0.5mm; }

.pn-row { display: flex; font-size: 12pt; margin: 1mm 0; }
.pn-row .pn-col { flex: 1; display: flex; }
.pn-label { font-weight: 700; white-space: nowrap; }
.pn-fill { border-bottom: 1px solid #000; flex: 1; margin-left: 2mm; min-height: 4mm; }
.pn-jobno-label { font-weight: 700; font-size: 12pt; }
.pn-jobno { font-size: 17pt; font-weight: 700; margin-left: 3mm; border-bottom: 1px solid #000; padding: 0 4mm; }
.pn-regno { font-size: 15pt; font-weight: 700; margin-left: 3mm; }

.pn-table { width: 100%; border-collapse: collapse; margin-top: 2mm; font-size: 11.5pt; table-layout: fixed; }
.pn-table td, .pn-table th { border: 1px solid #000; padding: 1mm 1.5mm; text-align: center; word-break: break-word; }
.pn-table th { font-weight: 700; }
.pn-table td.pn-name { font-weight: 700; text-align: left; padding-left: 3mm; }
.pn-table td.pn-desc { text-align: left; padding-left: 3mm; }

.pn-ready-um { display: flex; font-size: 12pt; margin-top: 2mm; }
.pn-check-row { display: flex; align-items: center; font-size: 11.5pt; margin: 1.3mm 0; }
.pn-check-row .pn-item { width: 40mm; }
.pn-box { width: 3mm; height: 3mm; border: 1px solid #000; display: inline-block; margin: 0 1.5mm 0 4mm; flex-shrink: 0; }
.pn-check-label { margin-right: 2mm; }
.pn-khad { flex: 1; border-bottom: 1px solid #000; margin-left: 2mm; min-height: 4mm; }

.pn-ready-po { font-size: 12pt; font-weight: 700; margin-top: 2.5mm; margin-bottom: 1mm; }
.pn-ready-cols { display: flex; }
.pn-ready-cols .pn-col { flex: 1; }
.pn-ready-cols .pn-col:first-child { margin-right: 6mm; }
.pn-ready-head { font-weight: 700; font-size: 11.5pt; margin-bottom: 1mm; }
.pn-check-line { display: flex; align-items: center; font-size: 11pt; margin: 1mm 0 1mm 6mm; }
.pn-check-line .pn-box { margin: 0 2mm 0 0; }
.pn-signline { flex: 1; border-bottom: 1px solid #000; }
.pn-missing { display: flex; font-size: 11pt; margin-top: 2mm; }
.pn-missing .pn-col { flex: 1; display: flex; align-items: baseline; }
.pn-missing .pn-col:first-child { margin-right: 6mm; }
.pn-dotted { flex: 1; border-bottom: 1px dotted #000; margin-left: 2mm; min-height: 3.5mm; }

.pn-sign-title { text-align: center; font-size: 11.5pt; margin-top: 2mm; }
.pn-footer { width: 100%; border-collapse: collapse; margin-top: 1mm; }
.pn-footer td { border: 1px solid #000; height: 13mm; text-align: center; vertical-align: top; font-size: 11.5pt; padding-top: 1mm; }
.pn-bottom { display: flex; justify-content: space-between; font-size: 9pt; margin-top: 1mm; padding: 0 1mm; }

@media screen {
  .pn-preview { background: #e9e9ec; padding: 6mm; overflow-x: auto; border-radius: 0.75rem; }
  /* ปิดตัวอย่าง = ย้ายออกนอกจอ ไม่ใช่ display:none — ต้องคง layout ไว้ให้ auto-fit วัดความสูงได้ */
  .pn-preview[data-open="false"] { position: absolute; left: -20000px; top: 0; width: 220mm; padding: 0; background: none; }
  /* วาดพื้นที่ "ขอบ" เป็นสีขาวรอบแผ่น → บนจอได้กระดาษ A4 เต็ม 210x297mm ตามค่าที่ตั้งจริง
     ใช้ border + content-box แทนการใส่ div ครอบ เพราะ .pn-sheet + .pn-sheet ข้างบนเป็น sibling
     selector — ถ้าใส่ div ครอบ การขึ้นหน้าใหม่จะพังทันที */
  .pn-sheet {
    box-sizing: content-box;
    border-top: var(--pn-mt, 0.32in) solid #fff;
    border-right: var(--pn-mr, 0.32in) solid #fff;
    border-bottom: var(--pn-mb, 0.32in) solid #fff;
    border-left: var(--pn-ml, 0.32in) solid #fff;
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
  /* ล้างขอบขาวที่วาดไว้เฉพาะบนจอ — ตอนพิมพ์ ขอบมาจาก @page ไม่ใช่ border */
  .pn-sheet { margin: 0; box-shadow: none; border: 0; outline: 0; box-sizing: border-box; }
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
function ItemTable({ job }: { job: JobRow }) {
  return (
    <table className="pn-table">
      <tbody>
        <tr>
          <th style={{ width: "20%" }}>รายการ</th>
          <th>รูปร่างลักษณะยา</th>
        </tr>
        <tr>
          <td className="pn-name">{dashOr(job.product_name)}</td>
          <td className="pn-desc">{dashOr(job.appearance)}</td>
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

        <div className="pn-row">
          <div className="pn-col" style={{ flex: 1.3 }}>
            <span className="pn-label">REG. NO.</span>
            <span className="pn-fill">&nbsp;{dashOr(job.reg_no)}</span>
          </div>
          <div className="pn-col" style={{ flex: 1 }}>
            <span className="pn-jobno-label">JOB. NO.</span>
            <span className="pn-jobno">{displayJobNo(job.job_no)}</span>
          </div>
        </div>

        {/* LOT / MFG / EXP — เว้นว่างเสมอ ให้ฝ่ายผลิตเขียนมือ (ตามฟอร์มกระดาษ) */}
        <div className="pn-row">
          <div className="pn-col" style={{ flex: 1 }}>
            <span className="pn-label">LOT. NO.</span>
            <span className="pn-fill" />
          </div>
          <div className="pn-col" style={{ flex: 1 }}>
            <span className="pn-label">MFG. DATE</span>
            <span className="pn-fill" />
          </div>
          <div className="pn-col" style={{ flex: 1 }}>
            <span className="pn-label">EXP.DATE</span>
            <span className="pn-fill" />
          </div>
        </div>

        <ItemTable job={job} />

        <table className="pn-table">
          <tbody>
            <tr>
              <th style={{ width: "11%" }}>จำนวนผลิต</th>
              <th style={{ width: "8%" }}>หน่วย</th>
              <th style={{ width: "13%" }}>ขนาดบรรจุ (1)</th>
              <th style={{ width: "13%" }}>ขนาดบรรจุ (2)</th>
              <th style={{ width: "13%" }}>ขนาดบรรจุ (3)</th>
              <th style={{ width: "10%" }}>กำหนดส่ง</th>
              <th style={{ width: "10%" }}>ลูกค้า</th>
              <th style={{ width: "14%" }}>ใบสั่งขอ</th>
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

        <div className="pn-ready-um">
          <span className="pn-label">ความพร้อมผลิต</span>
          <span style={{ marginLeft: "6mm" }}>หมายเหตุ</span>
          <span className="pn-fill" />
        </div>

        {["วัตถุดิบ", "บรรจุภัณฑ์ปฐมภูมิ", "บรรจุภัณฑ์ทุติยภูมิ"].map((name) => (
          <div className="pn-check-row" key={name}>
            <span className="pn-item">{name}</span>
            <span className="pn-box" />
            <span className="pn-check-label">พร้อม</span>
            <span className="pn-box" />
            <span className="pn-check-label">ไม่พร้อม</span>
            <span>ขาด</span>
            <span className="pn-khad" />
          </div>
        ))}

        <div className="pn-sign-title">ลงชื่อและวันที่</div>

        <table className="pn-footer">
          <tbody>
            <tr>
              <td>ฝ่ายวางแผน</td>
              <td>ผู้อนุมัติ</td>
              <td>ฝ่ายผลิต</td>
            </tr>
          </tbody>
        </table>
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
   ต่างจาก UMEDA: มีช่อง "หมายเหตุ" แทน "กำหนดส่ง" · ความพร้อมผลิต 2 คอลัมน์
   (ครบ/ไม่ครบ + ลงชื่อ) · ช่องลงชื่อ 2 ช่อง · REG. NO. ไม่มีเส้นใต้
   ============================================================ */
function PondForm({ job, companyName }: { job: JobRow; companyName: string }) {
  return (
    <>
      <div className="pn-form">
        <div className="pn-header">
          <div className="pn-company pn-company--wide">{companyName}</div>
          <div className="pn-title">ใบแจ้งผลิต</div>
        </div>

        <div className="pn-row">
          <div className="pn-col" style={{ flex: 1.3 }}>
            <span className="pn-label">REG. NO.</span>
            <span className="pn-regno">{dashOr(job.reg_no)}</span>
          </div>
          <div
            className="pn-col"
            style={{ flex: 1, justifyContent: "flex-end" }}
          >
            <span className="pn-jobno-label">JOB. NO.</span>
            <span className="pn-jobno">{displayJobNo(job.job_no)}</span>
          </div>
        </div>

        {/* LOT / MFG / EXP — เว้นว่างเสมอ ให้ฝ่ายผลิตเขียนมือ (ตามฟอร์มกระดาษ) */}
        <div className="pn-row">
          <div className="pn-col" style={{ flex: 1 }}>
            <span className="pn-label">LOT. NO.</span>
            <span className="pn-fill" />
          </div>
          <div className="pn-col" style={{ flex: 1 }}>
            <span className="pn-label">MFG. DATE</span>
            <span className="pn-fill" />
          </div>
          <div className="pn-col" style={{ flex: 1 }}>
            <span className="pn-label">EXP.DATE.</span>
            <span className="pn-fill" />
          </div>
        </div>

        <ItemTable job={job} />

        <table className="pn-table">
          <tbody>
            <tr>
              <th style={{ width: "11%" }}>จำนวนผลิต</th>
              <th style={{ width: "8%" }}>หน่วย</th>
              <th style={{ width: "13%" }}>ขนาดบรรจุ (1)</th>
              <th style={{ width: "13%" }}>ขนาดบรรจุ (2)</th>
              <th style={{ width: "13%" }}>ขนาดบรรจุ (3)</th>
              <th style={{ width: "13%" }}>ลูกค้า</th>
              <th style={{ width: "14%" }}>ใบคำขอ</th>
              <th style={{ width: "15%" }}>หมายเหตุ</th>
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

        <div className="pn-ready-po">ตรวจสอบความพร้อมผลิต ดังนี้</div>
        <div className="pn-ready-cols">
          {["วัตถุดิบ", "บรรจุภัณฑ์"].map((head) => (
            <div className="pn-col" key={head}>
              <div className="pn-ready-head">{head}</div>
              <div className="pn-check-line">
                <span className="pn-box" />
                <span className="pn-check-label">ครบ ลงชื่อ</span>
                <span className="pn-signline" />
              </div>
              <div className="pn-check-line">
                <span className="pn-box" />
                <span className="pn-check-label">ไม่ครบ ลงชื่อ</span>
                <span className="pn-signline" />
              </div>
            </div>
          ))}
        </div>

        <div className="pn-missing">
          <div className="pn-col">
            วัตถุดิบ ขาด<span className="pn-dotted" />
          </div>
          <div className="pn-col">
            บรรจุภัณฑ์ ขาด<span className="pn-dotted" />
          </div>
        </div>
        <div className="pn-missing">
          <div className="pn-col">
            กำหนดสินค้าเข้า<span className="pn-dotted" />
          </div>
          <div className="pn-col">
            กำหนดสินค้าเข้า<span className="pn-dotted" />
          </div>
        </div>

        <div className="pn-sign-title">ลงชื่อและวันที่</div>

        <table className="pn-footer">
          <tbody>
            <tr>
              <td>ฝ่ายวางแผน</td>
              <td>ฝ่ายผลิต</td>
            </tr>
          </tbody>
        </table>
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
