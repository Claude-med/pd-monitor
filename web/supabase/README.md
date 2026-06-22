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
   | 5 | `migrations/0004_auth_roles.sql` | **(D3)** เชื่อม Auth↔profiles + helper สิทธิ์ + RLS แยก role |

   > แต่ละไฟล์รันแยกกัน เห็น "Success. No rows returned" = ผ่าน

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

## ถ้าจะลบทิ้งเริ่มใหม่ (dev เท่านั้น — ระวัง! ลบข้อมูลหมด)

```sql
drop schema public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to anon, authenticated, service_role;
```
แล้วรัน 0001 → 0002 → 0003 → seed ใหม่
