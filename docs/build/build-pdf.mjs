/**
 * รวมคู่มือ 3 ไฟล์ markdown → HTML เล่มเดียว → PDF
 *   docs/manual-intro.md         = ส่วนหน้า (วิธีใช้คู่มือ + ฉันเป็นฝ่ายไหน)
 *   docs/tutorial-walkthrough.md = ภาค 1 ฝึกปฏิบัติ
 *   docs/user-guide.md           = ภาค 2 คู่มืออ้างอิง
 *
 * ฝังฟอนต์ Sarabun (ซับเซ็ตไทย U+0E01-0E5B ด้วย) + รูป base64 + paged.js ไว้ในไฟล์เดียว
 * → เปิดใน Chrome ที่ติดตั้งในเครื่อง → รอ paged.js จัดหน้าเสร็จ → page.pdf()
 *
 * ใช้:  node build-pdf.mjs [--html-only]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { marked } from "marked";
import { launch } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, "..");
const CACHE = path.join(HERE, ".cache");
const OUT_PDF = path.join(DOCS, "pd-monitor-manual.pdf");

/* ── เกณฑ์ "ลงหน้าเดียวได้ไหม" (พื้นที่เนื้อหาจริงของ A4 = 297 − 17 − 18 = 262 มม.) ──
   ตารางที่วัดแล้วไม่เกิน TABLE_FIT_MM จะถูกห้ามตัดข้ามหน้า (ค่าเริ่มต้นอยู่ใน manual.css)
   ที่เกินกว่านี้คือสูงเกินหน้ากระดาษจริง ๆ จึงต้องปล่อยให้ตัด ไม่งั้น paged.js จะดันจนล้นกรอบ */
const TABLE_FIT_MM = 235;
const KEEP_FIT_MM = 250;

const TITLE = "คู่มือการใช้งาน PD Monitor";
const SUBTITLE = "ระบบติดตามการผลิตยา — Pending Order &amp; PD Monitoring System";

const SOURCES = [
  { file: "manual-intro.md", prefix: "in", cls: "front" },
  {
    file: "tutorial-walkthrough.md",
    prefix: "p1",
    id: "part1",
    divider: {
      n: "ภาค 1",
      h: "ฝึกปฏิบัติ",
      p: "เดินงานจริง 1 ล็อต ตั้งแต่เปิดงานจนปิดงาน — อ่านครั้งเดียวแล้วลงมือทำตามได้เลย เหมาะกับคนที่เพิ่งเริ่มใช้ระบบ",
    },
  },
  {
    file: "user-guide.md",
    prefix: "p2",
    id: "part2",
    divider: {
      n: "ภาค 2",
      h: "คู่มืออ้างอิง",
      p: "เปิดหาเฉพาะเรื่องที่ต้องการ — รายละเอียดทุกหน้าจอ ทุกสิทธิ์ ทุกกติกา พร้อมหน้าสรุปของแต่ละฝ่ายที่ฉีกไปแปะข้างเครื่องได้",
    },
  },
];

/** กล่องข้อความ 4 ชนิด — แยกสีตาม emoji ตัวแรกของ blockquote */
const CALLOUTS = [
  { cls: "cal-warn", marks: ["⚠️", "🚨", "🔴"] },
  { cls: "cal-tip", marks: ["💡", "🎁"] },
  { cls: "cal-gmp", marks: ["🔒", "✅"] },
  { cls: "cal-perm", marks: ["🔑", "👔"] },
  { cls: "cal-note", marks: ["📌", "📎", "ℹ️"] },
];

// ---------- ฟอนต์ ----------
function fontFaces() {
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "fonts/manifest.json"), "utf8"));
  return manifest
    .map((f) => {
      const b64 = fs.readFileSync(path.join(HERE, "fonts", f.file)).toString("base64");
      return `@font-face{font-family:'Sarabun';font-style:normal;font-weight:${f.weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${f.range};}`;
    })
    .join("\n");
}

// ---------- markdown → HTML + เก็บหัวข้อไว้ทำสารบัญ ----------
const toc = [];
let keepNo = 0;
const escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const stripTags = (s) => s.replace(/<[^>]+>/g, "").trim();

