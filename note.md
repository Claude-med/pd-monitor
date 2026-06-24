# 📝 บันทึกงาน — โปรเจคระบบติดตามการผลิตยา (PD Monitor)

> ไฟล์นี้ไว้สำหรับ "ส่งต่องาน" — พรุ่งนี้กลับมาเปิดอ่านไฟล์นี้ก่อน จะรู้ว่าวันนี้ทำอะไรไป และต้องทำอะไรต่อ

---

## 📋 Backlog — gap จาก brief CEO (วิเคราะห์ 23 มิ.ย. 69 จาก PDF ผังระบบ + voice.md)
> **✅ โพสต์ Notion แล้ว (23 มิ.ย. 69):** หน้า "🗺️ Roadmap หลัง D9 — เติม brief CEO + ยกระดับเป็น MES (สำหรับทีมศึกษา)"
>   `38892ef2-c18f-81b5-b3d2-e9d9ca793baf` (ใต้หน้าโปรเจคหลัก) — มีรายละเอียดออกแบบ (ตาราง/RPC/RLS) ของ A0–A6 + B1–B8 + ลำดับ D10–D12
> **TODO หลังปิด D9:** (ออปชัน) สรุป roadmap ลง `docs/` ในเครื่องด้วย · เริ่มลงมือ D10 = A0 หน้า Admin จัดการผู้ใช้
>
> **แกนหลักที่ CEO อยากได้ = ทำครบแล้ว** (แทนจดมือ · pending board · in/out รายสถานี · ทุกฝ่ายเห็นตรงกัน · lot/หมดอายุ · ต้นทุนค่าแรง · QC/QA)
> **แต่ยังไม่ครอบคลุม 100% — เหลือสิ่งที่ CEO พูดถึงตรงๆ:**
> 1. 🔴 **ระบบเครื่องจักร (M/C)** — ทะเบียนเครื่อง + "ใช้เครื่องไหน" ตอนบันทึก + รายงานใช้เครื่อง + แจ้งเตือนซ่อม/ทำความสะอาด (PDF น.2 "EN DATABASE")
> 2. 🔴 **เบิกวัตถุดิบ + คลัง RM/PM** (PDF "RM/PM WHS → เบิกของ" · voice "ไปเบิกของ")
> 3. 🔴 **Line Clearance / Set-up / Washing** ก่อนผลิต (PDF "LINE CLEARANCE, SET UP TIME") — GMP
> 4. 🟠 สูตรการผลิต (recipe/BOM) + สถานีย่อยจริง (บด/ร่อน/ผสมแห้ง/ฉาบ/ฟิล์ม/คัด-ขัด) + รูปแบบบรรจุ (Blister/Strip/ซอง/ขวด, แผง 50×10's)
> 5. 🟠 คลัง FG (สต็อกหลังเข้าคลัง) · จำนวนคนต่อขั้น (ต้นทุนคิดแค่ชั่วโมง) · in-process QC + จุดเก็บ sample QA
> 6. 🟢 auto-gen เลขงานต่อไลน์ (ทำง่าย) · หน้า Admin จัดการผู้ใช้ (จำเป็นก่อนเปิด 30 คน)
>
> **MES-grade เสริม (จาก research/Notion 11–23):** eBR · lot genealogy · deviation · notification/escalation · barcode/QR · OEE/downtime · capacity planning · integration ERP/LIMS
> **ลำดับแนะนำ:** รอบหน้า = admin users + เครื่องจักร + เบิกวัตถุดิบ + line clearance + จำนวนคน/auto job no → แล้วค่อย MES-grade

---

## 📅 บันทึกวันที่ 24 มิถุนายน 2569 — เฟส 11 / D11 (A4 ก้อน 2): รูปแบบบรรจุ (ล่าสุด)

### ✅ วันนี้ทำอะไรไปบ้าง — ระบุรูปแบบบรรจุของยาแต่ละตัว 📦
> fetch Notion (หน้า Roadmap) ก่อนเริ่ม · A4 เหลือ 2 ส่วน → แยกเป็นก้อน 2 (บรรจุ · เล็ก/ปลอดภัย) + ก้อน 3 (สถานีย่อย/route · ใหญ่)
> ⚠️ Notion เตือน: "อย่าเปลี่ยน enum production_station — production_records เดิมจะพัง · ทำตาราง config (stations + product_routes) ปลอดภัยกว่า" → เก็บไว้ทำก้อน 3
1. **DB (`web/supabase/migrations/0021_packaging.sql`)** — ⏳ รอ paste:
   - เพิ่มคอลัมน์ `products.pack_type` (Blister/Strip/ซอง/ขวด/กระปุก/อื่นๆ) + `pack_pattern` (เช่น "แผง 50×10's")
   - RPC `update_product_packaging(product, type, pattern)` (manager/admin · audit ผ่าน trigger เดิมของ products)
2. **แอป:** หน้า `/recipes` แสดงรูปแบบบรรจุบนการ์ดยา + ปุ่ม "แก้บรรจุ" (เลือก type + กรอกรายละเอียดแผง)
   · `lib/data/packaging-constants.ts` (ตัวเลือก pack type) · build ผ่าน · push แล้ว

### ✅ verified DB แล้ว (24 มิ.ย. 69)
- ผู้ใช้ paste `0021_packaging.sql` แล้ว · Claude เช็กผ่าน REST: คอลัมน์ `pack_type`+`pack_pattern` มีจริง (200)
  · ฟังก์ชัน `update_product_packaging` มีจริง + guard ทำงาน · ผู้ใช้ทดสอบ UI ผ่าน ✅

### ▶️ ขั้นถัดไป (D11 ต่อ)
- **A4 ก้อน 3:** สถานีย่อยจริง — ตาราง `stations` (config: บด/ร่อน/ผสมแห้ง/ฉาบ/ฟิล์ม/คัด-ขัด/บรรจุ) + `product_routes` (ยา→ลำดับสถานี)
  ⚠️ ใช้ตาราง config ไม่แตะ enum เดิม (Notion เตือน) · map สถานีย่อย→กลุ่ม 4 enum เดิมเพื่อให้ dashboard ไม่พัง
- จากนั้น **A6** คลัง FG + in-process QC + sample · (+ B3 deviation · B4 notification)

---

## 📅 บันทึกวันที่ 24 มิถุนายน 2569 — เฟส 11 / D11 (A4 ก้อน 1): สูตรการผลิต / BOM

### ✅ วันนี้ทำอะไรไปบ้าง — สูตรยา + รายการวัตถุดิบที่ใช้ (Bill of Materials) 🧪📋
> เริ่ม D11 · ผู้ใช้เลือกทำ A4 ก่อน · แบ่ง A4 เป็น 2 ก้อน → **ก้อน 1 = Recipe/BOM** (ฐาน ต่อกับ A2 วัตถุดิบ)
> หมายเหตุ: ยังไม่ได้ fetch Notion รอบนี้ (A4 อยู่ใน Roadmap D11 ที่โพสต์ไว้แล้ว) — รอบหน้าก่อนก้อนใหม่ค่อยเช็ก
1. **DB (`web/supabase/migrations/0020_recipes.sql`)** — ⏳ รอ paste:
   - `product_recipes` (หัวสูตร: ผูก product · ชื่อ/เวอร์ชัน · `batch_size`+`batch_unit` · is_active · note)
   - `recipe_items` (BOM: ผูก `materials` ของ A2 · qty/แบตช์ · unit · note · `unique(recipe_id, material_id)` กันซ้ำ)
   - meta+audit trigger + RLS (อ่านทุกคน authenticated · เขียนผ่าน RPC) + realtime ทั้ง 2 ตาราง
   - RPC security definer (เฉพาะ manager/admin ผ่าน `can_manage_recipes()`):
     · `upsert_recipe(...)` เพิ่ม/แก้หัวสูตร · `set_recipe_items(recipe, jsonb)` **แทนที่ BOM ทั้งชุด atomic**
       (validate ใน DB: วัตถุดิบมีจริง · qty ไม่ว่าง/ไม่ติดลบ · กันวัตถุดิบซ้ำในสูตร)
2. **แอป (`web/`)** — build ผ่าน:
   - `lib/data/recipes.ts` — `listProductsWithRecipes()` (join product→recipes→items→material) + `getMaterialOptions()`
   - หน้า `app/(app)/recipes/` — `page.tsx` (guard อ่านทุก role, จัดการเฉพาะ manager) + `recipes-view.tsx` + `actions.ts`
     · การ์ดต่อยา → เพิ่ม/แก้หัวสูตร · **BomEditor** เลือกวัตถุดิบจาก dropdown + qty/หน่วย/หมายเหตุ (เพิ่ม/ลบแถว) บันทึกทีเดียว
   - `lib/nav.ts` — เมนูใหม่ "สูตรการผลิต / BOM" (ready=true)
   - realtime: `product_recipes` + `recipe_items`
3. commit + push แล้ว → Vercel auto-deploy

### ✅ verified DB แล้ว (24 มิ.ย. 69)
- ผู้ใช้ paste `0020_recipes.sql` แล้ว · Claude เช็กผ่าน REST: ตาราง `product_recipes`+`recipe_items` มีจริง (200)
  · ฟังก์ชัน `upsert_recipe`+`set_recipe_items` มีจริง + guard ทำงาน (ตอบ "ยังไม่ได้เข้าสู่ระบบ" เมื่อไม่มี session) ✅

### ⚠️ เหลือผู้ใช้ทดสอบ UI จริง (RPC ต้องมี session — เทสผ่าน REST ไม่ได้)
- ทดสอบ: login เป็น **manager** → /recipes → เลือกยา → "＋ เพิ่มสูตร" (ตั้งขนาดแบตช์) →
  "แก้รายการวัตถุดิบ" เลือกวัตถุดิบจากคลัง A2 + จำนวน → บันทึก → เห็น BOM ในตาราง · login role อื่น = เห็นแต่ดูอย่างเดียว

### ▶️ ขั้นถัดไป (D11 ต่อ)
- **A4 ก้อน 2:** สถานีย่อยจริง (บด/ร่อน/ผสมแห้ง/ฉาบ/ฟิล์ม/คัด-ขัด) + รูปแบบบรรจุ (Blister/Strip/ซอง/ขวด)
- จากนั้น **A6** คลัง FG + in-process QC + จุดเก็บ sample (QA) · (+ B3 deviation · B4 notification ตามลำดับ)
> ก่อนเริ่มก้อนใหม่: fetch Notion เช็ก requirement ล่าสุด

---

## 📅 บันทึกวันที่ 23 มิถุนายน 2569 — เฟส 10 / D10 เสร็จครบ (A0·A1·A2·A3·A5)

### ✅ D10 = เติม brief CEO รอบแรก — เสร็จครบ 5 ก้อน 🎉 (migration 0012–0019 paste+verify หมดแล้ว)
> ทุกก้อน: เขียนผ่าน RPC security definer + RLS + audit + realtime ตามแพตเทิร์นเดิม · build ผ่าน · paste + verify REST + ผู้ใช้ทดสอบ UI ผ่าน · push ขึ้น Vercel แล้ว
- **A0 จัดการผู้ใช้ + role admin** (0012–0013) — หน้า `/admin/users` · admin = has_role ผ่านทุก role · `lib/auth/roles.ts`
- **A1 เครื่องจักร** (3 ก้อน · 0014–0015) — หน้า `/machines` (ทะเบียน+สถานะ+เตือนซ่อม/สอบเทียบ) · เลือกเครื่องตอนบันทึกผลผลิต (กันเครื่องซ่อม) · รายงานการใช้เครื่อง (`machine-usage.ts`)
- **A2 วัตถุดิบ/คลัง + เบิก** (3 ก้อน · 0016–0017) — หน้า `/materials` (`materials`+`material_lots`) · ใบเบิก `material_requisitions` ในหน้างาน (request→issue ตัดสต็อก atomic, กันไม่ผ่าน/หมดอายุ/ไม่พอ) · แถบเตือนงานยังไม่เบิก
- **A3 Line Clearance** (0018) — ตาราง `line_clearances` + สองลายเซ็น (perform≠check) · **GATE ใน `advance_job_status`: มีแผน→กำลังผลิต ต้องผ่าน clearance ก่อน**
- **A5 จำนวนคน + auto เลขงาน** (0019) — `headcount` ใน production_records (ค่าแรง=คน-ชม.×อัตรา ในแดชบอร์ด) · sequence `job_no_seq` ออก `JOB-YYYY-NNNN` ถ้าเว้นว่าง
- เมนูใหม่: จัดการผู้ใช้ · เครื่องจักร · วัตถุดิบ/คลัง · commit ล่าสุด `df1fdb1`

### ▶️ ขั้นถัดไป — D11 (รอบ 2 ตาม Roadmap Notion)
- **A4** สูตรการผลิต (recipe/BOM) + สถานีย่อยจริง + รูปแบบบรรจุ (Blister/Strip/ซอง/ขวด)
- **A6** คลัง FG + in-process QC + จุดเก็บ sample (QA)
- (+ เริ่ม B3 deviation · B4 notification ตามลำดับ)
> หมายเหตุ go-live: A3 ทำให้งานสถานะ "มีแผนแล้ว" เดิม ต้องทำ Line Clearance ก่อนเริ่มผลิต — แจ้งทีมกันงง

---

## 📅 บันทึกวันที่ 23 มิถุนายน 2569 — เฟส 10 / D10 (ก้อน 1): หน้า Admin จัดการผู้ใช้ + role admin

### ✅ วันนี้ทำอะไรไปบ้าง — ปลดคอขวด go-live: จัดการบัญชี/สิทธิ์ในแอปเอง 👤🔑
> เริ่ม D10 ตาม Roadmap หลัง D9 (Notion) ข้อ A0 · ผู้ใช้เลือกทำ A0 ก่อน + ขอเพิ่ม role `admin` ทำได้ทุกอย่าง
1. **หน้า `/admin/users`** (เห็นเฉพาะ manager/admin) — `page.tsx` (guard) + `users-admin.tsx` (UI) + `actions.ts`:
   - สร้างบัญชี (อีเมล+รหัส+ชื่อ+แผนก+role) · แก้ role · แก้ชื่อ/แผนก · **รีเซ็ตรหัสผ่าน** · **ระงับ/เปิดบัญชี**
   - **Auth ops** (createUser/updateUserById/ban) → admin client (secret key, server-only)
   - **เขียน profiles/roles** → RPC security definer (auth.uid ทำงาน → audit เก็บ "ใครทำ")
   - สร้างบัญชี `email_confirm:true` (ล็อกอินได้ทันที) · ระงับ = ban auth ~100 ปี (บล็อกล็อกอินจริง)
   - บัญชี seed เดิม (มีอีเมล ยังไม่ผูก auth) → สร้างด้วยอีเมลเดิม trigger `handle_new_user` ผูกให้อัตโนมัติ
2. **เพิ่ม role `admin` = ทำได้ทุกอย่าง** — แก้ครั้งเดียวครอบทุกที่:
   - DB `has_role()` เพิ่มเงื่อนไข "หรือเป็น admin" → guard RPC ทุกตัว + RLS ทุก policy ผ่านอัตโนมัติ
   - แอป `lib/auth/roles.ts` (ใหม่) `hasRole`/`hasAnyRole` (admin ผ่านเสมอ) แทน `.includes("manager")` ทั่วแอป
     (nav · ปุ่มสร้างงาน · DL cost · เปลี่ยนสถานะงาน · บันทึกผลผลิต · หน้า admin)
   - กัน lockout: บัญชีตัวเองต้องคงสิทธิ์ manager หรือ admin ไว้
3. **DB (paste แล้ว):** `0012_admin_users.sql` (RPC: admin_set_roles/admin_update_profile/admin_set_active)
   + `0013_admin_role.sql` (เพิ่ม enum `admin` + has_role ใหม่ + lockout)
4. **ทดสอบ:** `npm run build` ผ่าน (TypeScript เคลียร์)

### ✅ verified แล้ว (23 มิ.ย. 69)
- ผู้ใช้ paste 0012 + 0013 บน Supabase แล้ว · Claude เช็กผ่าน REST:
  `has_role('admin')`=false (enum admin มีจริง + ฟังก์ชันคอมไพล์ผ่าน) · admin_set_roles/update_profile/set_active
  มีอยู่ + guard ทำงาน (ปฏิเสธ session ที่ไม่ถูกต้อง) ✅ · commit+push แล้ว (`f62a75b`) → Vercel auto-deploy

### ▶️ ขั้นถัดไป (เหลือทดสอบ UI จริง + D10 ก้อนต่อไป)
- **เหลือ:** ผู้ใช้ทดสอบบน UI จริง (login manager → ตั้ง admin → admin เห็น/ทำได้ทุกอย่าง · รีเซ็ตรหัส/ระงับบัญชี · กัน lockout)
- D10 ก้อนถัดไปตาม roadmap: A1 เครื่องจักร · A2 เบิกวัตถุดิบ · A3 line clearance · A5 จำนวนคน/auto job no

---

## 📅 บันทึกวันที่ 23 มิถุนายน 2569 — เฟส 9 / D9 (ก้อน 2): Checklist UAT

### ✅ วันนี้ทำอะไรไปบ้าง — เครื่องมือให้ทีมไล่ทดสอบก่อนเปิดใช้จริง 📋
1. **`docs/uat-checklist.md` (ใหม่)** — checklist ภาษาไทย ติ๊กได้ สำหรับทีม:
   - Flow ครบวงจรส่งต่อกันทีละแผนก (ผู้บริหารสร้างงาน→ยืนยันแผน · ผลิตเริ่ม/บันทึก/ส่ง QC · QC ลงนาม→QA · QA→FG)
     — ระบุ role + สถานะคาดหวังทุกขั้น (อิง `TRANSITIONS` จริงใน job-constants)
   - ทดสอบกันสิทธิ์/กันข้ามขั้น · ตีกลับ QC/QA · ฟีเจอร์เด่น (realtime/offline/มือถือ/รายงาน/แดชบอร์ด/audit)
   - ความพร้อม go-live (ตั้งบัญชีจริง ~30 คน · กัน seed ปนงานจริง) + ตารางจดปัญหา + ช่องสรุปผล
2. ไม่ต้อง paste DB · ไม่แตะโค้ดแอป (เป็นเอกสาร) → ทีมเปิดไฟล์ใช้ได้เลย

### ▶️ ขั้นถัดไป (D9)
- ทีมไล่ทดสอบตาม `docs/uat-checklist.md` กับงานจริง → เก็บปัญหา/feedback กลับมาแก้
- เก็บงาน go-live: ตั้งบัญชีผู้ใช้จริง · จัดการ seed · (ออปชัน) หน้า admin จัดการผู้ใช้ (backlog เดิม)

---

## 📅 บันทึกวันที่ 23 มิถุนายน 2569 — เฟส 9 / D9 (ก้อน 1): หน้าสร้างงานผลิตใหม่

### ✅ วันนี้ทำอะไรไปบ้าง — ปิด gap ก่อน UAT: สร้าง order/job ในแอปได้ 🆕
> เริ่ม D9 · เช็ก Notion: ฟีเจอร์หลัก 10 ข้อ (1–10) ครบแล้ว · ข้อ 11–23 เป็น backlog อนาคต (กลุ่ม A/B/C) ไม่บล็อก v1
> **เจอ gap:** ไม่มี UI สร้าง order/job (งานมาจาก seed เท่านั้น) → ตรง requirement ข้อ 1 ที่ยังไม่ได้ทำ · ผู้ใช้เลือกให้ทำก่อน UAT
1. **DB (`web/supabase/migrations/0011_create_job.sql`)** — ⏳ รอ paste:
   - `create_product(code,name,dosage_form,std_hours)` — เพิ่มยาใหม่ (manager เท่านั้น) · กันรหัสซ้ำ
   - `create_job_with_order(customer,product,qty,unit,due,job_no,planned_start/end,lot)` — สร้าง order+job(+ล็อต) ธุรกรรมเดียว
     · manager เท่านั้น · งานเริ่มสถานะ `pending_announce` · `order_no='ORD-'||job_no` (unique อัตโนมัติ) · audit GUC
   - ทั้งคู่ security definer (แพตเทิร์นเดียวกับ add_production_record/advance_job_status)
2. **แอป (`web/`)** — build ผ่าน:
   - `lib/data/products.ts` (`getProducts()` สำหรับ dropdown)
   - `app/(app)/board/new/` — `page.tsx` (server, guard manager) + `new-job-form.tsx` (ฟอร์ม + **เพิ่มยาใหม่ inline**) + `actions.ts`
   - `board/page.tsx` + `board-view.tsx` — ปุ่ม **"＋ สร้างงานใหม่"** บนบอร์ด (เห็นเฉพาะ manager)
   - งานใหม่ขึ้นบอร์ดสดทันที (realtime `jobs` ที่มีอยู่แล้ว)

### ✅ verified แล้ว (23 มิ.ย. 69)
- ผู้ใช้ paste 0011 + ทดสอบ UI จริง: **manager สร้างงานใหม่ + เพิ่มยา inline ได้ · เด้งเข้าหน้างาน · ขึ้นบอร์ด** ✓

### ▶️ ขั้นถัดไป (D9 — หลังสร้างงานได้แล้ว)
- ทำ checklist UAT (flow ครบวงจร: สร้างงาน→ผลิต→QC→QA→FG ต่อ role) + ตรวจความพร้อม go-live (ตั้งบัญชีผู้ใช้จริง ~30 คน)

---

## 📅 บันทึกวันที่ 23 มิถุนายน 2569 — เฟส 8 / D8 ส่วน 2 (ก้อน 3/4): ขัดเกลามือถือ

### ✅ วันนี้ทำอะไรไปบ้าง — touch target + กันบั๊ก iOS zoom 📱
> สำรวจทุกหน้าก่อน: โครง responsive ดีอยู่แล้ว (ตารางมี overflow-x-auto + min-w · grid ยุบ 2 คอลัมน์ · drawer มือถือ)
> → จุดที่ขัดได้คุ้มสุด = ขนาดนิ้วแตะ + บั๊ก iOS · ทำผ่าน base CSS ครั้งเดียวครอบทั้งแอป (ไม่ไล่แก้ทุกไฟล์ให้เสี่ยง)
1. **`app/globals.css`** — เพิ่ม 2 กฎ:
   - จอ ≤640px: `input/select/textarea { font-size:16px }` → **กันบั๊ก iOS Safari ซูมเองตอนแตะช่องกรอก** (ฟอนต์ <16px)
   - `@media (pointer: coarse)` (อุปกรณ์สัมผัส): ปุ่ม/ช่องกรอก `min-height:44px` + ตัด tap-highlight + `touch-action:manipulation`
     → นิ้วแตะสะดวก **เฉพาะมือถือ/แท็บเล็ต ไม่กระทบเดสก์ท็อปที่ใช้เมาส์**
2. **`components/app-shell.tsx`** — เมนู nav `py-2→py-2.5` · ปุ่มออกจากระบบ `py-1.5→py-2` (กดง่ายขึ้น)
3. **ทดสอบ:** `npm run build` ผ่าน · ไม่ต้อง paste DB (CSS/markup ล้วน)

### ⚠️ ขั้นที่ผู้ใช้ทดสอบ (ออปชัน — deploy แล้วเทสได้เลย)
- เปิดบนมือถือจริง (หรือ DevTools โหมดมือถือ) → แตะช่องกรอกผลผลิต/วันที่ **ไม่ควรซูมเอง** · ปุ่มกดง่ายขึ้น
- เดสก์ท็อปต้องเหมือนเดิม (กฎ touch ใช้เฉพาะ pointer: coarse)

### ▶️ ขั้นถัดไป — ปิด D8 แล้วไป D9
- **ตัดสินใจ (ผู้ใช้เห็นด้วย):** เลื่อนก้อน perf ออกไป — ตอนนี้ข้อมูลยังน้อย วัดผลไม่ได้ + index หลักมีครบแล้ว
  → ทำ perf ตอนใช้งานจริงไปสักพัก มีข้อมูลเยอะ แล้ว EXPLAIN ของจริง (ย้ายเข้า Backlog)
- **= ปิด D8 (hardening สำคัญครบ: realtime · RLS tests · offline · mobile)** → เริ่ม **D9: UAT + deploy production**
  (อ่าน `docs/recommendations.md` + fetch Notion เช็ก requirement ใหม่ก่อนเริ่ม D9)

---

## 📅 บันทึกวันที่ 23 มิถุนายน 2569 — เฟส 8 / D8 ส่วน 2 (ก้อน 2/4): Offline-resilient save (C1)

### ✅ วันนี้ทำอะไรไปบ้าง — บันทึกผลผลิตแบบทนเน็ตกระตุก 📶💾
> เลือกทำก้อน offline ก่อน (Claude เลือกให้) เพราะคนหน้าไลน์ใช้มือถือ + เน็ตโรงงานกระตุก → ข้อมูลห้ามหาย (ALCOA)
1. **DB (`web/supabase/migrations/0010_record_idempotency.sql`)** — ⏳ รอ paste:
   - เพิ่มคอลัมน์ `client_id uuid unique` ใน `production_records` (idempotency key จากฝั่ง client)
   - **ยกเครื่อง `add_production_record()` เพิ่มพารามิเตอร์ `p_client_id`** (drop ตัว 8-arg เดิม → สร้าง 9-arg)
     · ถ้า client_id นี้เคยบันทึกแล้ว → คืน id เดิม (ไม่ทำซ้ำ) · insert ใช้ `on conflict (client_id) do nothing` กัน race
     · = **retry ปลอดภัย ไม่เกิด record ผลผลิตซ้ำ** (เคสเขียน DB สำเร็จแต่ response หลุด)
2. **`web/lib/offline-queue.ts` (ใหม่)** — คิว localStorage (SSR-safe): `newClientId/upsertPending/removePending/pendingForJob`
   - แต่ละรายการมี `clientId` (UUID) → เก็บใน `pd_pending_records_v1`
3. **`record-actions.ts`** — `addRecord()` รับ `clientId` เพิ่ม → ส่ง `p_client_id` เข้า rpc
4. **`record-form.tsx` (ยกเครื่อง)** — บันทึกแบบทนเน็ต + สถานะชัด:
   - **แยก error ถาวร (validation/สิทธิ์/สถานะ) ออกจากเน็ตหลุด (throw)** — ถาวร=ไม่ retry · เน็ต=retry
   - auto-retry 3 รอบ backoff (1.5/3/6s) · ครบแล้วยังไม่ได้ → **ค้างไว้ในคิว** (ไม่หาย)
   - เก็บลง localStorage ทันทีที่กดบันทึก → **ปิดจอ/รีโหลดก็ไม่หาย** · เปิดหน้าใหม่เจอ banner รายการค้าง
   - **auto-retry เมื่อเน็ตกลับมา** (event `online`) + ปุ่ม "ลองบันทึกอีกครั้ง" + ปุ่ม "ทิ้ง" (confirm)
   - สถานะ: กำลังบันทึก / เน็ตมีปัญหา–ลองใหม่ (n/4) / ค้างไว้ / บันทึกแล้ว ✓
5. **ทดสอบ:** `npm run build` ผ่าน (TypeScript เคลียร์)

### ✅ verified แล้ว (23 มิ.ย. 69)
- ผู้ใช้ paste 0010 + ทดสอบบน UI จริง: **บันทึกปกติได้ ("บันทึกแล้ว ✓")** ·
  **Offline → "ลองใหม่/ค้างไว้" → เปิดเน็ตกลับ บันทึกเองอัตโนมัติ ไม่มีแถวซ้ำ** ✓ (idempotency ทำงานจริง)

### ▶️ ขั้นถัดไป (D8 ส่วน 2 — เหลือ 2 ก้อน)
- ขัดเกลามือถือ (touch target) · perf (index/query)

---

## 📅 บันทึกวันที่ 23 มิถุนายน 2569 — เฟส 8 / D8 ส่วน 2 (ก้อน 1/4): เทส RLS (B4)

### ✅ วันนี้ทำอะไรไปบ้าง — สคริปต์เทส RLS ด้วย impersonation 🔐
> D8 ส่วน 2 มี 4 ก้อน: **(1) เทส RLS** ← เสร็จ (รอ paste) · (2) groundwork offline · (3) ขัดเกลามือถือ · (4) perf
1. **อ่าน policy จริงทั้งหมดก่อนเขียนเทส** — 0003 (baseline read) · 0004 (write_* แยก role + audit_log อ่านเฉพาะ manager/qa)
   · 0008 (approvals) · 0002 (audit append-only: revoke update/delete + trigger) · ยืนยัน `log_audit()` เป็น security definer
   (= การเขียน audit จาก trigger ข้าม RLS ได้ → เทส "เขียนสำเร็จ" ไม่พังเพราะ audit)
2. **ไฟล์ใหม่ `web/supabase/tests/rls_impersonation_test.sql`** — ⏳ รอ paste:
   - **ฟังก์ชัน `pg_temp.rls_test()` return ตารางผลลัพธ์** (ไม่ใช้ temp table) · insert/update ทดสอบถูก
     `raise '__UNDO__'` ในบล็อกย่อยเพื่อย้อนกลับ = **ไม่แตะข้อมูลจริง รันซ้ำได้** · อิง uid auth จริง (ไม่ hardcode)
   - 🔧 **แก้บั๊กรอบแรก:** เวอร์ชันแรกใช้ temp table + `begin/rollback` → Supabase SQL Editor commit ทีละ
     statement ทำให้ `on commit drop` ลบ temp ทันที (error `relation "_tu" does not exist`) → เปลี่ยนเป็นฟังก์ชัน
   - สวมรอยด้วย `set role authenticated` (plain SET, ทนกับ autocommit) + ตั้ง `request.jwt.claims.sub` · anon ใช้ `set role anon`
   - **เทสครอบคลุม:** (1) role ผูก auth ครบไหม · (2) ตรรกะ write policy ผ่าน `has_role()` (แม่น ไม่ขึ้นกับ grant)
     · (3) อ่าน jobs: ทุก role เห็น / anon ไม่เห็น · (4) **audit_log เห็นเฉพาะ manager/qa** (เคส "ว่างเงียบ" คลาสสิก)
     · (5) insert ตาม write_* · (6) update วัด row_count (แก้ profile คนอื่น = 0 แถวเงียบ) · (7) audit_log แก้ไม่ได้
   - **แยกแยะสาเหตุปฏิเสธ: RLS บล็อก vs ไม่มี grant ตาราง** (แอปเขียนผ่าน service key อยู่แล้ว) → ผลเทสไม่หลอกตา
   - ออกผลเป็นตาราง: คอลัมน์ `result` = ✅/❌ + RAISE NOTICE สรุป ผ่าน X/Y
3. อัปเดต `web/supabase/README.md` — เพิ่มหัวข้อวิธีรันเทส RLS · build แอปไม่กระทบ (เป็น SQL ล้วน)

### ✅ verified แล้ว (23 มิ.ย. 69)
- ผู้ใช้ paste + รัน `tests/rls_impersonation_test.sql` บน Supabase จริง → **ผ่านครบ 27/27 เคส** ✅
  (anon อ่านไม่ได้ · audit_log เห็นเฉพาะ manager/qa · เขียน/แก้ตาม policy · แก้ profile คนอื่น=เงียบ · audit_log แก้ไม่ได้)
- 🔧 เจอ 2 บั๊กระหว่างทาง แก้แล้ว: (1) temp table `on commit drop` โดน editor ลบทันที → เลิกใช้ temp table
  (2) `array || string-literal` ตีความเป็น array||array (22P02) → เปลี่ยนเป็น `array_append()`

### ▶️ ขั้นถัดไป (D8 ส่วน 2 — ก้อนที่เหลือ)
- groundwork offline (C1: optimistic save + retry) · ขัดเกลามือถือ (touch target) · perf (index/query)

---

## 📅 บันทึกวันที่ 22 มิถุนายน 2569 — เฟส 8 / D8 ส่วน 1: Realtime

### ✅ วันนี้ทำอะไรไปบ้าง — อัปเดตหน้าจอแบบสด (Realtime) 🔴🟢
> ผู้ใช้เลือกทำ D8 แบ่งเป็นก้อน (เหมือน D6): **(1) Realtime** ← เสร็จ · (2) เทส RLS + perf + มือถือ + offline ← ถัดไป
1. **เช็ก roadmap + Notion ก่อนเริ่ม** — `recommendations.md` D8 = hardening (realtime · RLS tests B4 · perf · mobile · offline) ·
   fetch Notion **Lean PRD**: ยืนยัน pain point หลัก = "ไม่อัปเดตแบบ Real-time" → ทำ realtime ก่อนตรงโจทย์สุด · ไม่มี requirement ใหม่
2. **`components/realtime-refresh.tsx` (ใหม่)** — client component ฟัง Supabase Realtime (`postgres_changes`)
   ของตารางที่ระบุ → เมื่อมีคนเพิ่ม/แก้/ลบ สั่ง `router.refresh()` (debounce 300ms) ดึงข้อมูลใหม่จาก server
   - **คงสถาปัตยกรรม server-first**: client ไม่ถือ state ข้อมูลเอง แค่สั่ง revalidate
   - มีป้าย "🟢 อัปเดตสด" มุมจอล่างขวา (โผล่เฉพาะตอนเชื่อมต่อสำเร็จ)
   - RLS ยังบังคับ — รับเฉพาะ event ของแถวที่ตัวเองมีสิทธิ์อ่าน
3. **ฝังลง 4 หน้า:** บอร์ดงาน (`jobs`) · แดชบอร์ด (`jobs`+`production_records`) ·
   รายงานประจำวัน (`production_records`) · รายละเอียดงาน (`jobs`+`production_records`+`approvals`)
4. **DB (ไฟล์ `web/supabase/migrations/0009_realtime.sql`)** — ⏳ รอ paste:
   - `alter publication supabase_realtime add table ...` 3 ตาราง (jobs/production_records/approvals)
   - ใช้ DO block กัน duplicate (รันซ้ำได้)
5. **ทดสอบ:** `npm run build` ผ่าน (TypeScript เคลียร์)

### ⚠️ ขั้นที่ผู้ใช้ต้องทำเอง
- **paste `0009_realtime.sql`** ลง Supabase SQL Editor (ต่อจาก 0001–0008) → realtime ถึงจะ broadcast
  (ถ้ายังไม่ paste: หน้าจอยังใช้ได้ปกติ แต่ต้องรีเฟรชเองเพื่อเห็นของใหม่ · ป้าย "อัปเดตสด" อาจขึ้นแต่ไม่มี event มา)
- ทดสอบ: เปิดบอร์ดงาน 2 หน้าจอ (หรือมือถือ+คอม) → จอ A เปลี่ยนสถานะงาน → จอ B ขยับเองภายในไม่กี่วินาที

### ▶️ ขั้นถัดไป (D8 ส่วน 2)
- **เทส RLS ด้วย impersonation** (recommendations B4 — RLS ผิดคืนค่าว่างเงียบ ต้องเทสที่ผลลัพธ์) ·
  perf (index/query) · ขัดเกลามือถือ · groundwork offline (optimistic save + retry ตาม C1)

---

## 📅 บันทึกวันที่ 22 มิถุนายน 2569 — เฟส 7 / D7: Dashboard / KPI + ต้นทุนค่าแรง

### ✅ วันนี้ทำอะไรไปบ้าง — แดชบอร์ดผู้บริหาร 📊💰
1. **เช็ก roadmap + Notion ก่อนเริ่ม** — `recommendations.md` D7 = "Dashboard / KPI + DL cost" ·
   fetch Notion demo-feature-suggestions: ยัง 10 ฟีเจอร์เดิม ไม่มี requirement ใหม่ (ข้อ 1 "ผู้บริหารดูภาพรวม")
2. **`lib/data/dashboard.ts` (ใหม่)** — `getDashboardData(from, to)`:
   - นับงานตามสถานะ + งานติดปัญหา (ภาพรวมงานปัจจุบัน — ไม่อิงช่วงวันที่)
   - รวม input/output/loss/hours ของ `production_records` ในช่วง [from, to] · **Yield%** = output/input
   - แยกตามสถานี (prep/mixing/tableting/packing) ครบทุกสถานีแม้ไม่มีข้อมูล
   - ค่าคงที่ `DEFAULT_LABOR_RATE = 60` (บาท/ชม.)
3. **`app/(app)/page.tsx` — ยกเครื่องหน้า `/` (เมนู "แดชบอร์ด")** เป็นหน้าสรุปผู้บริหารจริง:
   - ฟอร์มเลือกช่วงวันที่ (from–to, method=get · default = ต้นเดือน→วันนี้)
   - การ์ดงานตามสถานะ (เดิม) + KPI ผลผลิต: ผลิตได้รวม / ของเสียรวม / Yield% / ชม.แรงงานรวม
   - **ส่วนต้นทุนค่าแรง (DL cost) — เห็นเฉพาะ manager** (ต้นทุน = ข้อมูลอ่อนไหว):
     ปรับ rate ได้ (ช่อง ฿/ชม.) · ยอดรวม = ชม.รวม × rate · ตารางแยกสถานี (ชม./ผลิตได้/ของเสีย/ค่าแรง) + แถวรวม
4. **ไม่ต้อง paste DB เพิ่ม** — อ่านข้อมูล D5 ที่มีอยู่ · `npm run build` ผ่าน (TypeScript เคลียร์)

### 📌 หมายเหตุการออกแบบ (กันลืม)
- **อัตราค่าแรงยังไม่เก็บใน DB** — ใช้ค่า default 60 ฿/ชม. + ปรับชั่วคราวผ่าน URL param (`?rate=`)
  ค่าจะรีเซ็ตเมื่อรีโหลด · ถ้าผู้บริหารอยากให้จำค่าถาวร → ต่อยอดเป็นตาราง `app_settings` (ต้อง paste SQL + RLS) ภายหลัง
- DL cost = "ต้นทุนค่าแรงทางตรง" คิดจากชั่วโมงที่บันทึกเท่านั้น (ประเมินเบื้องต้น ไม่รวม OT/สวัสดิการ)

### ⚠️ ขั้นที่ผู้ใช้ควรทดสอบ (ออปชัน — โค้ดพร้อม/ไม่ต้อง paste)
- login เป็น **manager** เปิดหน้าแรก → เห็นช่อง "ค่าแรง" + ส่วน DL cost · ลองเปลี่ยนช่วงวันที่/อัตรา
- login เป็น role อื่น (เช่น production) → **ไม่เห็น** ส่วนต้นทุนค่าแรง (เห็นแค่ KPI ผลผลิต)

### ▶️ ขั้นถัดไป (D8)
- **D8 hardening**: realtime · RLS tests · perf · ขัดเกลา mobile · groundwork offline
  (อ่าน `docs/recommendations.md` roadmap D8 + fetch Notion เช็ก requirement ใหม่ก่อน)

---

## 📅 บันทึกวันที่ 22 มิถุนายน 2569 — เฟส 6 / D6 ส่วน 2: Daily Report

### ✅ วันนี้ทำอะไรไปบ้าง — หน้ารายงานประจำวัน 📊
1. **Daily Report** — หน้า `/daily` สรุปบันทึกผลผลิตของทุกงานในวันที่เลือก (ไม่ต้อง paste DB เพิ่ม — อ่านข้อมูล D5)
   - `lib/data/daily.ts` (`getDailyReport(date)`) — join `production_records → jobs(job_no) → orders → products(name)`
     + ชื่อ operator · sort ตามเลขงานใน JS (order ตามคอลัมน์ embed ไม่จัดลำดับแถวหลัก)
   - `app/(app)/daily/page.tsx` — server component อ่าน `searchParams.date` (default วันนี้) ·
     ฟอร์มเลือกวันที่ (method=get) · การ์ดสรุป (จำนวน/ผลิตได้รวม/ของเสียรวม/ชม.รวม) · ตารางคลิกเข้างานได้
   - `nav.ts` — เพิ่มเมนู "รายงานประจำวัน" (ready=true, ทุก role) · ลบ placeholder `/production` ที่ไม่ได้ใช้
     (บันทึกผลผลิตอยู่ในหน้า job แล้ว) · `npm run build` ผ่าน
2. **= D6 เสร็จครบทั้ง 2 ส่วน** (E-signature + Daily Report)

### ▶️ ขั้นถัดไป (D7)
- **D7**: Dashboard / KPI + ต้นทุนค่าแรง (DL cost) — สรุปภาพรวมผู้บริหาร
  (อ่าน `docs/recommendations.md` roadmap D7 + fetch Notion เช็ก requirement ใหม่ก่อน)

---

## 📅 บันทึกวันที่ 22 มิถุนายน 2569 — เฟส 6 / D6 ส่วน 1: E-signature

### ✅ วันนี้ทำอะไรไปบ้าง — ลายเซ็นอิเล็กทรอนิกส์ (lite) ของ QC/QA 🖊️
> ผู้ใช้เลือกทำ D6 เป็น 2 ก้อน: **(1) E-signature** ← verified ✅ · (2) Daily Report ← เสร็จแล้ว (บล็อกบน)
1. **เช็ก Notion ก่อนเริ่ม** — fetch Lean PRD + demo-feature-suggestions: ไม่มี requirement ใหม่
   (หมายเหตุ: ปุ่ม QC/QA อนุมัติ/ตีกลับ ทำไปแล้วใน D4 · D6 = เพิ่มชั้น "ลงนามยืนยันรหัส" + เก็บ approvals ตาม A3)
2. **DB (ไฟล์ `web/supabase/migrations/0008_approvals.sql`)** — ⏳ รอ paste:
   - ตาราง `approvals` (job/ผู้ลงนาม/stage qc-qa/decision approve-reject/reason/signed_at + ALCOA cols)
     + meta trigger + audit trigger + RLS (อ่านได้ authenticated, เขียนผ่านฟังก์ชันเท่านั้น)
   - ฟังก์ชัน `sign_job_decision(job, stage, decision, reason)` (security definer):
     ตรวจ role ตาม stage · reject ต้องมีเหตุผล · เช็กงานอยู่ขั้นนั้นจริง · บันทึกลายเซ็น
     **แล้วเรียก `advance_job_status()` ขยับสถานะในธุรกรรมเดียว (atomic)** — ใช้ด่านเดิมเป็น gatekeeper
3. **แอป (`web/`)** — build ผ่าน:
   - `board/actions.ts` เพิ่ม `signDecision()` — **ยืนยันรหัสผ่านซ้ำ** ผ่าน verifier client แยก
     (`@supabase/supabase-js` publishable key, persistSession:false → ไม่แตะ session ที่ล็อกอิน) ก่อนเรียก rpc
   - `job-constants.ts` — mark `esign:true` + `stage` บน transition qc/qa ทั้ง 4
   - `job-actions.tsx` — ปุ่ม QC/QA (🖊️) เปิดแผงลงนาม: ช่องรหัสผ่าน (+เหตุผลถ้าตีกลับ) · ปุ่มอื่นทำงานเหมือนเดิม
   - `lib/data/approvals.ts` (`getApprovalsForJob`) + แสดงรายการลายเซ็นในหน้า `board/[jobNo]`
     (เขียว=อนุมัติ/แดง=ตีกลับ + เหตุผล + เวลา)
4. **ทดสอบ:** `npm run build` ผ่าน (TypeScript เคลียร์)

### ⚠️ ขั้นที่ผู้ใช้ต้องทำเอง
- **paste `0008_approvals.sql`** ลง Supabase SQL Editor (ต่อจาก 0001–0007)
- ทดสอบ: login เป็น **qc** เปิดงานสถานะ QC (เช่น JOB-002) → กด "🖊️ QC ผ่าน → ส่ง QA"
  → ใส่รหัสผิดดูว่าปฏิเสธ · ใส่รหัสถูกดูว่าสถานะขยับเป็น QA + ลายเซ็นโผล่ในหน้า

### ▶️ ขั้นถัดไป (D6 ส่วน 2)
- **Daily Report** — หน้าสรุปบันทึกผลผลิตรายวัน (รวมทุกงาน กรองตามวันที่/สถานี) + เพิ่มเมนู
  (ข้อมูลมีแล้วจาก D5 · เหลือทำหน้า report view)

---

## 📅 บันทึกวันที่ 22 มิถุนายน 2569 — เฟส 5 / D5

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
**เฟส 5 / D5 = เสร็จสมบูรณ์ + verified ✅ (22 มิ.ย. 69)** — ฟอร์มบันทึกผลผลิตรายวัน + validation ฝั่ง server + audit
  · ฟังก์ชัน `add_production_record()` (security definer): สิทธิ์ production/manager · guard สถานะ in_production/qc/qa
    · output≤input · output+loss≤input · ห้ามติดลบ · ทศนิยม · ชม. 0–24 · วันที่ล้ำอนาคตไม่ได้ · ตั้ง audit GUC
  · `validateRecord()` ใช้ร่วม client/server · ฟอร์ม decimal + ตารางบันทึกในหน้า job detail
  · ผู้ใช้ paste 0007 แล้ว · ทดสอบจาก UI (login จริง): บันทึก JOB-001 input1000/output980/loss20 สำเร็จ
    · ทศนิยมเก็บถูก · operator_id = บัญชีที่ login จริง · **audit เก็บ changed_by + reason "บันทึกผลผลิต prep"** ✓
**เฟส 6 / D6 = เสร็จสมบูรณ์ ✅ (22 มิ.ย. 69)** — แบ่ง 2 ส่วน
  · **ส่วน 1 E-signature (lite)** — `0008_approvals.sql` (ตาราง approvals + `sign_job_decision()`) ·
    ยืนยันรหัสผ่านซ้ำก่อนลงนาม · บันทึกลายเซ็น + ขยับสถานะ atomic · **verified จาก UI** (login จริง):
    QC ตีกลับ (มีเหตุผล "test") + QC อนุมัติ บน JOB-001 · audit เก็บผู้ลงนาม "ลงนาม QC — อนุมัติ" ✓
  · **ส่วน 2 Daily Report** — หน้า `/daily` สรุปผลผลิตรายวันทุกงาน + กรองวันที่ + ยอดรวม + คลิกเข้างานได้
    (อ่านข้อมูล D5 ไม่ต้อง paste DB เพิ่ม · build ผ่าน · ⏳ ยังไม่ทดสอบ UI)
**เฟส 7 / D7 = เสร็จสมบูรณ์ ✅ (22 มิ.ย. 69)** — Dashboard / KPI + ต้นทุนค่าแรง (DL cost)
  · `lib/data/dashboard.ts` (`getDashboardData`) + ยกเครื่องหน้า `/` เป็นแดชบอร์ดผู้บริหาร
  · ช่วงวันที่ + KPI ผลผลิต/Yield%/ชม. · **ส่วน DL cost เฉพาะ manager** (ปรับ rate ได้ + แยกสถานี)
  · ไม่ต้อง paste DB เพิ่ม (อ่านข้อมูล D5) · build ผ่าน · ⏳ ยังไม่ทดสอบ UI
  · 📌 อัตราค่าแรงยังไม่เก็บถาวร (default 60 ฿/ชม. + URL param) — ต่อยอดเป็น `app_settings` ได้ภายหลัง
**เฟส 8 / D8 = กำลังทำ (แบ่งก้อน) — ส่วน 1 Realtime เสร็จ ✅ (22 มิ.ย. 69)**
  · `components/realtime-refresh.tsx` ฟัง Supabase Realtime → `router.refresh()` (server-first คงเดิม) + ป้าย "อัปเดตสด"
  · ฝัง 4 หน้า (บอร์ด/แดชบอร์ด/รายงานประจำวัน/รายละเอียดงาน) · build ผ่าน
  · ✅ **paste `0009_realtime.sql` แล้ว** (22 มิ.ย. 69 — เปิด publication 3 ตาราง) · ⏳ ยังไม่ verify UI 2 จอ
  · **ส่วน 2 = กำลังทำ (แบ่ง 4 ก้อน):**
    - **ก้อน 1 เทส RLS (B4) = verified ✅ (23 มิ.ย. 69)** — `web/supabase/tests/rls_impersonation_test.sql`
      (ฟังก์ชัน `pg_temp.rls_test()` return ตาราง · raise undo ไม่แตะข้อมูล · **ผ่าน 27/27 บน DB จริง**)
    - **ก้อน 2 Offline-resilient save (C1) = verified ✅ (23 มิ.ย. 69)** — `0010_record_idempotency.sql` (client_id idempotency)
      + `lib/offline-queue.ts` + ยกเครื่อง `record-form.tsx` (auto-retry/backoff · คิว localStorage · banner กู้ค้าง · online retry)
      · **ทดสอบ UI จริง: บันทึกปกติ + offline retry ไม่มีแถวซ้ำ ผ่าน**
    - **ก้อน 3 ขัดเกลามือถือ เสร็จ ✅ (23 มิ.ย. 69)** — `globals.css` (iOS zoom fix + touch 44px เฉพาะ pointer:coarse)
      + app-shell padding · build ผ่าน · ไม่ต้อง paste DB · ⏳ รอเทสบนมือถือ (ออปชัน)
    - **ก้อน 4 perf = เลื่อน (ตั้งใจ)** — ข้อมูลยังน้อย วัดไม่ได้ + index หลักมีครบ → ทำตอนข้อมูลเยอะ (Backlog)
  · **= D8 ปิดแล้ว (hardening สำคัญครบ)**
**เฟส 9 / D9 = กำลังทำ (23 มิ.ย. 69):**
  · **ก้อน 1 หน้าสร้างงานผลิตใหม่ = verified ✅** — `0011_create_job.sql` (`create_product`+`create_job_with_order`, manager เท่านั้น)
    + `/board/new` (ฟอร์ม + เพิ่มยา inline) + ปุ่มบนบอร์ด · **ทดสอบ UI จริงผ่าน** (ปิด gap requirement ข้อ 1)
  · **ก้อน 2 Checklist UAT เสร็จ ✅** — `docs/uat-checklist.md` (flow ครบวงจร + กันสิทธิ์ + ฟีเจอร์เด่น + go-live) · เอกสารล้วน
  · ถัดไป: ทีมไล่ทดสอบจริง → เก็บ feedback · งาน go-live (บัญชีจริง/จัดการ seed/หน้า admin)
