# 📝 บันทึกงาน — โปรเจคระบบติดตามการผลิตยา (PD Monitor)

> ไฟล์นี้ไว้สำหรับ "ส่งต่องาน" — พรุ่งนี้กลับมาเปิดอ่านไฟล์นี้ก่อน จะรู้ว่าวันนี้ทำอะไรไป และต้องทำอะไรต่อ

---

## 📅 บันทึกวันที่ 22 มิถุนายน 2569 — เฟส 5 / D5 (ล่าสุด)

### ✅ วันนี้ทำอะไรไปบ้าง — ฟอร์มบันทึกผลผลิตรายวัน + validation ฝั่ง server + audit 🎉
1. **เช็ก Notion ก่อนเริ่ม** — fetch หน้า demo-feature-suggestions: เป็น 10 ฟีเจอร์เดิม ไม่มี requirement ใหม่
   (D5 ตรงกับข้อ 9 "Decimal Input & Validation" + ข้อ 5 "History/Activity Log")
2. **DB (ไฟล์ `web/supabase/migrations/0007_production_records.sql`)** — ⏳ รอ paste:
   - ฟังก์ชัน `add_production_record(...)` แบบ `security definer` = **ด่านตัดสินความถูกต้องที่ server**
     (แพตเทิร์นเดียวกับ `advance_job_status` ของ D4)
   - ตรวจ: ล็อกอิน · สิทธิ์เฉพาะ production/manager · **guard สถานะ** (บันทึกได้เฉพาะ in_production/qc/qa —
     ก่อนหน้ายังไม่ผลิต, FG ล็อกแล้วตาม A5)
   - validate: input/output จำเป็น · ห้ามติดลบ · รองรับทศนิยม · `output ≤ input` · `output + loss ≤ input` ·
     ชม. 0–24 · วันที่ล้ำอนาคตไม่ได้
   - ตั้ง audit GUC (`app.current_profile_id` + เหตุผล) → trigger บันทึก **ใครกรอก** อัตโนมัติ (ALCOA Attributable/Accurate)
3. **แอป (`web/`)** — สร้างครบ + build ผ่าน:
   - `lib/data/station-constants.ts` — ค่าคงที่สถานี (prep/mixing/tableting/packing) + `validateRecord()`
     **ใช้ร่วม client/server** (ตรรกะตรงกับ DB) + `RECORDABLE_STATUSES`
   - `lib/data/production.ts` — `getRecordsForJob()` (join ชื่อผู้บันทึกผ่าน FK `operator_id`)
   - `board/[jobNo]/record-actions.ts` (server action `addRecord` → rpc) + `record-form.tsx`
     (ฟอร์ม decimal input `step="any"`, validate ทันทีฝั่ง client, error แยกช่อง)
   - หน้า `board/[jobNo]/page.tsx` — เพิ่มตารางบันทึกผลผลิต + ปุ่ม/ฟอร์ม
     (แสดงฟอร์มเฉพาะคนมีสิทธิ์ + สถานะที่บันทึกได้ · ไม่งั้นขึ้นข้อความอธิบาย)
4. **ทดสอบ:** `npm run build` ผ่าน (TypeScript เคลียร์ · ทุก route generate ครบ)

### ⚠️ ขั้นที่ผู้ใช้ต้องทำเอง
- **paste `0007_production_records.sql`** ลง Supabase SQL Editor (ต่อจาก 0001–0006) → ปุ่มบันทึกผลผลิตถึงจะทำงาน
  (ถ้ายังไม่ paste: ตารางบันทึกเดิมดูได้ แต่กดบันทึกจะ error "ไม่พบฟังก์ชัน")
- ทดสอบ: login เป็น **production** เปิด JOB-001 (in_production) → กด "+ บันทึกผลผลิต"
  ลองกรอก output > input หรือค่าติดลบ ดูว่า DB/ฟอร์มปฏิเสธ · กรอกถูกต้องดูว่าบันทึก + ขึ้นในตาราง
- 📌 rpc นี้ต้องมี session ผู้ใช้จริง (อิง `auth.uid()`) → ทดสอบผ่าน REST+secret key ไม่ได้ ต้อง login ทดสอบ (เหมือน D4)

### ▶️ ขั้นถัดไป (D6)
- **D6**: Daily Report + **QC/QA approve-reject + e-signature (lite)** — ยืนยันรหัสผ่านซ้ำตอนอนุมัติ/ตีกลับ
  + ตาราง `approvals` (เก็บชื่อ/ผลตัดสิน/เหตุผล/เวลา) ตาม recommendations.md A3
  (อ่าน `docs/recommendations.md` A3 + fetch Notion เช็ก requirement ใหม่ก่อน)

---

## 📅 บันทึกวันที่ 22 มิถุนายน 2569 — เฟส 4 / D4

