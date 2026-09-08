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
 *   6. ตารางที่ต่อหน้าโดยไม่มีหัวตาราง (paged.js 0.4.3 ไม่ก็อปหัวตารางให้ — ห้ามมีเด็ดขาด)
 *   7. ตารางที่ถูกตัดข้ามหน้าทั้งที่รวมแล้วสูงไม่ถึงหนึ่งหน้า (ตัดโดยไม่จำเป็น)
 *   8. ย่อหน้าป้ายกำกับสั้น ๆ ที่ค้างท้ายหน้า แล้วตาราง/รูปของมันกระโดดไปหน้าถัดไป
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
    const out = { orphanHeads: [], overflow: [], headerClash: [], tableSplit: [], figureSplit: [],
                  tableNoHead: [], tableCutNeedlessly: [], labelSplit: [], pages: 0 };
    const PX2MM = 25.4 / 96;
    const parts = new Map();      // data-ref ของ paged.js → ชิ้นส่วนของตารางเดียวกันที่กระจายอยู่หลายหน้า
    const contentHeights = [];

    const pages = [...document.querySelectorAll(".pagedjs_page")];
    out.pages = pages.length;

    pages.forEach((pg, idx) => {
      const n = idx + 1;
      const area = pg.querySelector(".pagedjs_page_content");
      if (!area) return;
      const box = area.getBoundingClientRect();
      contentHeights.push(Math.round(box.height));

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
      //    6) ตารางที่ต่อหน้าโดยไม่มีหัวตาราง — คนอ่านไม่รู้ว่าคอลัมน์ไหนคืออะไร
      area.querySelectorAll("table").forEach((t) => {
        const head = t.querySelector("thead");
        const firstRow = t.querySelector("tbody tr");
        if (head && !firstRow) out.tableSplit.push({ page: n, text: txt(head).slice(0, 60) });
        if (!head && firstRow) out.tableNoHead.push({ page: n, text: txt(firstRow).slice(0, 60) });
        const ref = t.getAttribute("data-ref") || t.getAttribute("data-t") || `p${n}`;
        if (!parts.has(ref)) parts.set(ref, []);
        parts.get(ref).push({ page: n, h: t.getBoundingClientRect().height, head: !!head, t });
      });

      // ── 5) รูปที่คำบรรยายหลุดจากรูป
      area.querySelectorAll("figure").forEach((f) => {
        const img = f.querySelector("img"), cap = f.querySelector("figcaption");
        if ((img && !cap) || (cap && !img)) {
          out.figureSplit.push({ page: n, text: txt(f).slice(0, 60) });
        }
      });
    });
    // ── 7) ตารางที่ถูกตัดข้ามหน้าทั้งที่รวมแล้วสูงไม่ถึงหนึ่งหน้า
    //    ความสูงหนึ่งหน้า = ค่าที่พบบ่อยที่สุด (ปกเป็นหน้าไร้ขอบ ใช้เป็นตัวแทนไม่ได้)
    const freq = new Map();
    contentHeights.forEach((h) => freq.set(h, (freq.get(h) || 0) + 1));
    const pageH = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    parts.forEach((list) => {
      const pagesOf = [...new Set(list.map((x) => x.page))];
      if (pagesOf.length < 2) return;
      const total = list.reduce((sum, x) => sum + x.h, 0);
      const withHead = list.find((x) => x.head) || list[0];
      const label = txt(withHead.t.querySelector("thead") || withHead.t).slice(0, 50);
      if (total <= pageH) {
        out.tableCutNeedlessly.push({
          pages: pagesOf.join("+"),
          mm: Math.round(total * PX2MM),
          pageMm: Math.round(pageH * PX2MM),
          text: label,
        });
      }
    });

    // ── 8) ป้ายกำกับสั้นค้างท้ายหน้า แล้วของที่มันกำกับกระโดดไปหน้าถัดไป
    //    (ต้องเทียบข้ามหน้า เพราะ paged.js แยก DOM ของแต่ละหน้าออกจากกัน)
    const SEL8 = "h1,h2,h3,h4,p,ul,ol,table,figure,blockquote,pre,div.sheet-notes";
    const own = (e) => !e.parentElement || !e.parentElement.closest("blockquote,figure,table,li,thead,tbody");
    const blocksOf = (pg) => {
      const a = pg.querySelector(".pagedjs_page_content");
      return a ? [...a.querySelectorAll(SEL8)].filter((e) => e.getBoundingClientRect().height > 0 && own(e)) : [];
    };
    for (let i = 0; i + 1 < pages.length; i++) {
      const cur = blocksOf(pages[i]);
      const last = cur[cur.length - 1];
      if (!last || last.tagName !== "P") continue;
      const t = txt(last);
      if (t.length > 110) continue;
      const first = blocksOf(pages[i + 1])[0];
      if (!first || !["TABLE", "FIGURE", "PRE"].includes(first.tagName)) continue;
      out.labelSplit.push({ page: i + 1, next: first.tagName, text: t.slice(0, 56) });
    }
    return out;
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
  say("6) ตารางที่ต่อหน้าโดยไม่มีหัวตาราง", report.tableNoHead,
    (x) => `หน้า ${String(x.page).padStart(3)}  ${x.text}`);
  say("7) ตารางที่ถูกตัดข้ามหน้าทั้งที่ลงหน้าเดียวได้", report.tableCutNeedlessly,
    (x) => `หน้า ${x.pages}  สูง ${x.mm}มม. (พื้นที่หน้า ${x.pageMm}มม.)  ${x.text}`);
  say("8) ป้ายกำกับค้างท้ายหน้า แล้วตาราง/รูปไปอยู่หน้าถัดไป", report.labelSplit,
    (x) => `หน้า ${String(x.page).padStart(3)} → ${x.next}  ${x.text}`);
} finally {
  await browser.close();
}