function renderSource(src) {
  const md = fs.readFileSync(path.join(DOCS, src.file), "utf8");
  let html = marked.parse(md, { mangle: false, headerIds: false });

  // เส้นคั่นที่อยู่ติดหน้า h1 ไม่ต้องมี — h1 ขึ้นหน้าใหม่อยู่แล้ว
  // (ถ้าปล่อยไว้ เส้นจะถูกดันไปนอนอยู่บนหน้าเปล่าของตัวเอง)
  html = html.replace(/<hr\s*\/?>\s*(?=<h1)/g, "");
  html = html.replace(/<hr\s*\/?>\s*$/, "");

  // ใส่ id ให้ h1/h2/h3 (prefix แยกตามภาค กัน id ชนกัน → target-counter ของสารบัญพัง)
  const chapters = [];
  let n = 0;
  html = html.replace(/<h([123])>([\s\S]*?)<\/h\1>/g, (_m, lvl, inner) => {
    const id = `${src.prefix}-${++n}`;
    const text = stripTags(inner);
    toc.push({ id, lvl: Number(lvl), text });
    if (lvl === "1") chapters.push({ id, text });
    return `<h${lvl} id="${id}">${inner}</h${lvl}>`;
  });

  // มาร์กเกอร์ในไฟล์ .md:
  //   <!--pagebreak-->  = ขึ้นหน้าใหม่ตรงนี้
  //   <!--sheet-->      = ขึ้นหน้าใหม่ + หัวข้อถัดไปเป็น "แผ่นอ้างอิงที่ฉีกไปแปะได้"
  //   <!--sheet-here--> = หัวข้อถัดไปเป็นแผ่นอ้างอิง แต่ไม่ต้องขึ้นหน้าใหม่
  html = html.replace(/<!--\s*sheet\s*-->/g, '<div class="page-break" data-sheet></div>');
  html = html.replace(/<!--\s*sheet-here\s*-->/g, '<div data-sheet></div>');
  html = html.replace(/<!--\s*pagebreak\s*-->/g, '<div class="page-break"></div>');
  // <!--sheet-notes:N--> = ช่องเขียนโน้ตด้วยมือท้ายแผ่นอ้างอิง N บรรทัด
  // (จำนวนบรรทัดปรับอัตโนมัติด้วย tune-sheets.py ให้เต็มพื้นที่ที่เหลือของแต่ละแผ่น)
  html = html.replace(/<!--\s*sheet-notes(?::(\d+))?\s*-->/g, (_m, num) => {
    const lines = Math.max(2, Math.min(24, Number(num) || 5));
    return (
      '<div class="sheet-notes"><div class="t">บันทึกของแผนก</div>' +
      '<div class="l"></div>'.repeat(lines) +
      "</div>"
    );
  });

  // หัวข้อที่ตามหลังมาร์กเกอร์ = หัวแผ่นอ้างอิง
  html = html.replace(/(<div[^>]*data-sheet[^>]*><\/div>\s*)<h2 /g, '$1<h2 class="sheet" ');

  // กล่องข้อความ — ให้ class ตาม emoji ตัวแรก เพื่อแยกสี
  html = html.replace(/<blockquote>\s*<p>([\s\S]{0,12})/g, (m, head) => {
    const hit = CALLOUTS.find((c) => c.marks.some((k) => head.includes(k)));
    return hit ? m.replace("<blockquote>", `<blockquote class="${hit.cls}">`) : m;
  });

  // <img> เดี่ยวใน <p> → <figure> + caption จาก alt (เลขที่รูปมาจาก CSS counter)
  html = html.replace(
    /<p>\s*<img src="([^"]+)" alt="([^"]*)"\s*\/?>\s*<\/p>/g,
    (_m, src2, alt) =>
      `<figure><img src="${src2}" alt="${escapeAttr(alt)}">` +
      (alt ? `<figcaption>${alt}</figcaption>` : "") +
      `</figure>`,
  );

  // 🔗 มัด "หัวข้อ + บรรทัดนำ + ของก้อนแรก" ไว้ด้วยกัน
  // ไม่งั้นหัวข้อกับข้อความ 1 บรรทัดจะค้างอยู่ท้ายหน้า แล้วรูป/ตารางกระโดดไปหน้าถัดไป
  // (วัดแล้วเกิด 35 จุดในเล่ม — หนักสุดคือหัวข้ออยู่ห่างขอบล่างแค่ 10 มม.)
  // ตารางมัดเฉพาะตารางสั้น (≤ MAX_KEEP_ROWS แถว) ตารางยาวปล่อยให้ตัดข้ามหน้าตามปกติ
  const MAX_KEEP_ROWS = 16;
  html = html.replace(
    /(<h[234] id="[^"]*">[\s\S]*?<\/h[234]>)((?:\s*<p>(?:(?!<\/p>)[\s\S])*?<\/p>){0,2})(\s*(?:<figure>[\s\S]*?<\/figure>|<table>[\s\S]*?<\/table>|<pre>[\s\S]*?<\/pre>))/g,
    (m, head, mid, blk) => {
      const rows = (blk.match(/<tr>/g) || []).length;
      if (blk.includes("<table>") && rows > MAX_KEEP_ROWS) return m;
      // data-k = เลขประจำก้อน ไว้ให้รอบวัดถอดการมัดออกถ้าก้อนใหญ่เกินหนึ่งหน้า
      return `<div class="keep" data-k="${++keepNo}">${head}${mid}${blk}</div>`;
    },
  );

  // 🔗 รอบสอง: "ย่อหน้าป้ายกำกับสั้น ๆ + ตาราง/รูป/โค้ด" ก็ต้องมัดไว้ด้วยกัน
  // ในเล่มนี้ป้ายกำกับหลายอันไม่ใช่หัวข้อ แต่เป็นย่อหน้าสั้น เช่น "✍️ ช่องที่ต้องกรอก" ·
  // "🖱️ กด \"เพิ่มสถานี\" แล้วกรอก" — ถ้าไม่มัด ป้ายจะค้างท้ายหน้าแล้วตารางกระโดดไปหน้าถัดไป
  // (วัดครั้งแรกเจอ 14 จุด) · ก้อนที่ใหญ่เกินหน้าจะถูกรอบวัดถอดออกให้เอง
  const MAX_LABEL_CHARS = 110;
  html = html.replace(
    /(<p>(?:(?!<\/p>)[\s\S])*?<\/p>)(\s*(?:<figure>[\s\S]*?<\/figure>|<table>[\s\S]*?<\/table>|<pre>[\s\S]*?<\/pre>))/g,
    (m, para, blk) =>
      stripTags(para).length > MAX_LABEL_CHARS
        ? m
        : `<div class="keep" data-k="${++keepNo}">${para}${blk}</div>`,
  );

  let out = "";
  if (src.divider) {
    const did = `${src.prefix}-part`;
    toc.push({ id: did, lvl: 0, text: `${src.divider.n} — ${src.divider.h}`, order: -1 });
    const list = chapters.map((c) => `<li>${c.text}</li>`).join("");
    out +=
      `<section class="part-divider" id="${did}">` +
      `<div class="n">${src.divider.n}</div>` +
      `<h1>${src.divider.h}</h1>` +
      `<p class="lead">${src.divider.p}</p>` +
      `<div class="in-this-part"><h3>ในภาคนี้มีอะไรบ้าง</h3><ol>${list}</ol></div>` +
      `</section>`;
  }
  out += `<section${src.id ? ` id="${src.id}"` : ""}${src.cls ? ` class="${src.cls}"` : ""}>${html}</section>`;
  return out;
}

