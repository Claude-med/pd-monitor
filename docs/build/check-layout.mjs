/**
 * ตรวจการจัดหน้าแบบวัดจริงจาก DOM หลัง paged.js จัดหน้าเสร็จ
 * (แม่นกว่าดูจากภาพ เพราะอ่านตำแหน่ง/ขนาดของทุกกล่องได้ตรง ๆ)
 *
 * รายงาน 5 อย่าง:
 *   1. หัวข้อที่อยู่ท้ายหน้าโดยไม่มีเนื้อหาตามในหน้าเดียวกัน  (หัวข้อหลุดไปคนละหน้ากับเนื้อหา)
 *   2. หัวข้อ/ข้อความที่ล้นกรอบหน้ากระดาษ
 *   3. หัวกระดาษซ้าย-ขวา ที่ยาวจนชนกันหรือล้นขอบ
 *   4. ตารางที่หัวตารางอยู่คนละหน้ากับแถวแรก
 *   5. รูปที่คำบรรยายหลุดไปคนละหน้ากับรูป
 *
 * ใช้:  node check-layout.mjs
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(HERE, ".cache", "manual.html");

if (!fs.existsSync(HTML)) {
  console.log("ยังไม่มี .cache/manual.html — รัน `node build-pdf.mjs --html-only` ก่อน");
  process.exit(1);
}

const browser = await launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href, { waitUntil: "load", timeout: 180000 });
  await page.evaluate(async () => {
    await window.PagedPolyfill.preview();
  });

  const report = await page.evaluate(() => {
    const HEAD = new Set(["H1", "H2", "H3", "H4"]);
    const txt = (e) => e.textContent.replace(/\s+/g, " ").trim();
    const out = { orphanHeads: [], overflow: [], headerClash: [], tableSplit: [], figureSplit: [], pages: 0 };

    const pages = [...document.querySelectorAll(".pagedjs_page")];
    out.pages = pages.length;

    pages.forEach((pg, idx) => {
      const n = idx + 1;
      const area = pg.querySelector(".pagedjs_page_content");
      if (!area) return;
      const box = area.getBoundingClientRect();

      // ── 1) หัวข้อท้ายหน้า: หัวข้อที่ไม่มีเนื้อหา "จริง" ตามหลังในหน้าเดียวกัน
      const blocks = [...area.querySelectorAll("h1,h2,h3,h4,p,ul,ol,table,figure,blockquote,pre,div.sheet-notes")]
        .filter((e) => e.getBoundingClientRect().height > 0);
      blocks.forEach((el, i) => {
        if (!HEAD.has(el.tagName)) return;
        const after = blocks.slice(i + 1).filter((x) => !HEAD.has(x.tagName));
        if (after.length === 0) {
          out.orphanHeads.push({ page: n, tag: el.tagName, text: txt(el).slice(0, 64) });
        }
      });

      // ── 2) ล้นกรอบหน้ากระดาษ
      area.querySelectorAll("h1,h2,h3,h4,p,table,pre,figure,li").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0) return;
        const overRight = r.right - box.right;
        const overBottom = r.bottom - box.bottom;
        if (overRight > 2 || overBottom > 2) {
          out.overflow.push({
            page: n, tag: el.tagName,
            right: Math.round(overRight), bottom: Math.round(overBottom),
            text: txt(el).slice(0, 60),
          });
        }
      });

      // ── 3) หัวกระดาษซ้าย/ขวาชนกัน
      const L = pg.querySelector(".pagedjs_margin-top-left-corner ~ div, .pagedjs_margin-top-left");
      const R = pg.querySelector(".pagedjs_margin-top-right");
      if (L && R) {
        const lr = L.getBoundingClientRect(), rr = R.getBoundingClientRect();
        const lt = txt(L), rt = txt(R);
        if (lt && rt) {
          const gap = rr.left - lr.right;
          if (gap < 6) out.headerClash.push({ page: n, gap: Math.round(gap), left: lt.slice(0, 30), right: rt.slice(0, 45) });
          // ข้อความยาวเกินกล่องของตัวเอง
          for (const [name, el2] of [["ซ้าย", L], ["ขวา", R]]) {
            if (el2.scrollWidth - el2.clientWidth > 2)
              out.headerClash.push({ page: n, gap: null, side: name, right: txt(el2).slice(0, 50) });
          }
        }
      }

      // ── 4) ตารางที่หัวตารางอยู่คนละหน้ากับแถวแรก
      area.querySelectorAll("table").forEach((t) => {
        const head = t.querySelector("thead");
        const firstRow = t.querySelector("tbody tr");
        if (head && !firstRow) out.tableSplit.push({ page: n, text: txt(head).slice(0, 60) });
      });

      // ── 5) รูปที่คำบรรยายหลุดจากรูป
      area.querySelectorAll("figure").forEach((f) => {
        const img = f.querySelector("img"), cap = f.querySelector("figcaption");
        if ((img && !cap) || (cap && !img)) {
          out.figureSplit.push({ page: n, text: txt(f).slice(0, 60) });
        }
      });
    });
    return report0(out);

    function report0(o) {
      return o;
    }
  });

  const say = (title, arr, fmt) => {
    console.log(`\n${title}: ${arr.length ? arr.length + " จุด" : "ไม่มี ✅"}`);
    arr.forEach((x) => console.log("   " + fmt(x)));
  };

  console.log(`ตรวจการจัดหน้า — ${report.pages} หน้า`);
  say("1) หัวข้อที่อยู่ท้ายหน้า ไม่มีเนื้อหาตามในหน้าเดียวกัน", report.orphanHeads,
    (x) => `หน้า ${String(x.page).padStart(3)} ${x.tag}  ${x.text}`);
  say("2) เนื้อหาที่ล้นกรอบหน้ากระดาษ", report.overflow,
    (x) => `หน้า ${String(x.page).padStart(3)} ${x.tag} ล้นขวา ${x.right}px ล่าง ${x.bottom}px  ${x.text}`);
  say("3) หัวกระดาษชนกัน / ล้น", report.headerClash,
    (x) => `หน้า ${String(x.page).padStart(3)} ${x.gap === null ? `ล้นฝั่ง${x.side}` : `ห่างกัน ${x.gap}px`}  ${x.right}`);
  say("4) ตารางที่หัวตารางหลุดจากแถวแรก", report.tableSplit,
    (x) => `หน้า ${String(x.page).padStart(3)}  ${x.text}`);
  say("5) รูปที่คำบรรยายหลุดจากรูป", report.figureSplit,
    (x) => `หน้า ${String(x.page).padStart(3)}  ${x.text}`);
} finally {
  await browser.close();
}