### ✅ วันนี้ทำอะไรไปบ้าง — บอร์ดงาน + รายละเอียด job + กันข้ามสถานะ 🎉
1. **เช็ก Notion ก่อนเริ่ม** — ไม่มี requirement ใหม่ · ใช้ดีไซน์ board จาก prototype ที่ทีม/CEO อนุมัติ
   (kanban ตามสถานะ + filter bar + KPI cards + การ์ดงาน) · ผู้ใช้เลือก **kanban บนคอม / ลิสต์ซ้อนบนมือถือ**
2. **DB (ไฟล์ `web/supabase/migrations/0006_job_transitions.sql`)** — ⏳ รอ paste:
   - ฟังก์ชัน `advance_job_status(job_id, to, reason)` **บังคับลำดับสถานะที่ server** (กันข้ามขั้น)
   - ตรวจสิทธิ์ตาม role · reject ต้องมีเหตุผล · บันทึก audit (set GUC ใครทำ/เหตุผล)
   - flow: รอแจ้งผลิต→มีแผนแล้ว→กำลังผลิต→QC→QA→FG · reject: QC/QA→กำลังผลิต
3. **แอป (`web/`)** — สร้างครบ + build ผ่าน:
   - `lib/data/job-constants.ts` (สี/label/transitions — ใช้ได้ทั้ง server/client) + `lib/data/jobs.ts` (query join)
   - `app/(app)/board/page.tsx` + `board-view.tsx` — KPI + search/filter (job/lot/ลูกค้า/ยา/สถานะ/เฉพาะปัญหา)
     + kanban responsive · การ์ดสีตามสถานะ + ป้ายปัญหา
   - `app/(app)/board/[jobNo]/page.tsx` — รายละเอียด + stepper สถานะ + ปุ่มเปลี่ยนสถานะตาม role
     (`job-actions.tsx` + `actions.ts` เรียก rpc) · ตีกลับมีช่องเหตุผล
   - เปิดเมนู "บอร์ดงาน" ใน nav (ready=true)
4. **ทดสอบ:** build ผ่าน · embed join query คืนข้อมูลถูก (ลูกค้า/ยา/lot) · proxy กันหน้าได้

### ⚠️ ขั้นที่ผู้ใช้ต้องทำเอง
- **paste `0006_job_transitions.sql`** ลง Supabase SQL Editor (ต่อจาก 0001-0005) → ปุ่มเปลี่ยนสถานะถึงจะทำงาน
  (ถ้ายังไม่ paste: หน้าบอร์ด/รายละเอียดดูได้ แต่กดเปลี่ยนสถานะจะ error "ไม่พบฟังก์ชัน")
- ทดสอบ: login เป็น role ต่างกัน (เช่น production กด "ส่งตรวจ QC", qc กด "ผ่าน/ตีกลับ") ดูว่ากันข้ามขั้น/สิทธิ์ได้

### ▶️ ขั้นถัดไป (D5)
- **D5**: ฟอร์มบันทึกผลิตรายวัน · decimal/validation ฝั่ง server · ผูก batch/lot · เขียนลง audit
  (อ่าน `docs/recommendations.md` C2 + fetch Notion เช็ก requirement ใหม่ก่อน)

---

## 📅 บันทึกวันที่ 22 มิถุนายน 2569 — เฟส 3 / D3

### ✅ วันนี้ทำอะไรไปบ้าง — ระบบล็อกอิน + สิทธิ์ตาม role + PWA 🎉
1. **เช็ก Notion ก่อนเริ่ม** — อ่านหน้า `demo-feature-suggestions` + `full-demo-decision` (ทีมสรุปทิศ
   "Production-first, quality-controlled, ERP-ready") · ไม่มี requirement ใหม่ที่ขัดแผน · D3 ตรงกับ "สิ่งที่ยังขาด"
2. **อ่าน docs Next.js 16 ก่อนเขียน** (ตาม `web/AGENTS.md`) — พบ breaking change: `middleware` → **`proxy`**
3. **DB (ไฟล์ `web/supabase/migrations/0004_auth_roles.sql`)** — ⏳ รอ paste ลง Supabase:
   - เพิ่ม `email` ใน profiles + trigger `handle_new_user` auto-link `auth.users` → profile ตามอีเมล
   - helper `current_profile_id()` + `has_role(role)` (security definer, wrap `auth.uid()` ตาม B1)
   - RLS policy แยกตาม role ทับ baseline 0003 (ผลิต/manager เขียน production_records, manager เขียน orders/products,
     audit_log อ่านได้เฉพาะ manager/qa ฯลฯ)
   - ใส่อีเมลให้ profiles ตัวอย่าง 5 ตัว → ใช้เป็นบัญชี demo ได้ทันที
