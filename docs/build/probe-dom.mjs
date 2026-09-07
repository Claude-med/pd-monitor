import { launch, loginAs, BASE } from "./lib.mjs";
import fs from "node:fs";
const A = JSON.parse(fs.readFileSync("./.accounts.json", "utf8")).accounts;
const [role, url] = process.argv.slice(2);
const b = await launch();
const { page } = await loginAs(b, A[role].email, A[role].password);
await page.goto(BASE + url, { waitUntil: "networkidle2" });
await new Promise(r => setTimeout(r, 1200));
const tree = await page.evaluate(() => {
  const main = document.querySelector("main");
  const desc = (e, d) => {
    const t = e.textContent.replace(/\s+/g, " ").trim().slice(0, 46);
    const r = e.getBoundingClientRect();
    return "  ".repeat(d) + `<${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}.${(e.className || "").toString().split(" ").slice(0, 3).join(".")}> ${Math.round(r.width)}x${Math.round(r.height)} :: ${t}`;
  };
  const out = [];
  const walk = (el, d) => {
    if (d > 2) return;
    for (const c of el.children) { out.push(desc(c, d)); walk(c, d + 1); }
  };
  walk(main, 0);
  return out.join("\n");
});
console.log(tree);
await b.close();
