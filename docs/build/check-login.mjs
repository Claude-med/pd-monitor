// ตรวจว่าล็อกอินบัญชีที่ระบุได้จริงไหม:  node check-login.mjs <email> <password>
import { launch, loginAs } from "./lib.mjs";
const [email, password] = process.argv.slice(2);
const browser = await launch();
try {
  const { page, landedOn } = await loginAs(browser, email, password);
  const who = await page
    .$eval("aside", (el) => el.innerText.split("\n").filter(Boolean).slice(-6).join(" · "))
    .catch(() => "(อ่าน sidebar ไม่ได้)");
  console.log(`✅ ${email} เข้าได้ → ${landedOn}`);
  console.log(`   ท้าย sidebar: ${who}`);
} catch (e) {
  console.log(`❌ ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