4. **แอป (`web/`)** — สร้างครบ + build ผ่าน + ทดสอบ proxy:
   - `proxy.ts` + `lib/supabase/proxy-session.ts` — รีเฟรช session + กันหน้า protected (ยังไม่ login → เด้ง /login)
   - `lib/auth/dal.ts` (getUser/getProfile + role) · `lib/supabase/admin.ts` (secret key, server-only)
   - `app/login/` (ฟอร์ม useActionState) · `app/actions/auth.ts` (login/logout server actions)
   - `app/(app)/layout.tsx` + `app/(app)/page.tsx` (dashboard นับงานตาม status สดจาก DB)
   - `components/app-shell.tsx` — sidebar + เมนูตาม role + **เมนูมือถือปิดเองหลังเลือก** (requirement ข้อ 10)
   - `app/manifest.ts` + `public/icon.svg` — **PWA ติดตั้งหน้าจอได้** (C1)
5. **ทดสอบ:** `npm run build` ผ่าน · `GET /` (ยังไม่ login) → 307 ไป `/login` · `/login` 200 · manifest 200 ✅

### ⚠️ ขั้นที่ผู้ใช้ต้องทำเอง (โค้ดพร้อม + push แล้ว — แต่ยังใช้ login ไม่ได้จนกว่าจะทำ 2 ขั้นนี้)
1. **paste `0004_auth_roles.sql`** ลง Supabase SQL Editor (ต่อจาก 0001-0003+seed)
2. **สร้างบัญชี Auth** ใน Supabase → Authentication → Users → Add user (ติ๊ก **Auto Confirm User**)
   ใช้อีเมล demo 5 ตัว (เช่น `manop.mgr@pdmonitor.app` = ผู้บริหาร) — รายละเอียดใน `web/supabase/README.md`
3. เปิด https://pd-monitor.vercel.app → ล็อกอิน → เห็นเมนูตามสิทธิ์

### ▶️ ขั้นถัดไป (D4)
- เริ่ม **D4**: หน้า board + job · สถานะปัญหา/สี/search/filter · **state-machine guard** (กันข้ามสถานะ)
  (อ่าน `docs/recommendations.md` C3 + fetch Notion เช็ก requirement ใหม่ก่อน)

### 💡 Backlog / ค้างไว้คุยต่อ (เกิดจากคำถามผู้ใช้ 22 มิ.ย.)
- **หน้า admin จัดการผู้ใช้** (เสริม นอก roadmap D1–D9) — สร้างบัญชี + กำหนด role + **รีเซ็ตรหัสผ่าน**
  ในแอปเอง ไม่ต้องเข้า Supabase dashboard · ใช้ `lib/supabase/admin.ts` (secret key) +
  `auth.admin.updateUserById()` · เหมาะกับโรงงาน (คนงานหน้าไลน์มักไม่มีอีเมลจริง → admin รีเซ็ตให้)
  → ยังไม่ตัดสินใจว่าจะแทรกเฟสไหน (ถามผู้ใช้ก่อน)
- หมายเหตุความปลอดภัยที่อธิบายผู้ใช้แล้ว: รหัสผ่านเก็บแบบ hash ดูย้อนหลังไม่ได้ — admin "ตั้งใหม่" ได้ ไม่ใช่ "อ่านของเดิม"

---

## 📅 บันทึกวันที่ 22 มิถุนายน 2569 — เฟส 2 / D2

### ✅ วันนี้ทำอะไรไปบ้าง — ออกแบบฐานข้อมูล (schema) 🎉
1. **เช็ก Notion ก่อนเริ่ม** — ไม่มี requirement ใหม่จากทีม (Dev Log ทีมยืนยัน D2 = ออกแบบ DB + role + audit log)
2. **เขียนไฟล์ SQL migration ครบชุด** ใน `web/supabase/` (ตามที่ตกลง: เขียนไฟล์ → ผู้ใช้ paste เองใน Supabase)
   - `migrations/0001_schema.sql` — 8 ตาราง + 4 enum + คอลัมน์ ALCOA+ (`created_by/updated_by/created_at/updated_at/version`)
     + trigger `set_row_meta` (เวลา server + เพิ่ม version + กันแก้ created_at/by)
     ตาราง: `profiles, user_roles, products, orders, batches, jobs, production_records`
   - `migrations/0002_audit_log.sql` — `audit_log` **append-only** + trigger `log_audit` ผูกทุกตารางหลัก (A1)
     · ดึง "ใครทำ/เหตุผล" จาก GUC `app.current_profile_id`/`app.audit_reason` (server ตั้งใน D3+)
     · กันแก้/ลบ audit_log ด้วย trigger + revoke
   - `migrations/0003_rls.sql` — **เปิด RLS ทุกตาราง** (B1, default-deny) · baseline: authenticated อ่านได้
     · เขียนผ่าน server (secret key bypass RLS) · policy แยก role ค่อยทับใน D3
   - `seed.sql` — ข้อมูลตัวอย่าง (5 profiles ครบ role, 3 ยา, 3 orders, 2 batches, 3 jobs [มี 1 งานติดปัญหา], 3 daily records)
   - `README.md` — คู่มือ paste ทีละขั้นภาษาไทย
