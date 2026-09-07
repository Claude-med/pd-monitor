import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch } from "./lib.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const b = await launch();
const p = await b.newPage();
await p.goto(pathToFileURL(path.join(HERE, ".cache", "manual.html")).href, { waitUntil: "load", timeout: 180000 });
await p.evaluate(async () => { await window.PagedPolyfill.preview(); });
const rows = await p.evaluate(() => {
  const HEAD = new Set(["H1","H2","H3","H4"]);
  const txt = e => e.textContent.replace(/\s+/g," ").trim();
  const out = [];
  document.querySelectorAll(".pagedjs_page").forEach((pg, i) => {
    const area = pg.querySelector(".pagedjs_page_content");
    if (!area) return;
    const box = area.getBoundingClientRect();
    const blocks = [...area.querySelectorAll("h1,h2,h3,h4,p,ul,ol,table,figure,blockquote,pre,div.sheet-notes")]
      .filter(e => e.getBoundingClientRect().height > 0);
    blocks.forEach((el, k) => {
      if (!HEAD.has(el.tagName)) return;
      const r = el.getBoundingClientRect();
      const after = blocks.slice(k+1).filter(x => !HEAD.has(x.tagName));
      const contentAfter = after.reduce((s,x) => s + x.getBoundingClientRect().height, 0);
      out.push({ page: i+1, tag: el.tagName,
                 fromBottomMm: +(((box.bottom - r.bottom) / 96 * 25.4)).toFixed(1),
                 afterMm: +((contentAfter / 96 * 25.4)).toFixed(1),
                 text: txt(el).slice(0, 58) });
    });
  });
  return out;
});
const thin = rows.filter(r => r.afterMm < 22);
console.log(`หัวข้อทั้งหมด ${rows.length} · หัวข้อที่มีเนื้อหาตามในหน้าเดียวกันน้อยกว่า 22 มม.: ${thin.length}`);
thin.forEach(r => console.log(`  หน้า ${String(r.page).padStart(3)} ${r.tag} เนื้อหาตาม ${String(r.afterMm).padStart(5)} มม. · ห่างขอบล่าง ${String(r.fromBottomMm).padStart(5)} มม.  ${r.text}`));
await b.close();
