# 📝 บันทึกงาน — โปรเจคระบบติดตามการผลิตยา (PD Monitor)

> ไฟล์นี้ไว้สำหรับ "ส่งต่องาน" — พรุ่งนี้กลับมาเปิดอ่านไฟล์นี้ก่อน จะรู้ว่าวันนี้ทำอะไรไป และต้องทำอะไรต่อ

---

## 📅 บันทึกวันที่ 19 มิถุนายน 2569 — เฟส 1 / D1 (ล่าสุด)

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
**⏳ ค้าง D1 (ทำในแดชบอร์ด Vercel เอง):** ตั้ง Root Directory = `web` + ใส่ env 3 ตัว → ให้ auto-deploy ขึ้นแอปจริง
**ถัดไป:** ตั้งค่า Vercel ให้ auto-deploy `web/` สำเร็จ → เริ่ม **D2** (schema + RLS + audit_log)