3. **Design choices สำคัญ:**
   - state machine `job_status`: รอแจ้งผลิต→มีแผนแล้ว→กำลังผลิต→QC→QA→FG (requirement ข้อ 2)
   - `problem_flag` แยกจาก flow หลัก (ติดปัญหา/รอแก้/ล่าช้า — ข้อ 3) · station: prep/mixing/tableting/packing
   - `profiles` standalone (ยังไม่ผูก `auth.users`) → seed ได้เลย ผูก auth ใน D3 ผ่าน `auth_user_id`
   - CHECK ระดับ DB: `output_qty <= input_qty`, ห้ามติดลบ, `expiry > manufacture` (C2/A4)

### ✅ ลง Supabase + verify แล้ว (22 มิ.ย. 69)
ผู้ใช้ paste 0001→0002→0003→seed สำเร็จ · Claude ตรวจผ่าน REST API:
8 ตารางครบ · seed เข้าครบ · audit_log=24 (trigger ครบ) · RLS กัน anon ได้ ·
CHECK output≤input ปฏิเสธ (HTTP 400) · audit_log append-only กัน UPDATE ได้จริง

### ▶️ ขั้นถัดไป (D3)
- หลัง paste schema สำเร็จ → เริ่ม **D3**: auth + role + permission helper (`has_role` security definer)
  · PWA manifest · responsive layout · ผูก `profiles.auth_user_id` กับ Supabase Auth
  · ใส่ RLS policy แยกตาม role ทับ baseline ใน 0003
  (อ่าน `docs/recommendations.md` หมวด B/C + fetch Notion เช็ก requirement ใหม่ก่อน)

---

## 📅 บันทึกวันที่ 19 มิถุนายน 2569 — เฟส 1 / D1

### ✅ วันนี้ทำอะไรไปบ้าง — เริ่มสร้างแอปจริง 🎉
1. **Scaffold แอปจริง Next.js ในโฟลเดอร์ `web/`** (ของเดิม prototype/ ยังอยู่ครบ ไม่กระทบ)
   - Next.js 16 + TypeScript + Tailwind v4 + App Router · ฟอนต์ไทย Noto Sans Thai · `lang="th"`
   - shadcn/ui ติดตั้งแล้ว (`components.json`, ปุ่มตัวอย่าง, `lib/utils.ts`)
   - หน้าแรกเป็น placeholder ภาษาไทย "PD Monitor — เฟส 1 พร้อมแล้ว"
2. **วาง Supabase client แบบ server-first** (`web/lib/supabase/server.ts` + `client.ts` ใช้ `@supabase/ssr`)
   - ตั้งชื่อ key ถูกหลัก: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
     (key รุ่นใหม่ `sb_publishable_`/`sb_secret_` — anon เลิกใช้สิ้นปี 2026 ตาม recommendations.md B2)
   - ค่าจริงอยู่ใน `web/.env.local` (ไม่ขึ้น git) · อัปเดต `.env.example` ให้ naming ตรงกัน
3. **ทดสอบผ่าน:** `npm run build` ผ่าน + `npm run dev` เปิด `localhost:3000` ขึ้นหน้าไทย HTTP 200 ✅
4. **Commit + push ขึ้น GitHub แล้ว** (`f0573da` บน master) — repo เป็น public แล้ว เลยลอง auto-deploy

### ⚠️ ขั้นที่ต้องทำต่อในแดชบอร์ด Vercel (ต้องทำในบัญชีเอง — โค้ดพร้อมแล้ว)
แอปจริงอยู่ใน `web/` แต่ Vercel project ยังชี้ Root Directory = `prototype` อยู่ ต้องตั้งค่าให้ build `web/`:
1. Vercel → project ที่ผูกกับ repo `pd-monitor` → **Settings → Build → Root Directory** เปลี่ยนเป็น `web`
2. **Settings → Environment Variables** (Production) เพิ่ม 3 ตัว (คัดค่าจาก `web/.env.local`):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
3. Redeploy (หรือ push อีกครั้งให้ auto-deploy) → เช็กว่าหน้าใหม่ขึ้น (ไม่ใช่ prototype เดิม)
- ถ้ายังขึ้น prototype = ยังไม่เปลี่ยน Root Directory · ถ้า build error เรื่อง env = ยังไม่ใส่ env vars
- 📌 หมายเหตุ: เห็น manual `vercel --prod` รันไปที่ org **claude-work** แยกต่างหาก (ไม่เกี่ยวกับ auto-deploy นี้)

