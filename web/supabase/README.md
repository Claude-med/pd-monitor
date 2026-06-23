# ฐานข้อมูล Supabase — PD Monitor (D2)

ไฟล์ SQL ในโฟลเดอร์นี้คือ "พิมพ์เขียว" ของฐานข้อมูล แก้ในเครื่อง/commit ขึ้น git ได้
แต่ **ยังไม่ได้ลงจริงใน Supabase** จนกว่าจะ paste ตามขั้นด้านล่าง

## วิธีลง schema เข้า Supabase (ทำครั้งเดียว)

1. เปิด https://supabase.com → เข้า project **`pd-monitor`** (region Singapore)
2. เมนูซ้าย → **SQL Editor** → กด **+ New query**
3. Copy เนื้อไฟล์ทีละไฟล์ไปวาง แล้วกด **Run** (ปุ่มขวาล่าง) — **เรียงตามลำดับนี้เป๊ะๆ:**

   | ลำดับ | ไฟล์ | ทำอะไร |
   |---|---|---|
   | 1 | `migrations/0001_schema.sql` | สร้างตาราง + enum + คอลัมน์ ALCOA + trigger updated_at/version |
   | 2 | `migrations/0002_audit_log.sql` | ตาราง audit_log + trigger บันทึกประวัติ (append-only) |
   | 3 | `migrations/0003_rls.sql` | เปิด RLS (ความปลอดภัย) ทุกตาราง |
   | 4 | `seed.sql` | ข้อมูลตัวอย่างไว้ทดสอบ (ไม่ใส่ก็ได้ ถ้าจะใส่ข้อมูลจริงเอง) |
   | 5 | `migrations/0005_fix_auth_roles_meta.sql` | **(D3)** เชื่อม Auth↔profiles + helper สิทธิ์ + RLS แยก role (รวมแก้บั๊ก trigger) |
   | 6 | `migrations/0006_job_transitions.sql` | **(D4)** ฟังก์ชันบังคับลำดับสถานะงาน (กันข้ามขั้น) + บันทึก audit |

   > แต่ละไฟล์รันแยกกัน เห็น "Success. No rows returned" = ผ่าน
   >
   > **หมายเหตุ D3:** ใช้ `0005_fix_auth_roles_meta.sql` (ไฟล์เดียวจบ) — มันรวมทั้งการแก้บั๊ก trigger
   > ของ profiles + งาน D3 ทั้งหมดไว้แล้ว · `0004_auth_roles.sql` เก็บไว้เป็นฉบับ canonical สำหรับติดตั้งใหม่ตั้งแต่ต้น
   > (ถ้าเคยรัน 0004 แล้วเจอ error `record "new" has no field "created_by"` → รัน 0005 นี้ได้เลย ปลอดภัย ไม่ต้อง reset)
   >
   > **D5–D10 (ต่อจากด้านบน):** paste ตามลำดับเลขไฟล์ — `0007_production_records` (บันทึกผลผลิต) ·
   > `0008_approvals` (ลายเซ็น QC/QA) · `0009_realtime` (อัปเดตสด) · `0010_record_idempotency` (กันบันทึกซ้ำ) ·
   > `0011_create_job` (สร้างงาน/เพิ่มยา) · **`0012_admin_users` (D10 — RPC จัดการสิทธิ์/โปรไฟล์/ระงับบัญชี สำหรับหน้า `/admin/users`)** ·
   > **`0013_admin_role` (D10 — เพิ่ม role `admin` = ทำได้ทุกอย่าง · ทำให้ `has_role()` ถือว่า admin มีทุกสิทธิ์)** ·
   > **`0014_machines` (D10/A1 — ทะเบียนเครื่องจักร: ตาราง `machines` + enum `machine_status` + RPC `upsert_machine` สำหรับหน้า `/machines`)** ·
   > **`0015_record_machine` (D10/A1 ก้อน 2 — เพิ่ม `machine_id` ใน production_records + ยกเครื่อง `add_production_record` รับ p_machine_id + กันเลือกเครื่องที่ซ่อม/ถึงกำหนดสอบเทียบ)** ·
   > **`0016_materials` (D10/A2 ก้อน 1 — คลังวัตถุดิบ: ตาราง `materials` + `material_lots` + enum type/lot_status + RPC `upsert_material`/`upsert_material_lot` สำหรับหน้า `/materials`)** ·
   > **`0017_requisitions` (D10/A2 ก้อน 2 — ใบเบิกวัตถุดิบ: ตาราง `material_requisitions` + RPC `request_material`/`issue_requisition`/`cancel_requisition` · จ่ายแล้วตัดสต็อก กันล็อตไม่ผ่าน/หมดอายุ/สต็อกไม่พอ)**

4. เช็กผล: เมนูซ้าย → **Table Editor** ต้องเห็นตาราง
   `profiles, user_roles, products, orders, batches, jobs, production_records, audit_log`
   - ลองเปิดตาราง `audit_log` → จะเห็น log ของการ insert seed (ถ้ารัน seed)

## (D3) สร้างบัญชีผู้ใช้สำหรับล็อกอิน