// ---------- ฝังรูปเป็น base64 ----------
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" };
let embedded = 0;
const uniqueImages = new Set();
const missing = [];
function inlineImages(html) {
  return html.replace(/<img([^>]*?)src="((?!data:)[^"]+)"/g, (m, pre, rel) => {
    const file = path.join(DOCS, rel);
    if (!fs.existsSync(file)) {
      missing.push(rel);
      return m;
    }
    const mime = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    embedded++;
    uniqueImages.add(rel);
    return `<img${pre}src="data:${mime};base64,${fs.readFileSync(file).toString("base64")}"`;
  });
}

// ---------- ประกอบเล่ม ----------
// data-t = เลขประจำตาราง ไว้ให้รอบวัดชี้เฉพาะตารางที่สูงเกินหนึ่งหน้า
let tableNo = 0;
const body = SOURCES.map(renderSource).join("\n")
  .replace(/<table>/g, () => `<table data-t="${++tableNo}">`);

// เรียงสารบัญตามลำดับที่ปรากฏจริงในเล่ม (หน้าคั่นภาคต้องมาก่อนหัวข้อของภาคนั้น)
const ORDER = SOURCES.map((s) => s.prefix);
toc.sort((a, b) => {
  const pa = ORDER.indexOf(a.id.split("-")[0]);
  const pb = ORDER.indexOf(b.id.split("-")[0]);
  if (pa !== pb) return pa - pb;
  if (a.lvl === 0) return -1;
  if (b.lvl === 0) return 1;
  return Number(a.id.split("-")[1]) - Number(b.id.split("-")[1]);
});

const tocHtml = toc
  .map((t) => `<li class="lvl${t.lvl}"><a href="#${t.id}">${t.text}</a></li>`)
  .join("\n");

const today = new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });

