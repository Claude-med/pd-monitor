# PD Monitor — คู่มือสำหรับ Claude (โหลดอัตโนมัติทุก session)

> ไฟล์นี้กระชับโดยตั้งใจ (กิน token ทุกครั้งที่โหลด) — เป็น "ป้ายชี้ทาง" ไม่ใช่สำเนาเอกสาร
> **สถานะงานล่าสุด (live) อยู่ที่ `note.md` เสมอ — อ่าน note.md ก่อนเริ่มงานทุกครั้ง**

## โปรเจคคืออะไร
เว็บแอปติดตามการผลิตยา (**Pending Order & PD Monitoring System**) ของโรงงานยา — แทนการจดมือ
ให้ทุกฝ่าย (ผลิต / QC / QA / คลัง / ผู้บริหาร, ~30 คน) เห็นสถานะ order + บันทึก Daily Report ที่เดียวกัน
ผู้ใช้/ผู้สั่งงาน = CEO + ทีม · คนทำหลัก = เจ้าของเครื่อง (ไม่ใช่โปรแกรมเมอร์ ทำกับ Claude Code)

## Stack
Next.js (App Router, TypeScript) + Tailwind + shadcn/ui · Supabase (Postgres/Auth/Realtime) · deploy บน Vercel

## โครงสร้างโฟลเดอร์
```
web app/
├── note.md                       ← บันทึก handoff รายวัน (สถานะ live — อ่านก่อนเสมอ)
├── CLAUDE.md                     ← ไฟล์นี้
├── prototype/                    ← Demo HTML กดเล่นได้ (เฟส 0) → https://pd-monitor.vercel.app
├── web/                          ← แอป Next.js จริง (สร้างตอนเฟส 1 — ยังไม่มี)
├── docs/                         ← เอกสารนำเสนอ + requirements-from-notion.md
└── asset/                        ← ข้อมูลตั้งต้น (voice.md, PDF ผังระบบ)
```

## กติกาการทำงาน (สำคัญ)
- **ตอบ/เขียนเอกสารเป็นภาษาไทย**
- **ทำทีละเฟส (D1–D9) ทีละก้อน** เพื่อประหยัด token — อย่าเปิดงานหลายก้อนพร้อมกัน
- **จบงานทุกครั้ง → รัน skill `handoff`** (อัปเดต note.md + memory + push)
- แก้โค้ดแล้วอยากขึ้นเว็บ → `git add -A && git commit -m "..." && git push` → Vercel auto-deploy ให้เอง
  (ลิงก์ `https://pd-monitor.vercel.app` เดิม ไม่ต้องรัน `vercel --prod`)
- **ความปลอดภัย:** `.env.local` (มี key Supabase จริง) ห้ามขึ้น GitHub เด็ดขาด — มี `.env.example` ไว้เป็นแบบ

## ศูนย์รวม requirements ของทีม = Notion (ผ่าน Notion MCP)
น้องๆ ในทีมช่วยกันใส่ requirement/ไอเดียไว้ใน Notion → **ก่อนเริ่มเฟสใหม่ ให้ fetch หน้า Notion เช็กของล่าสุดก่อน**
- หน้าหลัก 🛒 Pending Order & PD Monitoring System — `38092ef2-c18f-803d-bb95-f49546a4f466`
- 📝 Lean PRD — `38092ef2-c18f-8027-8ce8-d160e4a4b931`
- ➕ demo-feature-suggestions (10 ฟีเจอร์ที่ทีมเสนอ) — `38292ef2-c18f-80d0-acbe-e8f91a874c1c`
- snapshot ในเครื่อง (อ่านเร็ว ไม่ต้องเรียก MCP) → `docs/requirements-from-notion.md`
- **ก่อนออกแบบ schema / เริ่มเฟสใหม่ อ่าน `docs/recommendations.md`** (มาตรฐานคุณภาพ GMP-aligned + roadmap ที่ปรับแล้ว)
> โพสต์อะไรกลับ Notion (workspace ทีม) = ถามผู้ใช้ยืนยันก่อนทุกครั้ง

## ลิงก์/ไฟล์อ้างอิง
- แผนเต็ม roadmap D0–D9: `~/.claude/plans/ceo-app-proud-scroll.md`
- GitHub: `Claude-med/pd-monitor` (private, branch `master`)
- Supabase project: `pd-monitor` (region Singapore)
