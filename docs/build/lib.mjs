// เครื่องมือร่วมสำหรับสคริปต์ทำคู่มือ — เปิด Chrome ที่ติดตั้งในเครื่อง แล้วล็อกอินเว็บจริง
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { freshTotp } from "./totp.mjs";

export const BASE = process.env.PD_BASE ?? "https://pd-monitor.vercel.app";
export const CHROME =
  process.env.PD_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

export const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

export async function launch({ headless = true } = {}) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless,
    defaultViewport: VIEWPORT,
    args: ["--lang=th-TH", "--hide-scrollbars", "--disable-dev-shm-usage"],
  });
}

/** รหัสลับ MFA ของบัญชีนี้ใน .accounts.json (ถ้ามี) */
function totpOf(email) {
  try {
    const acc = JSON.parse(fs.readFileSync(new URL("./.accounts.json", import.meta.url), "utf8")).accounts;
    return Object.values(acc).find((a) => a.email === email)?.totp ?? null;
  } catch {
    return null;
  }
}

/** ล็อกอิน 1 บัญชีใน context แยก (คุกกี้ไม่ปนกัน → สลับบทบาทได้โดยไม่ต้อง logout) */
export async function loginAs(browser, email, password, totpSecret = null) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  // React 19 action อาจไม่ทำให้เกิด navigation → รอจน URL ออกจาก /login หรือมีข้อความ error
  await page
    .waitForFunction(
      () =>
        !location.pathname.startsWith("/login") ||
        !!document.querySelector(".text-destructive"),
      { timeout: 20000 },
    )
    .catch(() => {});

  // ผู้บริหาร/admin ต้องยืนยันตัวตน 2 ชั้น (0110) → กรอกรหัส 6 หลักจากรหัสลับใน .accounts.json (ช่อง totp)
  // totpSecret === false = หยุดที่หน้า /mfa (ใช้ถ่ายภาพหน้ายืนยันตัวตน)
  if (new URL(page.url()).pathname === "/mfa" && totpSecret !== false) {
    const secret = totpSecret ?? totpOf(email);
    if (!secret) {
      await ctx.close();
      throw new Error(`${email} ต้องยืนยัน MFA แต่ไม่มีรหัสลับ (totp) ใน .accounts.json`);
    }
    await page.waitForSelector("#mfa-code", { visible: true, timeout: 20000 });
    await new Promise((r) => setTimeout(r, 2000)); // รอหน้า hydrate ก่อนกด ไม่งั้นฟอร์มส่งแบบธรรมดา
    await page.type("#mfa-code", await freshTotp(secret));
    await page.click('form button[type="submit"]');
    await page.waitForFunction(() => location.pathname !== "/mfa", { timeout: 30000 });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 20000 }).catch(() => {});
  }

  const url = new URL(page.url());
  if (url.pathname.startsWith("/login")) {
    const err = await page
      .$eval(".text-destructive", (el) => el.textContent.trim())
      .catch(() => "(ไม่มีข้อความ error บนหน้า)");
    await ctx.close();
    throw new Error(`ล็อกอิน ${email} ไม่สำเร็จ: ${err}`);
  }
  return { ctx, page, landedOn: url.pathname };
}