let doc = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${TITLE}</title>
<style>
${fontFaces()}
${fs.readFileSync(path.join(HERE, "manual.css"), "utf8")}
</style>
<style id="tall-tables">/*TALL-TABLES*/</style></head><body>
<section class="cover">
  <div class="kicker">คู่มือฉบับสมบูรณ์</div>
  <div class="rule"></div>
  <h1>${TITLE}</h1>
  <div class="sub">${SUBTITLE}</div>
  <div class="badges">
    <span class="badge">ภาค 1 · ฝึกปฏิบัติ</span>
    <span class="badge">ภาค 2 · คู่มืออ้างอิง</span>
    <span class="badge">${embedded || "65"} ภาพจากระบบจริง</span>
  </div>
  <div class="meta">
    <b>ฉบับปรับปรุง:</b> ${today}<br>
    <b>สำหรับ:</b> ฝ่ายวางแผน · ผลิต · QC · QA · คลังสินค้า · วิศวกรรม · บัญชีต้นทุน · ผู้บริหาร
  </div>
</section>
<section class="toc">
  <h2>สารบัญ</h2>
  <p class="toc-note">เลขหน้าอยู่ขวามือ · ภาค 1 สอนทีละขั้น · ภาค 2 เปิดหาเฉพาะเรื่อง</p>
  <ol>${tocHtml}</ol>