### ▶️ ขั้นถัดไป (D2)
- ตั้งค่า Vercel ตามด้านบนให้ auto-deploy ขึ้น `web/` สำเร็จก่อน (ปิดงาน D1)
- แล้วเริ่ม **D2**: ออกแบบ schema + seed · เปิด RLS ทุกตาราง · `audit_log` trigger · คอลัมน์ ALCOA · batch mfg/expiry
  (อ่าน `docs/recommendations.md` หมวด A/B/D + fetch Notion เช็ก requirement ใหม่ก่อน)

---

## 📅 บันทึกวันที่ 19 มิถุนายน 2569

### ✅ วันนี้ทำอะไรไปบ้าง
1. **จัดไฟล์ตั้งต้นโปรเจค** — เพิ่ม `CLAUDE.md` (โหลดอัตโนมัติทุก session), `README.md`, `.env.example`,
   skill `handoff` (จบงาน → อัปเดต note + memory + push)
2. **เชื่อม Notion ของทีม** — ดึง requirement (Lean PRD + 10 ฟีเจอร์ที่น้องๆ เสนอ) มาเก็บที่
   `docs/requirements-from-notion.md` · page หลัก `38092ef2-c18f-803d-bb95-f49546a4f466`
3. **ค้นข้อมูลภายนอก → เขียนคำแนะนำคุณภาพ** `docs/recommendations.md` (GMP/ALCOA+, RLS, state machine,
   PWA, batch traceability) + ปรับ roadmap ดึง security/audit มา D2–D3
4. **ปรับ prototype (demo) ตามคำแนะนำ + 10 ฟีเจอร์ทีม** ⭐ งานหลักวันนี้:
   - board: ค้นหา/กรอง (job/lot/ลูกค้า/ยา/สถานะ) + ป้ายงาน "ติดปัญหา/ล่าช้า" เด่น
   - record: validation (output ≤ input, ห้ามติดลบ, ทศนิยม) + เตือนเมื่อทำผิดลำดับ station
   - job: Activity Log (จำลอง audit) + ปุ่ม QC/QA อนุมัติ/ตีกลับ (ตีกลับต้องมีเหตุผล) + วัน Mfg/Exp
   - mobile menu ปิดเองหลังเลือกหน้า
   - ทดสอบ syntax + logic ผ่านหมด (validateRecord, flag, data shape)

### 🌐 ลิงก์ demo ใหม่ (ใช้ตัวนี้!)
**https://prototype-omega-eight.vercel.app** ← demo เวอร์ชันล่าสุดครบฟีเจอร์ (โชว์ CEO ตัวนี้)

### ⚠️ ปัญหา Vercel เดิม (สำคัญ — กันงง)
- `pd-monitor.vercel.app` (โปรเจคเดิมใต้ทีม **claude-work**, ผูก GitHub) **ค้างที่เวอร์ชัน 4 ชม.ก่อน**
  เพราะ Vercel **บล็อก auto-deploy ทุก push** ตั้งแต่ migrate มาบัญชี claude-med:
  เหตุ = Hobby plan ห้าม deploy private repo ที่ commit author ไม่ใช่เจ้าของโปรเจค (author=pongphetpim@gmail.com)
- **ทางแก้ที่ใช้:** สร้างโปรเจคใหม่ชื่อ `prototype` (deploy ไฟล์ตรง ไม่ผูก git → ไม่โดนบล็อก) → URL ด้านบน
- **อัปเดต demo ครั้งหน้า:** แก้ไฟล์ใน `prototype/` แล้วรันมือ → `cd prototype && vercel deploy --prod`
  (โปรเจคใหม่นี้ไม่ auto-deploy จาก git)
- **ค้างไว้แก้ทีหลัง:** ถ้าอยากได้ auto-deploy + URL สวย ต้องจัดการบัญชี (ย้าย pd-monitor มา claude-med
  หรือทำให้ commit author ตรงเจ้าของโปรเจค) — ดู "ทาง 3" ที่คุยไว้

### ▶️ ขั้นถัดไป
- เปิดลิงก์ใหม่ดู demo (ลองค้นหา, กรอกฟอร์มผิดดู error, เข้า job QC กดอนุมัติ/ตีกลับ) → โชว์ CEO เก็บ feedback
- พร้อมเริ่ม **เฟส 1 (D1)**: scaffold Next.js ใน `web/` — แผนที่ `~/.claude/plans/claude-md-shiny-perlis.md`
  + `docs/recommendations.md`

---

## 📅 บันทึกวันที่ 15 มิถุนายน 2569 (วันแรก)

### ✅ วันนี้ทำอะไรไปบ้าง