หลังรัน `0004_auth_roles.sql` แล้ว ระบบจะ **ผูกบัญชี Auth เข้ากับโปรไฟล์โดยอัตโนมัติตามอีเมล**
ให้สร้างผู้ใช้ใน Supabase → เมนูซ้าย **Authentication → Users → Add user**:

1. กรอกอีเมล + รหัสผ่าน · **ติ๊ก "Auto Confirm User"** (ไม่งั้นล็อกอินไม่ได้)
2. ใช้อีเมลตรงกับโปรไฟล์ตัวอย่าง 5 บัญชี (สร้างกี่บัญชีก็ได้ เลือกที่จะทดสอบ):

   | อีเมล | รหัสผ่าน (ตั้งเอง) | role/แผนก |
   |---|---|---|
   | `somchai.prod@pdmonitor.app` | (ตั้งเอง) | ฝ่ายผลิต |
   | `somying.qc@pdmonitor.app`   | (ตั้งเอง) | QC |
   | `prapai.qa@pdmonitor.app`    | (ตั้งเอง) | QA |
   | `wichai.wh@pdmonitor.app`    | (ตั้งเอง) | คลังสินค้า |
   | `manop.mgr@pdmonitor.app`    | (ตั้งเอง) | ผู้บริหาร |

3. เปิดเว็บ https://pd-monitor.vercel.app → ล็อกอิน → จะเห็นเมนูตามสิทธิ์ของแต่ละ role
   - อีเมล "อื่น" ที่ไม่ตรง 5 อันนี้ก็ล็อกอินได้ แต่จะยังไม่มี role (ระบบสร้างโปรไฟล์ว่างให้) → กำหนด role เพิ่มในตาราง `user_roles`

> ผู้ใช้จริง ~30 คน: สร้างโปรไฟล์ในตาราง `profiles` (ใส่ `email`, `full_name`, `department`) + ใส่สิทธิ์ใน `user_roles`
> แล้วสร้าง Auth user ด้วยอีเมลเดียวกัน → ผูกอัตโนมัติ

## ของสำคัญที่ควรรู้ (กันงง)

- **เขียนข้อมูลจาก client ตรงๆ ไม่ได้** (RLS default-deny) — ตั้งใจ
  การเขียนจริงจะทำผ่าน Server Actions ที่ใช้ `SUPABASE_SECRET_KEY` ฝั่ง server (เริ่ม D5)
- **audit_log แก้/ลบไม่ได้** (append-only ตามแนว GMP) — แม้ใน SQL Editor ก็จะ error ถ้าพยายาม update/delete
- **"ใครแก้" + "เหตุผล"** ใน audit_log จะถูกเติมจริงเมื่อมี auth (D3) — ฝั่ง server จะตั้งค่า
  `app.current_profile_id` / `app.audit_reason` ก่อนเขียนทุกครั้ง
- ตอนนี้ยังไม่มีระบบ login (auth) → ทำใน **D3** แล้วจะใส่ policy แยกตาม role ทับ baseline ชุดนี้

## เทส RLS ด้วย impersonation (D8 ส่วน 2 — recommendations.md B4)

ไฟล์: **`tests/rls_impersonation_test.sql`**

- **ทำไมต้องเทส:** RLS ที่ตั้งผิด *ไม่ขึ้น error* — มันแค่คืน "0 แถวเงียบๆ" → ต้องเทสที่ผลลัพธ์จริง
  โดยสวมรอย (impersonate) เป็นผู้ใช้แต่ละ role แล้วเช็ก อ่านเห็น/ไม่เห็น · เขียนได้/ถูกปฏิเสธ
- **ปลอดภัย:** เป็นฟังก์ชัน `pg_temp.rls_test()` ที่ return ตารางผลลัพธ์ · ทุก insert/update ทดสอบ
  จะถูก `raise '__UNDO__'` ในบล็อกย่อยเพื่อ "ย้อนกลับ" → ไม่มีข้อมูลทดสอบค้าง · ไม่ใช้ temp table · รันซ้ำได้
  (ออกแบบให้ทนกับ Supabase SQL Editor ที่ commit ทีละ statement — อย่าใช้ `begin/rollback` กับ on-commit-drop)
- **วิธีใช้:** paste ทั้งไฟล์ลง SQL Editor → กด Run → ดูตารางผลลัพธ์ (คอลัมน์ `result`)
  ต้องรันหลังลง 0001–0009 + seed + ผูกบัญชี Auth กับ profiles ครบแล้ว (อิง uid จริง ไม่ hardcode)
- **อ่านผล:** ทุกแถวควรเป็น ✅ · ถ้าเจอ ❌ = RLS ไม่ตรงดีไซน์ ให้ไปตรวจ policy ของตารางนั้น
  (เคสตรวจ: anon อ่านไม่ได้ · audit_log เห็นเฉพาะ manager/qa · แก้ profile คนอื่นไม่ได้ · audit_log แก้ไม่ได้ ฯลฯ)

## ถ้าจะลบทิ้งเริ่มใหม่ (dev เท่านั้น — ระวัง! ลบข้อมูลหมด)

```sql
drop schema public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to anon, authenticated, service_role;
```
แล้วรัน 0001 → 0002 → 0003 → seed ใหม่
