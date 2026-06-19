# 🛒 PD Monitor — ระบบติดตามการผลิตยา

เว็บแอปสำหรับโรงงานยา ใช้ติดตามสถานะ **Pending Order** และบันทึก **Daily Report** ของแต่ละสถานี
(เตรียมยา → ผสม → ตอก → บรรจุ → QC → QA → คลังสินค้า) แทนการจดมือ ให้ทุกฝ่ายเห็นภาพรวมตรงกันแบบ real-time

🔗 **Demo:** https://pd-monitor.vercel.app

## สถานะ
เฟส 0 (HTML prototype + เอกสาร) เสร็จแล้ว · กำลังเตรียมเริ่มเฟส 1 (แอป Next.js จริง)
👉 ดูสถานะล่าสุดและบันทึกงานรายวันที่ [`note.md`](./note.md)

## Tech Stack
- **Frontend:** Next.js (TypeScript) + Tailwind + shadcn/ui
- **Backend/DB:** Supabase (PostgreSQL + Auth + Realtime)
- **Deploy:** Vercel (auto-deploy จาก GitHub)

## โครงสร้างโฟลเดอร์
| โฟลเดอร์ | คืออะไร |
|---|---|
| `prototype/` | Demo HTML กดเล่นได้ (ไม่มี backend) — เปิด `prototype/index.html` |
| `web/` | แอป Next.js จริง (สร้างในเฟส 1) |
| `docs/` | เอกสารนำเสนอ (PDF) + requirements ที่ดึงจาก Notion |
| `asset/` | ข้อมูลตั้งต้น (ถอดเสียงคุย CEO + ผังระบบ) |

## เริ่มต้นใช้งาน (prototype)
เปิดไฟล์ `prototype/index.html` ในเบราว์เซอร์ได้เลย (ไม่ต้องติดตั้งอะไร)

## ตั้งค่า environment (เฟส 1)
คัดลอก `.env.example` → `.env.local` แล้วเติมค่าจริงจาก Supabase (ดูคำอธิบายในไฟล์)

---
requirements ของทีมรวบรวมไว้ใน Notion → ดูสรุปที่ [`docs/requirements-from-notion.md`](./docs/requirements-from-notion.md)
