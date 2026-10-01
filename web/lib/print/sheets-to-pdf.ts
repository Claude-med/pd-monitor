/**
 * แผ่นกระดาษบนจอ (กล่อง A4 ตายตัว) → ไฟล์ PDF · ของกลางของทุกหน้าที่ปริ้น
 *
 * ทำไมต้องทำเป็น PDF แทน window.print():
 *   `@page { margin: 0 }` ตัดวันที่/ชื่อแท็บ/URL ของเบราว์เซอร์ได้เฉพาะตอน "บันทึกเป็น PDF"
 *   พอเลือกเครื่องพิมพ์จริง (เช่น EPSON L405) Chrome บังคับขอบขั้นต่ำตาม "ขอบที่พิมพ์ไม่ได้" ของเครื่อง
 *   → มีที่ให้วางหัว/ท้ายกระดาษอีก → ติดมาบนกระดาษ · CSS ในหน้าเว็บปิดไม่ได้
 *   แต่ตอนพิมพ์ "ไฟล์ PDF" เบราว์เซอร์ไม่ใส่หัว/ท้ายกระดาษเลย → ได้ผลทุกเครื่อง ไม่ต้องตั้งค่า
 *
 * วิธี: จับภาพทีละแผ่น (ความละเอียด ×3 ≈ 290 dpi) แล้ววางลง PDF หน้า A4 ละ 1 แผ่น
 *   ขนาดภาพในหน้า = ขนาดจริงของแผ่นเป็น mm (แผ่นเล็กกว่า A4 นิดเดียวตามที่เผื่อไว้ใน CSS)
 *   ขอบขาวมาจาก padding ในแผ่นอยู่แล้ว → หน้าตาเหมือนตัวอย่างบนจอทุกจุด
 *
 * ขั้นสุดท้าย printPdfBlob() สั่งพิมพ์ไฟล์ PDF ผ่าน iframe ที่ซ่อนอยู่
 * โหลดไลบรารีแบบ dynamic ตอนกดเท่านั้น (ไม่ติดไปกับ bundle ของหน้า)
 * ⚠️ client เท่านั้น — ใช้ DOM/window
 */

const PX_TO_MM = 25.4 / 96;

/**
 * คัดลอกเฉพาะ property ที่มีผลกับหน้าตาแผ่น
 * 🚨 ห้ามปล่อยค่าเริ่มต้น (= คัดลอกทุก property): Tailwind v4 ประกาศตัวแปร CSS หลายร้อยตัวที่ :root
 *    ทุก element สืบทอดหมด → ภาพ SVG ระหว่างทางใหญ่หลายสิบ MB → แท็บค้างไม่ตอบสนอง (เจอจริงตอนทดสอบ)
 */
const STYLE_PROPS = [
  "display", "position", "top", "right", "bottom", "left", "float", "clear", "z-index",
  "box-sizing", "width", "height", "min-width", "min-height", "max-width", "max-height",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "border-collapse", "border-spacing", "table-layout", "caption-side", "empty-cells",
  "vertical-align", "text-align", "text-indent", "text-transform", "text-decoration-line",
  "text-decoration-style", "text-decoration-color", "white-space", "word-break",
  "overflow-wrap", "text-overflow", "overflow-x", "overflow-y", "line-height", "letter-spacing",
  "font-family", "font-size", "font-weight", "font-style", "font-variant-numeric",
  "color", "background-color", "opacity", "visibility",
  "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis",
  "justify-content", "align-items", "align-self", "gap", "row-gap", "column-gap",
  "grid-template-columns", "grid-template-rows", "grid-column-start", "grid-column-end",
  "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius",
  "border-bottom-right-radius", "transform", "transform-origin",
  "list-style-type", "list-style-position",
];

/**
 * @param opts.embedFonts ฝังเว็บฟอนต์ของหน้า (เช่น Noto Sans Thai ของแอป) — ใช้กับแผ่นที่ไม่ได้ใช้ฟอนต์ในเครื่อง
 *   ไม่งั้นภาพจะตกไปใช้ฟอนต์สำรอง · ดึง CSS ฟอนต์ครั้งเดียวจากแผ่นแรกแล้วใช้ซ้ำทุกแผ่น
 */
