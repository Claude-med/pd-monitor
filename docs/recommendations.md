# 📐 คำแนะนำยกระดับคุณภาพ PD Monitor (อิงงานวิจัยภายนอก)

> เอกสารนี้รวมคำแนะนำสำหรับสร้างแอปให้ "มีคุณภาพ + ใช้งานได้จริงในโรงงานยา" — อ่านก่อนออกแบบ schema/เริ่มเฟสใหม่
> ขอบเขตที่ตกลง: **GMP-aligned แบบพอดี** (ไม่เล็ง audit FDA จริง) + **มือถือเยอะ เน็ตโอเค → PWA-lite**
> อัปเดต: 19 มิ.ย. 2569

## ข้อค้นพบหลัก
แอปนี้คือ **ระบบ MES (Manufacturing Execution System) ขนาดเล็กของโรงงานยา** ฟีเจอร์ที่น้องๆ ในทีมเสนอ
(audit log, QC/QA approve-reject, validation) = ฟีเจอร์ **data integrity / GMP** ที่ทำให้ซอฟต์แวร์โรงงานยา
ใช้ได้จริงพอดี → ออกแบบความถูกต้องของข้อมูลตั้งแต่ต้น ไม่เสริมทีหลัง

---

## A. Data integrity / GMP-aligned (หัวใจที่ทำให้ใช้ได้จริง)

| # | สิ่งที่ทำ | รายละเอียด | เฟส |
|---|---|---|---|
| A1 | **Audit trail แก้ไม่ได้** | ตาราง `audit_log` append-only: ทุก create/update/delete บันทึก user, เวลา server, ตาราง, record, ค่าเก่า→ใหม่, เหตุผล · ห้ามแก้/ลบ · ทำด้วย **Postgres trigger** กัน bypass | D2 |
| A2 | **ALCOA+ ทุก record** | `created_by/updated_by` (FK ผู้ใช้), `created_at/updated_at = timestamptz default now()` (เวลา server ไม่ใช่ client), เก็บประวัติแทนเขียนทับ | D2 |
| A3 | **e-signature (lite)** | จุด QC/QA approve/reject: ยืนยันรหัสผ่านซ้ำ (Supabase reauthenticate) + เก็บชื่อ/ผลตัดสิน/เหตุผลตอน reject/เวลา → ตาราง `approvals` | D6 |
| A4 | **Batch/Lot traceability** | ใส่ `batch_id`/`lot` ทุก production record, ค้นทุก record ตาม lot ได้ (genealogy/เรียกคืน), batch มี `manufacture_date` + `expiry_date` | D2/D5 |
| A5 | **State machine + ล็อก record** | บังคับลำดับสถานะระดับ DB/server (enum + ตรวจ transition + `version` column กัน concurrent) · ล็อกแก้ไม่ได้เมื่อ Approved/FG | D4/D5 |

**หลัก ALCOA+:** Attributable (ใครทำ) · Legible · Contemporaneous (เวลาจริง) · Original · Accurate +
Complete · Consistent · Enduring · Available

---

## B. Architecture & Security (Next.js + Supabase)

| # | สิ่งที่ทำ | รายละเอียด | เฟส |
|---|---|---|---|
| B1 | **เปิด RLS ทุกตาราง ตั้งแต่ D2** | default-deny · role เก็บตาราง `user_roles` + helper `security definer` (`has_role`, `has_permission`) · wrap `auth.uid()` ใน `(select ...)` + index คอลัมน์ที่ policy ใช้ | D2–D3 |
| B2 | **คีย์ลับฝั่ง server เท่านั้น** | secret/service key ใช้แค่ Server Components / Route Handlers / Edge Functions · client ใช้ publishable/anon เท่านั้น · key รุ่นใหม่ = publishable/secret (anon/service_role เลิกใช้สิ้นปี 2026) | D1 |
| B3 | **เขียนแบบ server-first** | ดึงข้อมูลด้วย Server Components, เขียนด้วย Server Actions → คีย์ลับ/ตรรกะอยู่ server, client state น้อย ดูแลง่าย | ทุกเฟส |
| B4 | **เทส RLS ด้วย impersonation** | Supabase Studio impersonate user · ⚠️ RLS ผิดจะคืนค่า "ว่างเงียบ" ไม่ error → ต้องเทสที่ผลลัพธ์ | D8 |

---

## C. Field UX (มือถือเยอะ → PWA-lite)

