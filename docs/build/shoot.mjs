/**
 * ถ่ายสกรีนช็อตจากเว็บจริงตามทะเบียนใน shots.json → docs/manual-img/
 *
 *   node shoot.mjs                 ถ่ายทุกใบใน shots.json
 *   node shoot.mjs 20 21 30        ถ่ายเฉพาะ id ที่ขึ้นต้นด้วยเลขนี้
 *   node shoot.mjs --probe <role> <url>   ส่องหน้าเว็บ: หัวข้อ ปุ่ม และ selector ที่ใช้ได้
 *
 * ทุกใบเป็นการ "เปิดดู" อย่างเดียว ยกเว้นใบที่ระบุ actions ไว้ชัดเจน
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, loginAs, BASE, VIEWPORT } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../manual-img");
const ACCOUNTS = JSON.parse(fs.readFileSync(path.join(HERE, ".accounts.json"), "utf8")).accounts;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ทำ action ตามสคริปต์: click / type / select / wait / scrollTo / press / eval */
async function runActions(page, actions = []) {
  for (const a of actions) {
    if (a.click) {
      await page.waitForSelector(a.click, { visible: true, timeout: 20000 });
      await page.click(a.click);
    }
    if (a.clickText) {
      const [sel, text] = [a.clickText.sel ?? "button", a.clickText.text];
      const ok = await page.evaluate(
        (s, t) => {
          const el = [...document.querySelectorAll(s)].find((e) => e.textContent.includes(t));
          if (el) { el.scrollIntoView({ block: "center" }); el.click(); return true; }
          return false;
        }, sel, text);
      if (!ok) throw new Error(`ไม่เจอปุ่มที่มีข้อความ "${text}" (${sel})`);
    }
    if (a.type) { await page.waitForSelector(a.type.sel, { visible: true }); await page.type(a.type.sel, a.type.text, { delay: 12 }); }
    if (a.select) { await page.select(a.select.sel, a.select.value); }
    if (a.waitFor) await page.waitForSelector(a.waitFor, { visible: true, timeout: 25000 });
    if (a.scrollTo) {
      await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "center" }), a.scrollTo);
    }
    if (a.eval) await page.evaluate(a.eval);
    await sleep(a.pause ?? 350);
  }
}

/** หา "การ์ด" (ลูกโดยตรงของคอลัมน์เนื้อหา) ที่มีข้อความที่ระบุ แล้วติดป้ายให้ screenshot ได้ */
async function markCard(page, needle) {
  const ok = await page.evaluate((t) => {
    const norm = (e) => e.textContent.replace(/\s+/g, " ").trim();
    const col = document.querySelector("main > div") ?? document.querySelector("main");
    const kids = [...col.children];
    const toCard = (el) => {
      let cur = el;
      while (cur && cur.parentElement !== col) cur = cur.parentElement;
      return cur;
    };
    // 1) หาจากหัวข้อก่อน (แม่นสุด)
    let hit = null;
    for (const h of document.querySelectorAll("main h1, main h2, main h3")) {
      if (norm(h).includes(t)) { hit = toCard(h); break; }
    }
    // 2) ไม่มีหัวข้อ → เอาการ์ดที่ข้อความ "ขึ้นต้น" ด้วยคำนั้น (กันไปโดนคำที่โผล่กลางย่อหน้า)
    if (!hit) hit = kids.find((c) => norm(c).slice(0, 90).includes(t));
    if (!hit) return false;
    document.querySelectorAll("[data-shot]").forEach((e) => e.removeAttribute("data-shot"));
    hit.setAttribute("data-shot", "1");
    hit.scrollIntoView({ block: "center" });
    return true;
  }, needle);
  if (!ok) throw new Error(`ไม่เจอการ์ดที่มีหัวข้อ "${needle}"`);
  return "[data-shot]";
}

