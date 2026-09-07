// เครื่องมือร่วมสำหรับสคริปต์ทำคู่มือ — เปิด Chrome ที่ติดตั้งในเครื่อง แล้วล็อกอินเว็บจริง
import puppeteer from "puppeteer-core";

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

/** ล็อกอิน 1 บัญชีใน context แยก (คุกกี้ไม่ปนกัน → สลับบทบาทได้โดยไม่ต้อง logout) */
export async function loginAs(browser, email, password) {
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