| # | สิ่งที่ทำ | รายละเอียด | เฟส |
|---|---|---|---|
| C1 | **PWA-lite** | manifest ติดตั้งได้ + responsive + ปุ่ม/ช่องขนาดนิ้วแตะ + **save optimistic + retry** (เน็ตกระตุกข้อมูลไม่หาย) + แสดงสถานะ save ชัด · ออกแบบ data model ให้ sync ได้ (client-gen UUID, updated_at) เผื่อ full offline ทีหลัง | D3+ |
| C2 | **คุณภาพ input** | รองรับทศนิยม, validate output ≤ input, ห้ามค่าติดลบ, ช่องบังคับ — ตรวจทั้ง client และ **server** (server ตัดสินความถูกต้อง = ALCOA Accurate) | D5 |
| C3 | **Board ใช้งานจริง** | สถานะปัญหา (ติดปัญหา/รอแก้/ล่าช้า) เด่นชัด · search/filter ตาม job/lot/ลูกค้า/ยา/สถานะ · สี status คอนทราสต์อ่านง่าย | D4 |

---

## D. Schema ที่ต้องเพิ่ม (เทียบของเดิมในแผน roadmap)
- **ตารางใหม่:** `audit_log` (append-only), `approvals` (e-sign), (ออปชัน) `status_transitions` (แผนที่สถานะที่อนุญาต)
- **คอลัมน์เพิ่มทุกตารางหลัก:** `created_by`, `updated_by`, `created_at`, `updated_at`, `version`
- **ตาราง batch:** เพิ่ม `manufacture_date`, `expiry_date`

---

## E. Quality / Process (เบาๆ พอดีตัว)
- ใช้ [`requirements-from-notion.md`](./requirements-from-notion.md) เป็น **URS (User Requirement Spec)** ตั้งต้น
- **เทสขั้นต่ำ:** RLS policy test (impersonation/pgTAP) สำหรับกฎ role สำคัญ + E2E 1 ชุดของ flow หลัก
  (สร้าง job → บันทึกผลิต → QC approve → FG)
- **ทางเลือกที่พิจารณาแล้ว:** ERPNext/Odoo ทำ batch/QC ได้เยอะ แต่ปรับ compliance เองหนัก → เคสเราขอบเขตเฉพาะ
  + อยากเรียนรู้กับ Claude → **build เองเหมาะกว่า** (ยืมแพตเทิร์นมาใช้)
- **ไม่เคลมเกินจริง:** สื่อสารว่าเป็น "GMP-aligned / data-integrity-ready" ไม่ใช่ "FDA validated"

---

## แหล่งอ้างอิง
- [IntuitionLabs — Open-Source MES for Pharma GMP](https://intuitionlabs.ai/articles/open-source-mes-pharma-gmp-compliance)
- [TotalLab — ALCOA & ALCOA+ Principles](https://totallab.com/resources/alcoa-principles/)
- [Tulip — Core Features of MES](https://tulip.co/blog/core-features-of-mes-manufacturing-execution-systems/)
- [Makerkit — Supabase RLS Best Practices](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)
- [Lawrence Jones — Database-powered state machines](https://blog.lawrencejones.dev/state-machines/)
- [ERPNext (GitHub) — batch/lot traceability reference](https://github.com/frappe/erpnext)
- [MagicBell — Offline-First PWAs](https://www.magicbell.com/blog/offline-first-pwas-service-worker-caching-strategies)

---

## Roadmap ที่ปรับใหม่ (การเปลี่ยนสำคัญ = ดึง security + audit มาก่อน)

| วัน | งาน (รวมคำแนะนำแล้ว) |
|---|---|
| D1 | scaffold Next.js + Tailwind ใน `web/` · ตั้งชื่อ key publishable/secret ถูก · server-first · deploy เปล่า |
| D2 | schema + seed · **เปิด RLS ทุกตาราง** · `audit_log` trigger · คอลัมน์ ALCOA · batch mfg/expiry |
| D3 | auth + role + permission helper (`has_role`) · **PWA manifest** · responsive layout |
| D4 | board + job · สถานะปัญหา/สี/search/filter · **state-machine guard** |
| D5 | ฟอร์มบันทึกผลิต · decimal/validation ฝั่ง server · ผูก batch/lot · เขียนลง audit |
| D6 | Daily Report · **QC/QA approve-reject + e-sign(lite)** |
| D7 | Dashboard / KPI + DL cost |
| D8 | hardening: realtime · RLS tests · perf · ขัดเกลา mobile · groundwork offline |
| D9 | UAT + deploy production |