export async function sheetsToPdf(
  sheets: HTMLElement[],
  orientation: "portrait" | "landscape",
  opts: { embedFonts?: boolean } = {},
): Promise<Blob> {
  if (sheets.length === 0) throw new Error("ไม่มีแผ่นให้สร้าง PDF");
  const [{ toPng, getFontEmbedCSS }, { jsPDF }] = await Promise.all([
    import("html-to-image"),
    import("jspdf"),
  ]);

  const fontEmbedCSS = opts.embedFonts
    ? await getFontEmbedCSS(sheets[0], { includeStyleProperties: STYLE_PROPS })
    : undefined;

  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation, compress: true });
  /* บอกหน้าต่างพิมพ์ว่า "ไม่ต้องย่อ/ขยาย" + "เลือกถาดกระดาษตามขนาดหน้า PDF (A4)"
     🚨 ถ้ากระดาษในหน้าต่างพิมพ์เป็น Letter (ค่าเริ่มต้นของเครื่องพิมพ์หลายรุ่น เช่น EPSON L405)
        แผ่น A4 กว้างกว่า ~18 มม. → ขอบขวาถูกตัด (เจอจริง 1 ต.ค. 69) · ค่านี้เป็นแค่คำแนะนำ
        เบราว์เซอร์/ไดรเวอร์บางตัวไม่สนใจ ⇒ หน้าเว็บต้องบอกผู้ใช้ให้ตั้ง "ขนาดกระดาษ A4" ด้วย */
  pdf.viewerPreferences({ PrintScaling: "None", PickTrayByPDFSize: true });
  for (let i = 0; i < sheets.length; i++) {
    const el = sheets[i];
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const png = await toPng(el, {
      pixelRatio: 3,
      backgroundColor: "#ffffff",
      width: w,
      height: h,
      // ค่าเริ่มต้น: แผ่นใช้ฟอนต์ในเครื่อง (Angsana/Cordia/Sarabun) ไม่ต้องฝังเว็บฟอนต์ — เร็วขึ้นมาก
      skipFonts: !opts.embedFonts,
      fontEmbedCSS,
      includeStyleProperties: STYLE_PROPS,
      // เงา/เส้นประดับบนจอไม่ต้องติดไปในไฟล์
      style: { margin: "0", boxShadow: "none", outline: "0" },
    });
    if (i > 0) pdf.addPage("a4", orientation);
    pdf.addImage(png, "PNG", 0, 0, w * PX_TO_MM, h * PX_TO_MM, undefined, "FAST");
  }
  return pdf.output("blob");
}

/**
 * สั่งพิมพ์ไฟล์ PDF ผ่าน iframe ที่ซ่อนอยู่ → หน้าต่างพิมพ์เด้งขึ้นบนหน้าเดิม (ไม่เปิดแท็บใหม่)
 * ในหน้าต่างพิมพ์เลือกได้ทั้งเครื่องพิมพ์จริง และ "บันทึกเป็น PDF"
 *
 * 🚨 ห้ามเปิดแท็บใหม่ก่อนสร้าง PDF เสร็จ: แท็บใหม่แย่งโฟกัส หน้านี้กลายเป็นแท็บพื้นหลัง
 *    Chrome หน่วงแท็บพื้นหลังหนักมาก → การจับภาพแผ่นค้างไม่จบ (เจอจริงตอนทดสอบ)
 * ถ้าสั่งพิมพ์ใน iframe ไม่ได้ (เบราว์เซอร์บางตัว) → ดาวน์โหลดไฟล์แทน
 */
export function printPdfBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const download = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
  };

  document.getElementById("pdf-print-frame")?.remove();
  const frame = document.createElement("iframe");
  frame.id = "pdf-print-frame";
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
  frame.onload = () => {
    // เว้นจังหวะให้ตัวดู PDF ของเบราว์เซอร์โหลดเสร็จก่อนสั่งพิมพ์
    setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        download();
      }
    }, 300);
  };
  frame.src = url;
  document.body.appendChild(frame);
  // เก็บ URL ไว้นานพอให้พิมพ์/บันทึกเสร็จ แล้วค่อยคืนหน่วยความจำ
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
}
