// ============================================================
// สำรองข้อมูลทั้งฐาน (ทุกตารางใน schema public + รายชื่อบัญชีล็อกอิน) เป็นไฟล์ JSON ในเครื่อง
//
// ทำไมต้องมี: Supabase แพ็กเกจฟรี "ไม่มี backup" — ถ้าข้อมูลถูกลบ/แก้ผิด กู้คืนไม่ได้
//            สคริปต์นี้คือทางสำรองระหว่างที่ยังไม่อัปเกรด Pro (ดู docs/go-live-checklist.md)
//
// วิธีใช้ (ในโฟลเดอร์ web/):
//   node --env-file=.env.local scripts/backup-data.mjs
//   → ได้โฟลเดอร์ backups/YYYY-MM-DD_HHmm/ ที่ราก repo (ไม่ขึ้น GitHub — อยู่ใน .gitignore)
//   → ก็อปโฟลเดอร์นี้ไปเก็บอีกที่ด้วย (Google Drive / USB) กันเครื่องเสีย
//
// ⚠️ ไฟล์ที่ได้มีข้อมูลจริงทั้งหมด (ชื่อพนักงาน · อีเมล · บันทึกการผลิต) — เก็บให้ปลอดภัย ห้ามส่งต่อ
// ⚠️ ใช้ SUPABASE_SECRET_KEY (ข้าม RLS) อ่านอย่างเดียว ไม่เขียนอะไรลงฐานข้อมูล
// ℹ️ โครงสร้างตาราง/ฟังก์ชันไม่ได้อยู่ในไฟล์นี้ — อยู่ใน web/supabase/migrations/ (git) อยู่แล้ว
//    กู้คืน = ลง migration ทั้งชุดในโปรเจคใหม่ แล้วนำข้อมูลจาก JSON ใส่กลับ (ทำร่วมกับ Claude)
// ============================================================
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL || !KEY) {
  console.error(
    "❌ ไม่พบ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY\n" +
      "   รันจากโฟลเดอร์ web/ ด้วยคำสั่ง: node --env-file=.env.local scripts/backup-data.mjs",
  );
  process.exit(1);
}

const PAGE = 1000; // = เพดาน max-rows ของ Supabase
const supabase = createClient(URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── 1) รายชื่อตาราง + primary key จาก OpenAPI ของ PostgREST ─────────────
//    (ไม่ hardcode รายชื่อ — ตารางใหม่จาก migration อนาคตถูกสำรองด้วยอัตโนมัติ)
async function listTables() {
  const res = await fetch(`${URL}/rest/v1/`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`อ่านรายชื่อตารางไม่สำเร็จ (HTTP ${res.status})`);
  const spec = await res.json();
  const defs = spec.definitions ?? {};
  const paths = Object.keys(spec.paths ?? {})
    .filter((p) => p !== "/" && !p.startsWith("/rpc/"))
    .map((p) => p.slice(1));
  return paths.sort().map((name) => {
    const props = defs[name]?.properties ?? {};
    // PostgREST ใส่ "<pk/>" ไว้ใน description ของคอลัมน์ที่เป็น primary key
    const pk = Object.entries(props)
      .filter(([, v]) => String(v?.description ?? "").includes("<pk/>"))
      .map(([k]) => k);
    return { name, pk };
  });
}

// ── 2) ดึงทุกแถวทีละหน้า (เรียงตาม primary key กันแถวซ้ำ/หล่นระหว่างหน้า) ──
async function dumpTable({ name, pk }) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(name).select("*");
    for (const col of pk) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`${name}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// ── 3) บัญชีล็อกอิน (auth.users) — เก็บแค่ข้อมูลที่ใช้ผูกกับ profiles · ไม่มีรหัสผ่าน ──
async function dumpAuthUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth.users: ${error.message}`);
    for (const u of data.users) {
      users.push({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        banned_until: u.banned_until ?? null,
      });
    }
    if (data.users.length < 1000) break;
  }
  return users;
}

// ── main ────────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const stamp = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})
  .format(new Date())
  .replace(" ", "_")
  .replace(":", "");
const outDir = resolve(here, "..", "..", "backups", stamp);
mkdirSync(join(outDir, "tables"), { recursive: true });

console.log(`📦 สำรองข้อมูลไปที่ ${outDir}`);
const summary = { created_at: new Date().toISOString(), timezone: "Asia/Bangkok", tables: {} };
let failed = 0;

const tables = await listTables();
for (const t of tables) {
  try {
    const rows = await dumpTable(t);
    writeFileSync(join(outDir, "tables", `${t.name}.json`), JSON.stringify(rows, null, 1));
    summary.tables[t.name] = { rows: rows.length, order_by: t.pk };
    console.log(`  ✅ ${t.name.padEnd(32)} ${String(rows.length).padStart(7)} แถว`);
  } catch (e) {
    failed++;
    summary.tables[t.name] = { error: String(e.message ?? e) };
    console.log(`  ❌ ${t.name.padEnd(32)} ${e.message ?? e}`);
  }
}

try {
  const users = await dumpAuthUsers();
  writeFileSync(join(outDir, "auth_users.json"), JSON.stringify(users, null, 1));
  summary.auth_users = users.length;
  console.log(`  ✅ ${"(บัญชีล็อกอิน auth.users)".padEnd(32)} ${String(users.length).padStart(7)} บัญชี`);
} catch (e) {
  failed++;
  summary.auth_users = { error: String(e.message ?? e) };
  console.log(`  ❌ auth.users: ${e.message ?? e}`);
}

writeFileSync(join(outDir, "_summary.json"), JSON.stringify(summary, null, 2));
console.log(
  failed
    ? `\n⚠️ เสร็จแต่มี ${failed} รายการที่สำรองไม่สำเร็จ — ดู _summary.json`
    : `\n🎉 เสร็จครบ ${tables.length} ตาราง — อย่าลืมก็อปโฟลเดอร์นี้ไปเก็บอีกที่ด้วย`,
);
process.exit(failed ? 1 : 0);