1. **วางแผนภาพรวมทั้งโปรเจค** — วิเคราะห์จากเอกสาร 2 ไฟล์ (`asset/voice.md` + PDF ผังระบบ)
   สรุปว่าจะทำ **เว็บแอปติดตามการผลิตยา** แทนการจดมือ → แผนเก็บไว้ที่
   `C:\Users\mkt01\.claude\plans\ceo-app-proud-scroll.md`

2. **สร้าง HTML Prototype (Demo)** — ต้นแบบกดเล่นได้จริง ครบ 4 โมดูล responsive ภาษาไทย
   อยู่ในโฟลเดอร์ **`prototype/`** (ยังไม่มี backend จริง ใช้ข้อมูลตัวอย่าง)

3. **สร้าง PDF บทสรุปผู้บริหาร** (6 หน้า) — สำหรับนำเสนอ CEO → `docs/executive-summary.pdf`

4. **สร้าง PDF คู่มือเทคนิคสำหรับทีม** (7 หน้า) — สำหรับน้องๆ ในทีม → `docs/technical-guide.pdf`

5. **แก้บั๊ก prototype** — หน้า board/job/record/daily/dashboard เคยขึ้นว่างเปล่า
   สาเหตุ: บรรทัดเสียใน `assets/mock-data.js` (`const product = SEED ? null : null;`) ทำให้ JS พัง
   → ลบบรรทัดทิ้งแล้ว ทดสอบครบทุกหน้าผ่านหมดแล้ว ✅

6. **ติดตั้ง Vercel CLI** เรียบร้อย (v54.14.0) เตรียม deploy demo ขึ้นออนไลน์

### 📂 ไฟล์ทั้งหมดที่มีตอนนี้

```
web app/
├── note.md                      ← ไฟล์นี้ (บันทึกงาน)
├── asset/                       ← ข้อมูลตั้งต้น (voice.md, PDF, ไฟล์เสียง)
├── prototype/                   ← ⭐ Demo กดเล่นได้ (เปิด index.html)
│   ├── index.html               ← หน้าภาพรวม + ลิงก์เข้าทุกหน้า
│   ├── board.html               ← Pending Order Board
│   ├── job.html                 ← รายละเอียด Job + timeline
│   ├── record.html              ← ฟอร์มบันทึกการผลิต
│   ├── daily.html               ← Daily Report
│   ├── dashboard.html           ← Dashboard / KPI
│   └── assets/                  ← style.css, app.js, mock-data.js
└── docs/                        ← เอกสารนำเสนอ (PDF + HTML ต้นฉบับ)
    ├── executive-summary.pdf    ← บทสรุปผู้บริหาร (ส่ง CEO)
    └── technical-guide.pdf      ← คู่มือเทคนิค (ส่งทีม)
```

### 🧠 สิ่งที่ตัดสินใจไว้แล้ว (เพื่อไม่ต้องคิดซ้ำ)

- **Tech stack:** Next.js (TypeScript) + Tailwind + shadcn/ui · Supabase (PostgreSQL + Auth + Realtime) · Deploy บน Vercel
- **กลยุทธ์:** โชว์ Demo ให้ CEO ก่อน → เก็บ feedback → ค่อยสร้างของจริง
- **วิธีทำงาน:** ใช้ Claude Pro → แบ่งทำทีละเฟส (D1–D9) เพื่อประหยัด token
- **ผู้ใช้จริง:** ใช้ทั้งคอมและมือถือ → ต้องออกแบบ responsive
- **โมดูลใน Demo:** Pending Order Board, บันทึกการผลิต, Daily Report, Dashboard/KPI

---

## ▶️ พรุ่งนี้เริ่มตรงนี้ (Next Steps)

### 🚀 งานค้างอันดับแรก: deploy demo ขึ้น Vercel (ทำต่อจากเมื่อวาน)
Vercel CLI ติดตั้งแล้ว เหลือแค่รัน 3 คำสั่งนี้เอง (ต้อง login บัญชี Vercel เอง):
```bash
cd "C:\Users\mkt01\Desktop\web app\prototype"
vercel login        # ครั้งแรกครั้งเดียว (เลือก GitHub/Google/Email)
vercel --prod       # ตอบ Y / N / ชื่อ project / Enter ตามค่าแนะนำ
```
- ตอนถาม: Set up & deploy → **Y** | Link existing → **N** | project name → `pd-monitor-demo` | directory → **Enter** | modify settings → **N**
- เสร็จแล้วได้ลิงก์ `https://xxx.vercel.app` → ส่งให้ CEO กดจากมือถือได้
- แก้ไฟล์แล้วอยากอัปเดต → รัน `vercel --prod` ซ้ำ
- (ถ้าอยากให้เว็บอัปเดตอัตโนมัติทุกครั้งที่แก้โค้ด ต้องเชื่อมผ่าน GitHub — ค่อยทำทีหลังได้)

