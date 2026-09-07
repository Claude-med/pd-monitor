/**
 * รวมคู่มือ 3 ไฟล์ markdown → HTML เล่มเดียว → PDF
 *   docs/manual-intro.md        = ส่วนหน้า (วิธีใช้คู่มือ + ฉันเป็นฝ่ายไหน)
 *   docs/tutorial-walkthrough.md = ภาค 1 ฝึกปฏิบัติ
 *   docs/user-guide.md           = ภาค 2 คู่มืออ้างอิง
 *
 * ฝังฟอนต์ Sarabun (ซับเซ็ตไทย U+0E01-0E5B ด้วย) + รูป base64 + paged.js ไว้ในไฟล์
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
const escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function renderSource(src) {
  const md = fs.readFileSync(path.join(DOCS, src.file), "utf8");
  let html = marked.parse(md, { mangle: false, headerIds: false });

  // เส้นคั่นที่อยู่ติดหน้า h1 ไม่ต้องมี — h1 ขึ้นหน้าใหม่อยู่แล้ว
  // (ถ้าปล่อยไว้ เส้นจะถูกดันไปนอนอยู่บนหน้าเปล่าของตัวเอง)
  html = html.replace(/<hr\s*\/?>\s*(?=<h1)/g, "");
  html = html.replace(/<hr\s*\/?>\s*$/, "");

  // ใส่ id ให้ h1/h2/h3 (prefix แยกตามภาค กัน id ชนกัน → target-counter ของสารบัญพัง)
  let n = 0;
  html = html.replace(/<h([123])>([\s\S]*?)<\/h\1>/g, (_m, lvl, inner) => {
    const id = `${src.prefix}-${++n}`;
    const text = inner.replace(/<[^>]+>/g, "").trim();
    toc.push({ id, lvl: Number(lvl), text });
    return `<h${lvl} id="${id}">${inner}</h${lvl}>`;
  });

  // <img> เดี่ยวใน <p> → <figure> + caption จาก alt
  html = html.replace(
    /<p>\s*<img src="([^"]+)" alt="([^"]*)"\s*\/?>\s*<\/p>/g,
    (_m, src2, alt) =>
      `<figure><img src="${src2}" alt="${escapeAttr(alt)}">` +
      (alt ? `<figcaption>${alt}</figcaption>` : "") +
      `</figure>`,
  );

  let out = "";
  if (src.divider) {
    const did = `${src.prefix}-part`;
    toc.unshift({ id: did, lvl: 0, text: `${src.divider.n} — ${src.divider.h}`, at: src.prefix });
    out += `<section class="part-divider" id="${did}"><div class="n">${src.divider.n}</div>` +
      `<h1>${src.divider.h}</h1><p>${src.divider.p}</p></section>`;
  }
  out += `<section${src.id ? ` id="${src.id}"` : ""}${src.cls ? ` class="${src.cls}"` : ""}>${html}</section>`;
  return out;
}

// ---------- ฝังรูปเป็น base64 ----------
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" };
let embedded = 0;
let missing = [];
function inlineImages(html) {
  return html.replace(/<img([^>]*?)src="((?!data:)[^"]+)"/g, (m, pre, rel) => {
    const file = path.join(DOCS, rel);
    if (!fs.existsSync(file)) {
      missing.push(rel);
      return m;
    }
    const mime = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    embedded++;
    return `<img${pre}src="data:${mime};base64,${fs.readFileSync(file).toString("base64")}"`;
  });
}

// ---------- ประกอบเล่ม ----------
const body = SOURCES.map(renderSource).join("\n");

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
</style></head><body>
<section class="cover">
  <div class="kicker">คู่มือฉบับสมบูรณ์</div>
  <h1>${TITLE}</h1>
  <div class="sub">${SUBTITLE}</div>
  <div class="badges">
    <span class="badge">ภาค 1 · ฝึกปฏิบัติ</span>
    <span class="badge">ภาค 2 · คู่มืออ้างอิง</span>
    <span class="badge">อัปเดตตามระบบจริง</span>
  </div>
  <div class="meta">ปรับปรุง: ${today}<br>สำหรับทุกฝ่าย — วางแผน · ผลิต · QC · QA · คลัง · วิศวกรรม · บัญชีต้นทุน · ผู้บริหาร</div>
</section>
<section class="toc"><h2>สารบัญ</h2><ol>${tocHtml}</ol></section>
${body}
<script>window.PagedConfig = { auto: false };</script>
<script src="./paged.polyfill.js"></script>
</body></html>`;

doc = inlineImages(doc);

fs.mkdirSync(CACHE, { recursive: true });
fs.copyFileSync(path.join(HERE, "vendor/paged.polyfill.js"), path.join(CACHE, "paged.polyfill.js"));
const htmlPath = path.join(CACHE, "manual.html");
fs.writeFileSync(htmlPath, doc, "utf8");

console.log(`หัวข้อในสารบัญ ${toc.length} · ฝังรูป ${embedded} · HTML ${(Buffer.byteLength(doc) / 1048576).toFixed(1)} MB`);
if (missing.length) console.log(`⚠️  ไม่พบรูป ${missing.length} ไฟล์: ${[...new Set(missing)].slice(0, 12).join(", ")}`);
if (process.argv.includes("--html-only")) process.exit(0);

// ---------- HTML → PDF ----------
const browser = await launch();
try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("  [หน้าเว็บ]", m.text().slice(0, 160)); });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 180000 });
  await page.evaluate(async () => { await window.PagedPolyfill.preview(); });
  const pages = await page.$$eval(".pagedjs_page", (els) => els.length);
  await page.pdf({
    path: OUT_PDF,
    printBackground: true,
    preferCSSPageSize: true,
    timeout: 300000,
  });
  const mb = (fs.statSync(OUT_PDF).size / 1048576).toFixed(1);
  console.log(`✅ ${path.relative(process.cwd(), OUT_PDF)} — ${pages} หน้า · ${mb} MB`);
} finally {
  await browser.close();
}
