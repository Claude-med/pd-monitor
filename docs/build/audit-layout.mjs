/** ตรวจการจัดหน้าทั้งเล่มจาก DOM หลัง paged.js — บอกทีละหน้าว่าเต็มแค่ไหน และมีอะไรอยู่ */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch } from "./lib.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const b = await launch();
const p = await b.newPage();
await p.goto(pathToFileURL(path.join(HERE, ".cache", "manual.html")).href, { waitUntil: "load", timeout: 180000 });
await p.evaluate(async () => { await window.PagedPolyfill.preview(); });
const rows = await p.evaluate(() => {
  const txt = e => e.textContent.replace(/\s+/g, " ").trim();
  return [...document.querySelectorAll(".pagedjs_page")].map((pg, i) => {
    const area = pg.querySelector(".pagedjs_page_content");
    if (!area) return { page: i + 1, fill: 0, kind: "?", first: "", last: "" };
    const box = area.getBoundingClientRect();
    const blocks = [...area.querySelectorAll("h1,h2,h3,h4,p,ul,ol,table,figure,blockquote,pre,li.lvl0,li.lvl1,li.lvl2,li.lvl3,div.sheet-notes")]
      .filter(e => e.getBoundingClientRect().height > 0);
    if (!blocks.length) return { page: i + 1, fill: 0, kind: "ว่าง", first: "", last: "" };
    const top = Math.min(...blocks.map(e => e.getBoundingClientRect().top));
    const bot = Math.max(...blocks.map(e => e.getBoundingClientRect().bottom));
    const kind = pg.className.includes("part1") ? "ภาค1" : pg.className.includes("part2") ? "ภาค2"
      : area.querySelector(".toc") || area.closest(".toc") ? "สารบัญ" : "หน้า";
    const last = blocks[blocks.length - 1];
    return {
      page: i + 1,
      fill: Math.round((bot - top) / box.height * 100),
      gapBottomMm: +(((box.bottom - bot) / 96 * 25.4)).toFixed(0),
      kind,
      first: txt(blocks[0]).slice(0, 46),
      lastTag: last.tagName + (last.className ? "." + String(last.className).split(" ")[0] : ""),
      last: txt(last).slice(0, 40),
    };
  });
});
console.log(`${rows.length} หน้า · เฉลี่ยเต็ม ${Math.round(rows.reduce((s,r)=>s+r.fill,0)/rows.length)}%\n`);
const arg = process.argv[2];
const pick = arg && arg.includes("-")
  ? (() => { const [a, z] = arg.split("-").map(Number); return (r) => r.page >= a && r.page <= z; })()
  : (r) => r.fill < (Number(arg) || 70);
console.log("รายการหน้าที่เลือก:");
for (const r of rows.filter(pick)) {
  console.log(`  หน้า ${String(r.page).padStart(3)} เต็ม ${String(r.fill).padStart(3)}% เว้นล่าง ${String(r.gapBottomMm).padStart(3)}มม. [${r.kind}] บนสุด: ${r.first}`);
  console.log(`            ล่างสุด (${r.lastTag}): ${r.last}`);
}
await b.close();