### ก่อนเริ่ม ให้ทำ 2 อย่างนี้
1. เปิด `prototype/index.html` ดู Demo อีกรอบให้นึกภาพออก
2. (ถ้ายังไม่ได้ทำ) เอา Demo ไปโชว์ CEO เก็บ feedback ว่าชอบ/อยากปรับอะไร

### แล้วเลือกทางใดทางหนึ่ง

**ทาง A — ถ้า CEO ยังไม่ดู / อยากปรับ Demo ก่อน:**
- ปรับแก้หน้าใน `prototype/` ตาม feedback (สั่ง Claude Code ได้เลย)

**ทาง B — ถ้าพร้อมสร้างของจริงแล้ว → เริ่ม "เฟส 1" (D1):**
- เปิด session ใหม่กับ Claude Code แล้วบอกว่า:
  > "อ่านไฟล์ `note.md` และ `.claude/plans/ceo-app-proud-scroll.md` แล้วเริ่มเฟส 1: ตั้งโปรเจค Next.js + Tailwind + เชื่อม Supabase + deploy เปล่าขึ้น Vercel"
- เป้าหมายเฟส 1 = เปิดเว็บเปล่าบน Vercel ได้สำเร็จ
- สิ่งที่ต้องเตรียม: สมัครบัญชี **GitHub, Supabase, Vercel** (ฟรีทั้งหมด) + ติดตั้ง Node.js, VS Code, Git
  (รายละเอียดอยู่ในหน้า 4 ของ `docs/technical-guide.pdf`)

---

## 🔧 บันทึกเทคนิค (กันลืม)

- **วิธีแปลง HTML → PDF** (ใช้ Chrome headless):
  ```bash
  "/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu \
    --no-pdf-header-footer "--print-to-pdf=<output ไฟล์ Windows path>" "<input.html Windows path>"
  ```
  ⚠️ ต้องใช้ Windows path เต็ม (เช่น `C:\Users\...`) ไม่งั้น Access denied
- ถ้าแก้เนื้อหา PDF → แก้ไฟล์ `.html` ใน `docs/` แล้ว gen ใหม่ด้วยคำสั่งข้างบน
- Roadmap ทั้งหมด (D1–D9) อยู่ในไฟล์แผน `.claude/plans/ceo-app-proud-scroll.md`

---

## 📌 สถานะปัจจุบัน
**เฟส 0 (Demo + เอกสาร) = เสร็จแล้ว ✅** | prototype แก้บั๊กครบแล้ว ทดสอบผ่านทุกหน้า
**ขึ้น GitHub แล้ว ✅ (19 มิ.ย. 69 — บัญชีใหม่)** → 🔗 https://github.com/Claude-med/pd-monitor (Private)
  - บัญชี GitHub: `Claude-med` · branch `master`
**Deploy ขึ้น Vercel แล้ว ✅ (19 มิ.ย. 69 — บัญชีใหม่)** → 🔗 https://pd-monitor.vercel.app
  - บัญชี Vercel: `claude-med` · project: `pd-monitor` · Root Directory = `prototype`
**เชื่อม Vercel ↔ GitHub แล้ว ✅ = Auto-deploy**
  - อัปเดตเว็บครั้งหน้า: แก้ไฟล์ → `git add -A` → `git commit -m "..."` → `git push`
    แล้ว Vercel จะ build + อัปเดต https://pd-monitor.vercel.app ให้เองอัตโนมัติ (ลิงก์เดิมไม่เปลี่ยน)
  - ไม่ต้องรัน `vercel --prod` เองอีกแล้ว
**Supabase พร้อมแล้ว ✅ (19 มิ.ย. 69)** — project `pd-monitor` · region Singapore
  - URL + key เก็บไว้ใน `.env.local` (ที่รากโปรเจกต์ — ไม่ขึ้น GitHub)
  - key ใช้จริงตอนเริ่มเฟส 1 (Next.js)
**ไฟล์ตั้งต้น + คำแนะนำคุณภาพ พร้อมแล้ว ✅ (19 มิ.ย. 69)** — `CLAUDE.md`, `docs/recommendations.md`,
  `docs/requirements-from-notion.md` (เชื่อม Notion ทีม), skill `handoff`
**Prototype อัปเกรดตามคำแนะนำ + 10 ฟีเจอร์ทีมแล้ว ✅ (19 มิ.ย. 69)** — search/filter, สถานะปัญหา,
  validation, flow guard, activity log, QC/QA approve-reject (demo-level)
**Demo เวอร์ชันใหม่ LIVE แล้ว ✅** → 🔗 **https://prototype-omega-eight.vercel.app** (โปรเจค Vercel `prototype`, deploy ตรงไม่ผูก git)
**เฟส 1 / D1 = scaffold เสร็จแล้ว ✅ (19 มิ.ย. 69)** — แอปจริง Next.js 16 + Tailwind + shadcn/ui + Supabase client
  อยู่ในโฟลเดอร์ `web/` · build + dev ผ่าน · push ขึ้น GitHub แล้ว (`f0573da`, repo เป็น public แล้ว)