</section>
${body}
<script>window.PagedConfig = { auto: false };</script>
<script src="./paged.polyfill.js"></script>
</body></html>`;

doc = inlineImages(doc);
doc = doc.replace(">65 ภาพจากระบบจริง<", `>${uniqueImages.size} ภาพจากระบบจริง<`);

fs.mkdirSync(CACHE, { recursive: true });
fs.copyFileSync(path.join(HERE, "vendor/paged.polyfill.js"), path.join(CACHE, "paged.polyfill.js"));
const htmlPath = path.join(CACHE, "manual.html");
fs.writeFileSync(htmlPath, doc, "utf8");

console.log(`หัวข้อในสารบัญ ${toc.length} · ฝังรูป ${embedded} ครั้ง (${uniqueImages.size} ภาพ) · HTML ${(Buffer.byteLength(doc) / 1048576).toFixed(1)} MB`);
if (missing.length) console.log(`⚠️  ไม่พบรูป ${missing.length} ไฟล์: ${[...new Set(missing)].slice(0, 12).join(", ")}`);
const HTML_ONLY = process.argv.includes("--html-only");

// ---------- เปิดใน Chrome → วัดความสูงตาราง → จัดหน้า → PDF ----------
const browser = await launch();
try {
  const page = await browser.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [หน้าเว็บ]", m.text().slice(0, 160));
  });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 180000 });

  // ── รอบวัด: ตอนนี้เอกสารยังเป็น normal flow (PagedConfig.auto = false)
  //    บีบ body ให้กว้างเท่าพื้นที่เนื้อหาจริง (A4 210 − ขอบ 16 × 2 = 178mm) แล้ววัดของจริง
  //    ทวนสอบแล้วตรงกับที่จัดหน้าจริง: ตาราง 15 แถว วัด 137mm / จัดหน้าได้ 138mm
  const fit = await page.evaluate(
    ({ tableMm, keepMm }) => {
      const MM = 96 / 25.4;
      const saved = document.body.style.cssText;
      document.body.style.width = "178mm";
      document.body.style.margin = "0";
      void document.body.offsetHeight;
      const tall = [];
      const unkeep = [];
      document.querySelectorAll("table[data-t]").forEach((t) => {
        const mm = Math.round(t.getBoundingClientRect().height / MM);
        if (mm > tableMm) tall.push({ id: t.dataset.t, mm });
      });
      document.querySelectorAll("div.keep[data-k]").forEach((d) => {
        const mm = Math.round(d.getBoundingClientRect().height / MM);
        if (mm > keepMm) unkeep.push({ id: d.dataset.k, mm });
      });
      document.body.style.cssText = saved;
      void document.body.offsetHeight;
      return { tall, unkeep };
    },
    { tableMm: TABLE_FIT_MM, keepMm: KEEP_FIT_MM },
  );

  const tallCss = fit.tall.map((x) => `table[data-t="${x.id}"]{break-inside:auto}`).join("\n");
  console.log(
    fit.tall.length
      ? `  ตารางที่สูงเกิน ${TABLE_FIT_MM}มม. ${fit.tall.length} ตาราง — ปล่อยให้ตัดข้ามหน้าได้ (${fit.tall.map((x) => x.mm + "มม.").join(", ")})`
      : `  ทุกตารางสูงไม่เกิน ${TABLE_FIT_MM}มม. — ไม่มีตารางไหนถูกตัดข้ามหน้า`,
  );
  if (fit.unkeep.length) console.log(`  ถอดการมัด .keep ${fit.unkeep.length} ก้อนที่ใหญ่เกิน ${KEEP_FIT_MM}มม.`);

  // เขียนผลกลับลงไฟล์ด้วย เพื่อให้ check-layout.mjs / audit-layout.mjs ที่อ่านจาก .cache/manual.html
  // เห็นเลย์เอาต์เดียวกับ PDF จริง (ไม่งั้นสคริปต์ตรวจจะวัดคนละเล่ม)
  let doc2 = doc.replace("/*TALL-TABLES*/", tallCss);
  for (const u of fit.unkeep) doc2 = doc2.replace(`<div class="keep" data-k="${u.id}">`, `<div data-k="${u.id}">`);
  if (doc2 !== doc) fs.writeFileSync(htmlPath, doc2, "utf8");

  // ใส่ผลเดียวกันลง DOM ที่เปิดอยู่ ไม่ต้องโหลดไฟล์ใหม่
  await page.evaluate(
    ({ css, ids }) => {
      const st = document.getElementById("tall-tables");
      if (st) st.textContent = css;
      ids.forEach((id) => document.querySelector(`div.keep[data-k="${id}"]`)?.classList.remove("keep"));
    },
    { css: tallCss, ids: fit.unkeep.map((x) => x.id) },
  );

  if (HTML_ONLY) {
    console.log(`หยุดที่ HTML — ${path.relative(process.cwd(), htmlPath)}`);
    await browser.close();
    process.exit(0);
  }

  await page.evaluate(async () => {
    await window.PagedPolyfill.preview();
  });
  const pages = await page.$$eval(".pagedjs_page", (els) => els.length);

  // เขียนลงไฟล์ชั่วคราวก่อน แล้วค่อยย้ายทับ — กันกรณีไฟล์ปลายทางถูกเปิดค้างในโปรแกรมอ่าน PDF
  const tmpPdf = path.join(CACHE, "manual-out.pdf");
  const opts = { path: tmpPdf, printBackground: true, preferCSSPageSize: true, timeout: 300000 };
  try {
    // tagged + outline = มีสารบัญ (bookmarks) ในตัว PDF · รองรับเฉพาะ Chrome รุ่นใหม่
    await page.pdf({ ...opts, tagged: true, outline: true });
    console.log("  (สร้าง bookmark ในไฟล์ PDF ด้วย)");
  } catch {
    await page.pdf(opts);
    console.log("  (Chrome รุ่นนี้ไม่รองรับ outline — ข้าม bookmark)");
  }

  const mb = (fs.statSync(tmpPdf).size / 1048576).toFixed(1);
  try {
    try {
      fs.copyFileSync(tmpPdf, OUT_PDF);
    } catch (e1) {
      // ไฟล์ปลายทางถูกเปิดค้าง (Acrobat / ตัวสร้างภาพตัวอย่างของ Explorer)
      // เขียนทับตรง ๆ ไม่ได้ แต่ "ย้ายไฟล์เก่าออกก่อนแล้วเขียนใหม่" มักผ่าน
      if (e1.code !== "EBUSY" && e1.code !== "EPERM") throw e1;
      const bak = OUT_PDF.replace(/\.pdf$/, ".old.pdf");
      fs.renameSync(OUT_PDF, bak);
      fs.copyFileSync(tmpPdf, OUT_PDF);
      try { fs.unlinkSync(bak); } catch { /* ลบทีหลังก็ได้ */ }
      console.log("  (ไฟล์เดิมถูกเปิดค้างอยู่ — ย้ายออกแล้วเขียนไฟล์ใหม่แทน)");
    }
    console.log(`✅ ${path.relative(process.cwd(), OUT_PDF)} — ${pages} หน้า · ${mb} MB`);
  } catch (e) {
    console.log(`⚠️  เขียนทับ ${path.basename(OUT_PDF)} ไม่ได้ (${e.code}) — ไฟล์น่าจะถูกเปิดค้างอยู่`);
    console.log(`   ไฟล์ใหม่อยู่ที่ ${path.relative(process.cwd(), tmpPdf)} (${pages} หน้า · ${mb} MB)`);
    console.log(`   ปิดโปรแกรมที่เปิดไฟล์อยู่ แล้วรันซ้ำ หรือก็อปเองจาก .cache`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
