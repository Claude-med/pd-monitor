# Requirements จาก Notion (ทีมรวบรวม)

> Snapshot จากหน้า Notion ของทีม (อ่านเร็ว ไม่ต้องเรียก MCP ทุกครั้ง) — **ของจริงล่าสุดอยู่ใน Notion เสมอ**
> ก่อนเริ่มเฟสใหม่ ควร fetch หน้า Notion เช็กว่ามี requirement ใหม่จากทีมเพิ่มไหม
> อัปเดต snapshot นี้ล่าสุด: 19 มิ.ย. 2569

**หน้า Notion ต้นทาง:**
- หน้าหลัก 🛒 Pending Order & PD Monitoring System — `38092ef2-c18f-803d-bb95-f49546a4f466`
- 📝 Lean PRD — `38092ef2-c18f-8027-8ce8-d160e4a4b931`
- ➕ demo-feature-suggestions — `38292ef2-c18f-80d0-acbe-e8f91a874c1c`

---

## 1. Lean PRD (สรุป)

- **สถานะ:** 🟡 In Progress / Planning
- **ผู้ใช้:** ~30 คน (แผนก QC, QA, ผลิต, คลังสินค้า)
- **Stack:** Vercel (Next.js) + Supabase — *ตรงกับที่เราเลือกไว้*
- **ปัญหา:** ติดตาม Pending Order ปัจจุบันซับซ้อน กระจัดกระจาย ไม่ real-time
- **เป้าหมาย:** ระบบรวมศูนย์ดูสถานะ order + บันทึก Daily Report ของแต่ละสถานี ให้ทุกฝ่ายเห็นตรงกัน

### User Roles
| Role | หน้าที่ในระบบ |
|---|---|
| ผลิต (Production) | อัปเดตสถานะการผลิตแต่ละขั้น + บันทึก Daily Report |
| QC / QA | บันทึกผลตรวจคุณภาพ เพื่อปล่อยผ่านให้สถานีต่อไป |
| คลังสินค้า (FG/WHS) | ตรวจสอบสถานะ + รับสินค้าสำเร็จรูป |
| ผู้บริหาร / หัวหน้างาน | ดูภาพรวม Pending Order ผ่าน Dashboard |

### Core Features (Phase 1 ตาม PRD)
- **Main Dashboard** — กระดานแสดงทุก order ว่าติดอยู่ขั้นตอนใด
- **Daily Report Data Entry** — ฟอร์มกรอกงานรายวันของแต่ละสถานี
- **Products Database Integration** — ดึงข้อมูลอ้างอิง (เช่น Standard Time) มาประกอบ order

---

## 2. ฟีเจอร์ที่ทีมเสนอเพิ่ม (10 ข้อ) + map เข้า roadmap

> roadmap เต็ม D0–D9 อยู่ที่ `~/.claude/plans/ceo-app-proud-scroll.md`

| # | ฟีเจอร์ | รายละเอียดสั้น | จะลงเฟส |
|---|---|---|---|
| 1 | **Role & Permission ชัดเจน** | วางแผน→สร้าง Job, ผลิต→บันทึกผลิต, QC/QA→งานตรวจตัวเอง, ผู้บริหาร→ดูอย่างเดียว | D3 (auth+role) + D8 (RLS) |
| 2 | **Flow ห้ามข้ามสถานะ** | Job ต้องผ่านลำดับ: รอแจ้งผลิต → มีแผนแล้ว → กำลังผลิต → QC → QA → FG | D4 (board) + D5 |
| 3 | **สถานะปัญหา** | เพิ่ม "ติดปัญหา / รอแก้ไข / ล่าช้า" ให้เด่นกว่างานปกติ (board + job detail) | D4 |
| 4 | **Warning ทำผิดลำดับ** | เตือนเมื่อขั้นก่อนหน้ายังไม่เสร็จแต่จะบันทึกขั้นถัดไป | D5 |
| 5 | **History / Activity Log** | บันทึกใครเปลี่ยนสถานะอะไร เมื่อไหร่ + เหตุผล/note (สำหรับตรวจย้อนหลัง) | D5 |
| 6 | **QC/QA Approve / Reject** | กดผ่าน/ไม่ผ่านได้ ถ้าตีกลับต้องมีเหตุผล | D5–D6 |
| 7 | **Search / Filter บน Board** | ค้นด้วย Job No, Lot, ลูกค้า, ชื่อยา, สถานะ + filter (กำลังผลิต/รอ QC/ล่าช้า/ติดปัญหา) | D4 |
| 8 | **สี Status ชัดขึ้น** | แยกสี ปกติ/รอตรวจ/เสร็จ/ติดปัญหา ให้มองออกทันที | D4 |
| 9 | **Decimal input + Validation** | รองรับทศนิยม (น้ำหนัก/output/loss/ชม.) + เตือน output>input, ค่าติดลบ, ช่องว่าง | D5 |
| 10 | **Mobile menu / Responsive** | hamburger ปิดอัตโนมัติเมื่อเลือกหน้า, layout เหมาะมือถือ/tablet หน้าไลน์ผลิต | D3 (layout) + ทุกเฟส |

### หมายเหตุการนำไปใช้
- ข้อ 2, 4 (flow guard + warning) = ตรรกะคุมลำดับสถานะ → ออกแบบที่ schema `job_stages` + ตรวจฝั่ง server
- ข้อ 5 (activity log) = ต้องมีตาราง `activity_log` เพิ่มใน schema ตั้งแต่ D2
- ข้อ 1 (permission) = ผูกกับ `roles` + Supabase RLS (D8) แต่ UI ซ่อน/แสดงปุ่มตาม role ตั้งแต่ D3
- ฟีเจอร์เหล่านี้บางส่วนเอาไปปรับ **prototype** ก่อนได้ (สถานะปัญหา, สี, search, responsive) ถ้าจะโชว์ CEO เพิ่ม
