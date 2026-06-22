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

   > แต่ละไฟล์รันแยกกัน เห็น "Success. No rows returned" = ผ่าน

4. เช็กผล: เมนูซ้าย → **Table Editor** ต้องเห็นตาราง
   `profiles, user_roles, products, orders, batches, jobs, production_records, audit_log`
   - ลองเปิดตาราง `audit_log` → จะเห็น log ของการ insert seed (ถ้ารัน seed)

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