**🌐 แอปจริง LIVE แล้ว ✅ (19 มิ.ย. 69):** **https://pd-monitor.vercel.app** ขึ้นหน้า "เฟส 1 — โครงแอปพร้อมแล้ว"
  - auto-deploy กลับมาทำงาน! (push → Vercel build เอง) — แก้ได้ด้วยการปรับ repo เป็น public
  - Vercel: Root Directory = `web` · env 3 ตัวใส่ครบ · deploy by claude-med · Status Ready
  - หน้าตอนนี้ "เปล่าๆ" = ปกติ/ตั้งใจ (D1 แค่พิสูจน์ว่า deploy ครบวงจร — ฟีเจอร์เริ่ม D2)
**= เฟส 1 / D1 เสร็จสมบูรณ์ทุกข้อ ✅**
**เฟส 2 / D2 = เสร็จสมบูรณ์ + verify แล้ว ✅ (22 มิ.ย. 69)** — schema ลง Supabase จริงเรียบร้อย
  ตรวจผ่าน REST: 8 ตารางครบ · seed เข้าครบ · audit_log=24 (trigger บันทึกครบ) · RLS กัน anon ได้ (`[]`)
  · CHECK output≤input ปฏิเสธ (400) · audit_log append-only กัน UPDATE ได้จริง
**เฟส 3 / D3 = เสร็จสมบูรณ์ + verify แล้ว ✅ (22 มิ.ย. 69)** — login + role + PWA + app shell (responsive)
  · Next.js 16: `middleware`→`proxy` · build ผ่าน · `/`→307 /login
  · **บั๊กที่แก้:** trigger `set_row_meta` อ้าง `created_by` แต่ profiles ไม่มี → เพิ่ม `set_profile_meta()`
    (patch `0005_fix_auth_roles_meta.sql` — รันไฟล์เดียว ไม่ต้อง reset)
  · ผู้ใช้รัน 0005 + สร้างบัญชี Auth แล้ว · ตรวจผ่าน REST: email เข้าครบ · auto-link ทำงาน · has_role()/current_profile_id() OK
  · บัญชีทดสอบ `pongphetpim@gmail.com` = role manager (เห็นทุกเมนู)
**เฟส 4 / D4 = เสร็จสมบูรณ์ + verified ✅ (22 มิ.ย. 69)** — บอร์ดงาน + รายละเอียด job + กันข้ามสถานะ
  · kanban responsive + search/filter + KPI · stepper + ปุ่มเปลี่ยนสถานะตาม role (ตีกลับมีเหตุผล)
  · ผู้ใช้ paste 0006 แล้ว · ทดสอบ state machine ในฐานะ production: กันผิดสิทธิ์ ✓ · กันข้ามขั้น ✓
    · valid transition สำเร็จ + version bump + **audit บันทึกใคร/เหตุผล** ✓
  · 📌 ผู้ใช้เปลี่ยนอีเมล demo profiles → `test1-5@gmail.com` + สร้างบัญชี auth จริงครบ 5 แผนกแล้ว
  · 📌 มีโปรไฟล์ว่าง `somchai.prod@pdmonitor.app` หลงจาก test (ไม่มี role/ไม่ผูก = ไม่กระทบ) ลบได้ถ้าอยาก
**เฟส 5 / D5 = เขียนเสร็จ + build ผ่าน ✅ (22 มิ.ย. 69)** — ฟอร์มบันทึกผลผลิตรายวัน + validation ฝั่ง server + audit
  · ฟังก์ชัน `add_production_record()` (security definer): สิทธิ์ production/manager · guard สถานะ in_production/qc/qa
    · output≤input · output+loss≤input · ห้ามติดลบ · ทศนิยม · ชม. 0–24 · วันที่ล้ำอนาคตไม่ได้ · ตั้ง audit GUC
  · `validateRecord()` ใช้ร่วม client/server · ฟอร์ม decimal + ตารางบันทึกในหน้า job detail
  · ⏳ **ผู้ใช้ต้อง paste `0007_production_records.sql`** (ต่อจาก 0001–0006) แล้ว login เป็น production ทดสอบ
    (rpc อิง auth.uid() → ทดสอบผ่าน REST ไม่ได้ ต้อง login เหมือน D4)
**ถัดไป:** **D6** — Daily Report + QC/QA approve-reject + **e-signature (lite)** (ยืนยันรหัสซ้ำ) + ตาราง `approvals`
  (อ่าน `docs/recommendations.md` A3 + fetch Notion เช็ก requirement ใหม่ก่อน)
