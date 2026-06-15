# 📝 บันทึกงาน — โปรเจคระบบติดตามการผลิตยา (PD Monitor)

> ไฟล์นี้ไว้สำหรับ "ส่งต่องาน" — พรุ่งนี้กลับมาเปิดอ่านไฟล์นี้ก่อน จะรู้ว่าวันนี้ทำอะไรไป และต้องทำอะไรต่อ

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
**ค้างไว้:** deploy ขึ้น Vercel (Vercel CLI ติดตั้งแล้ว เหลือ `vercel login` + `vercel --prod`)
**ถัดไป:** โชว์ CEO → เก็บ feedback → เริ่มเฟส 1