async function shootOne(page, shot) {
  if (shot.viewport) await page.setViewport({ ...VIEWPORT, ...shot.viewport });
  else await page.setViewport(VIEWPORT);
  await page.goto(BASE + shot.url, { waitUntil: "networkidle2", timeout: 60000 });
  if (shot.waitFor) await page.waitForSelector(shot.waitFor, { visible: true, timeout: 30000 });
  await sleep(shot.settle ?? 700);
  await runActions(page, shot.actions);
  // ซ่อนป้าย "อัปเดตสด" ที่ลอยทับมุมจอ ยกเว้นใบที่ตั้งใจถ่ายมัน
  if (!shot.keepLiveBadge) {
    await page.evaluate(() => {
      for (const el of document.querySelectorAll("body *")) {
        const cs = getComputedStyle(el);
        if (cs.position === "fixed" && el.textContent.includes("อัปเดตสด")) el.style.visibility = "hidden";
      }
    });
  }
  await sleep(200);

  const file = path.join(OUT, `${shot.id}.png`);
  const target = shot.card ? await markCard(page, shot.card) : (shot.target ?? "page");
  if (target === "full") {
    await page.screenshot({ path: file, fullPage: true });
  } else if (target === "page") {
    await page.screenshot({ path: file });
  } else {
    const el = await page.$(target);
    if (!el) throw new Error(`ไม่เจอ element "${target}"`);
    await el.screenshot({ path: file });
  }
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  return `${shot.id}.png (${kb} KB)`;
}

// ---------- probe ----------
async function probe(browser, role, url) {
  const { page } = role === "-" ? { page: await browser.newPage() } : await loginAs(browser, ACCOUNTS[role].email, ACCOUNTS[role].password);
  await page.goto(BASE + url, { waitUntil: "networkidle2" });
  await sleep(1200);
  const info = await page.evaluate(() => {
    const txt = (e) => e.textContent.replace(/\s+/g, " ").trim().slice(0, 70);
    return {
      title: document.title,
      path: location.pathname + location.search,
      headings: [...document.querySelectorAll("h1,h2,h3")].map((e) => `${e.tagName} ${txt(e)}`).slice(0, 40),
      buttons: [...document.querySelectorAll("button, a[href]")].map(txt).filter(Boolean).slice(0, 60),
      landmarks: ["main", "aside", "header", "form", "table", "section"]
        .map((s) => `${s}=${document.querySelectorAll(s).length}`).join(" "),
      ids: [...document.querySelectorAll("[id]")].map((e) => "#" + e.id).slice(0, 40),
    };
  });
  console.log(JSON.stringify(info, null, 2));
}

// ---------- main ----------
const args = process.argv.slice(2);
const browser = await launch();
try {
  if (args[0] === "--probe") {
    await probe(browser, args[1], args[2]);
  } else {
    fs.mkdirSync(OUT, { recursive: true });
    const shots = JSON.parse(fs.readFileSync(path.join(HERE, "shots.json"), "utf8"));
    const filter = args.filter((a) => !a.startsWith("--"));
    const todo = filter.length ? shots.filter((s) => filter.some((f) => s.id.startsWith(f))) : shots;
    console.log(`จะถ่าย ${todo.length} / ${shots.length} ใบ`);

    const sessions = new Map();
    let ok = 0;
    const fails = [];
    for (const shot of todo) {
      const role = shot.role ?? "manager";
      if (!sessions.has(role)) {
        const a = ACCOUNTS[role];
        sessions.set(role, role === "-" ? { page: await browser.newPage() } : await loginAs(browser, a.email, a.password));
        console.log(`  · เข้าสู่ระบบเป็น ${role}`);
      }
      try {
        console.log(`  ✓ ${await shootOne(sessions.get(role).page, shot)}`);
        ok++;
      } catch (e) {
        console.log(`  ✗ ${shot.id}: ${e.message.split("\n")[0].slice(0, 110)}`);
        fails.push(shot.id);
      }
    }
    console.log(`\nสำเร็จ ${ok}/${todo.length}` + (fails.length ? ` · ไม่ผ่าน: ${fails.join(", ")}` : ""));
  }
} finally {
  await browser.close();
}
