/**
 * เอกสารสั้น (markdown ไฟล์เดียว) → PDF A4 หน้าตาเดียวกับคู่มือ
 * ใช้ manual.css + ฟอนต์ Sarabun ฝังในไฟล์ + paged.js ชุดเดียวกับ build-pdf.mjs
 * ต่างจากคู่มือ: ไม่มีปกเต็มหน้า/สารบัญ · หัวเอกสารเป็นแถบบนหน้าแรก · h1 ไม่บังคับขึ้นหน้าใหม่
 *
 * ใช้:  node build-doc.mjs <ไฟล์.md> <ไฟล์.pdf> [--kicker "ข้อความเล็กเหนือชื่อ"]
 *   ชื่อเอกสาร = h1 บรรทัดแรกของ md (บรรทัดถัดไปที่ขึ้นต้นด้วย > = คำโปรย)
 *   ขึ้นหน้าใหม่ = <!--pagebreak-->
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { marked } from "marked";
import { launch } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, ".cache");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const kicker = flag("--kicker") ?? "PD Monitor";
const [inMd, outPdf] = args.map((a) => path.resolve(a));
if (!inMd || !outPdf) {
  console.log('ใช้: node build-doc.mjs <ไฟล์.md> <ไฟล์.pdf> [--kicker "..."]');
  process.exit(1);
}

function fontFaces() {
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "fonts/manifest.json"), "utf8"));
  return manifest
    .map((f) => {
      const b64 = fs.readFileSync(path.join(HERE, "fonts", f.file)).toString("base64");
      return `@font-face{font-family:'Sarabun';font-style:normal;font-weight:${f.weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${f.range};}`;
    })
    .join("\n");
}

// กล่องข้อความ 4 ชนิด — แยกสีตาม emoji ตัวแรก (ชุดเดียวกับ build-pdf.mjs)
const CALLOUTS = [
  { cls: "cal-warn", marks: ["⚠️", "🚨", "🔴"] },
  { cls: "cal-tip", marks: ["💡", "🎁"] },
  { cls: "cal-gmp", marks: ["🔒", "✅"] },
  { cls: "cal-perm", marks: ["🔑", "👔"] },
  { cls: "cal-note", marks: ["📌", "📎", "ℹ️"] },
];

let md = fs.readFileSync(inMd, "utf8").replace(/\r\n/g, "\n");
// ชื่อเอกสาร + คำโปรย ย้ายไปเป็นแถบหัวเอกสาร
const m = md.match(/^# (.+)\n+((?:> .*\n?)*)/);
if (!m) throw new Error("บรรทัดแรกของ md ต้องเป็น '# ชื่อเอกสาร'");
const title = m[1].trim();
const lead = m[2].split("\n").map((l) => l.replace(/^> ?/, "")).filter(Boolean);
md = md.slice(m[0].length);

let body = marked.parse(md, { mangle: false, headerIds: false });
body = body.replace(/<!--\s*pagebreak\s*-->/g, '<div class="page-break"></div>');
body = body.replace(/<blockquote>\s*<p>([\s\S]*?)<\/p>/g, (all, first) => {
  const c = CALLOUTS.find((x) => x.marks.some((mk) => first.trimStart().startsWith(mk)));
  return c ? all.replace("<blockquote>", `<blockquote class="${c.cls}">`) : all;
});
// รูปในเอกสาร (path ตาม md) → ฝังเป็น base64 ในไฟล์เดียว (HTML ถูกเขียนไว้ที่ .cache จึงอ้าง path เดิมไม่ได้)
body = body.replace(/<img([^>]*?)src="([^"]+)"/g, (all, pre, src) => {
  if (/^(data:|https?:)/.test(src)) return all;
  const f = path.resolve(path.dirname(inMd), src);
  if (!fs.existsSync(f)) {
    console.log(`⚠️  ไม่พบรูป ${src}`);
    return all;
  }
  const ext = path.extname(f).slice(1).toLowerCase().replace("jpg", "jpeg");
  return `<img${pre}src="data:image/${ext};base64,${fs.readFileSync(f).toString("base64")}"`;
});
const leadHtml = lead.map((l) => `<p>${marked.parseInline(l)}</p>`).join("");

const css = `
@page{ @top-left{ content:"${title.replace(/"/g, "")}"; font-family:'Sarabun',sans-serif; font-size:8pt; color:var(--faint); padding-bottom:3mm; } }
@page:first{ @top-left{ content:none } }
.doc h1{ break-before:auto; font-size:16pt; margin-top:7mm; }
.doc h1:first-child{ margin-top:0; }
.doc table{ font-size:9.8pt; }
.page-break{ break-before:page; }
.contact{ display:flex; gap:6mm; align-items:center; margin:3mm 0 4mm; padding:3mm 4mm; border:1px solid var(--line); border-radius:5px; }
.contact img{ width:30mm; height:30mm; }
.contact p{ margin:0 0 1mm; }
.doc-head{
  margin:-2mm 0 7mm; padding:7mm 8mm 6mm; border-radius:5px; color:#fff;
  background:linear-gradient(160deg,#064e3b 0%,#065f46 38%,#16a34a 100%);
}
.doc-head .k{ font-size:9pt; letter-spacing:.2em; text-transform:uppercase; opacity:.85; font-weight:600; }
.doc-head .t{ font-size:22pt; font-weight:800; line-height:1.2; margin:1.5mm 0 2mm; }
.doc-head a{ color:#fff; text-decoration:underline; font-weight:700; }
.doc-head p{ margin:0; font-size:10.5pt; opacity:.92; line-height:1.55; }
`;

const doc = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${title}</title>
<style>
${fontFaces()}
${fs.readFileSync(path.join(HERE, "manual.css"), "utf8")}
${css}
</style></head><body>
<div class="doc-head"><div class="k">${kicker}</div><div class="t">${title}</div>${leadHtml}</div>
<main class="doc">${body}</main>
<script>window.PagedConfig = { auto: false };</script>
<script src="./paged.polyfill.js"></script>
</body></html>`;

fs.mkdirSync(CACHE, { recursive: true });
fs.copyFileSync(path.join(HERE, "vendor/paged.polyfill.js"), path.join(CACHE, "paged.polyfill.js"));
const htmlPath = path.join(CACHE, `doc-${path.basename(inMd, ".md")}.html`);
fs.writeFileSync(htmlPath, doc, "utf8");

const browser = await launch();
try {
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("  [หน้าเว็บ]", msg.text().slice(0, 160));
  });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 120000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await window.PagedPolyfill.preview();
  });
  const pages = await page.$$eval(".pagedjs_page", (els) => els.length);
  fs.mkdirSync(path.dirname(outPdf), { recursive: true });
  const tmp = path.join(CACHE, "doc-out.pdf");
  await page.pdf({ path: tmp, printBackground: true, preferCSSPageSize: true, tagged: true, outline: true, timeout: 120000 });
  fs.copyFileSync(tmp, outPdf);
  console.log(`✅ ${path.relative(process.cwd(), outPdf)} — ${pages} หน้า · ${(fs.statSync(outPdf).size / 1024).toFixed(0)} KB`);
} finally {
  await browser.close();
}
