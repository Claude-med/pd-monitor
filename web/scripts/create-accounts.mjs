// ============================================================
// สร้างบัญชีผู้ใช้ทีละหลายบัญชีจากไฟล์ JSON (ทำแบบเดียวกับปุ่ม "สร้างบัญชีผู้ใช้ใหม่" ในหน้าจัดการผู้ใช้)
//
// วิธีใช้ (ในโฟลเดอร์ web/):
//   node --env-file=.env.local scripts/create-accounts.mjs <spec.json> [--out <ผลลัพธ์.json>]
//
// spec.json = [{ "email", "full_name", "department", "roles": ["qc_lead"], "password"?, "must_change"? }]
//   · ไม่ใส่ password → สุ่มให้ 10 ตัว (ตัวอักษร+ตัวเลข ไม่มีตัวที่สับสนง่าย เช่น 0/O 1/l)
//   · must_change (ค่าเริ่มต้น true) = บังคับตั้งรหัสเองตอนล็อกอินครั้งแรก (เหมือนบัญชีที่สร้างจากหน้าเว็บ)
//   · อีเมลที่มีบัญชีอยู่แล้ว = ข้าม (ไม่แตะบัญชีเดิม)
// ผลลัพธ์ (อีเมล + รหัสชั่วคราว) เขียนลง --out — ⚠️ มีรหัสผ่าน ห้ามขึ้น GitHub (เก็บใน backups/ หรือ docs/handoff/.private/)
//
// ⚠️ ใช้ SUPABASE_SECRET_KEY (ข้าม RLS) — ประวัติใน Audit จะไม่มีชื่อ "ผู้สร้าง" (ไม่ได้ทำผ่านหน้าเว็บ)
// ============================================================
import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL || !KEY) {
  console.error("❌ รันจากโฟลเดอร์ web/: node --env-file=.env.local scripts/create-accounts.mjs <spec.json>");
  process.exit(1);
}
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
const specPath = args.find((a, i) => !a.startsWith("--") && i !== outIdx + 1);
if (!specPath) {
  console.error("❌ ระบุไฟล์ spec.json");
  process.exit(1);
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const genPassword = (n = 10) => {
  // บังคับให้มีทั้งตัวพิมพ์ใหญ่ เล็ก และตัวเลข
  for (;;) {
    const p = Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    if (/[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p)) return p;
  }
};

const admin = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const results = [];

for (const a of spec) {
  const email = a.email.trim().toLowerCase();
  const password = a.password ?? genPassword();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: a.full_name },
  });
  if (error || !created?.user) {
    const msg = error?.message ?? "สร้างไม่สำเร็จ";
    console.log(`⏭️  ${email} — ${/already|exists/i.test(msg) ? "มีบัญชีอยู่แล้ว ข้าม" : msg}`);
    continue;
  }
  // trigger handle_new_user (0004) สร้าง/ผูกโปรไฟล์ตามอีเมลให้แล้ว
  const { data: prof } = await admin.from("profiles").select("id").eq("auth_user_id", created.user.id).maybeSingle();
  if (!prof?.id) {
    await admin.auth.admin.deleteUser(created.user.id);
    console.log(`❌ ${email} — ผูกโปรไฟล์ไม่สำเร็จ (ยกเลิกบัญชีนี้แล้ว)`);
    continue;
  }
  const fail = async (m) => {
    await admin.from("user_roles").delete().eq("profile_id", prof.id);
    await admin.auth.admin.deleteUser(created.user.id);
    console.log(`❌ ${email} — ${m} (ยกเลิกบัญชีนี้แล้ว)`);
  };
  const { error: pErr } = await admin
    .from("profiles")
    .update({
      full_name: a.full_name,
      department: a.department ?? null,
      must_change_password: a.must_change ?? true,
      is_active: true,
    })
    .eq("id", prof.id);
  if (pErr) { await fail(pErr.message); continue; }
  const { error: rErr } = await admin
    .from("user_roles")
    .insert(a.roles.map((role) => ({ profile_id: prof.id, role })));
  if (rErr) { await fail(rErr.message); continue; }

  results.push({ email, password, full_name: a.full_name, department: a.department ?? "", roles: a.roles });
  console.log(`✅ ${email} — ${a.roles.join(", ")}`);
}

if (outPath) {
  writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`\nบันทึกอีเมล + รหัสชั่วคราว ${results.length} บัญชี → ${outPath} (⚠️ ห้ามขึ้น GitHub)`);
}
