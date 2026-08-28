-- ============================================================
-- PD Monitor — Part D ก้อน 1 / 0070_product_appearance.sql
-- "ลักษณะยา" (รูปร่างลักษณะยา) — ช่องบนใบแจ้งผลิต F.PLN.01
--   (1) products.appearance
--   (2) upsert_product — เพิ่มพารามิเตอร์ p_appearance
-- รัน "หลัง" 0069
--
-- 🚨 ต้อง drop signature เก่า 6 พารามิเตอร์ก่อน create ใหม่ 7 พารามิเตอร์
--    ไม่งั้น PostgREST เห็น overload 2 ตัวแล้วตอบ PGRST203 ทุก call
--    (เจอมาแล้วที่ 0039 / 0041 / 0044 / 0048)
-- ============================================================

-- ------------------------------------------------------------
-- (1) คอลัมน์ใหม่
--     เก็บเป็น text อิสระ — ข้อความจริงจาก master ยาว เช่น
--     "ยาเม็ดรูปกลมนูน เคลือบน้ำตาลสีขาว เรียบทั้งสองด้าน"
-- ------------------------------------------------------------
alter table public.products add column if not exists appearance text;

comment on column public.products.appearance is
  'ลักษณะยา (รูปร่างลักษณะยา) — ช่องบนใบแจ้งผลิต F.PLN.01 · Part D (0070)';

-- ------------------------------------------------------------
-- (2) drop upsert_product signature เก่า (6 พารามิเตอร์ — 0044:56-63)
-- ------------------------------------------------------------
drop function if exists public.upsert_product(uuid, text, text, text, text, text);

-- ------------------------------------------------------------
-- (3) upsert_product — 7 พารามิเตอร์ (บอดี้เดิม 0044:56-121 + appearance)
--     guard เดิม can_manage_products() คงไว้ทุกอย่าง
-- ------------------------------------------------------------
create or replace function public.upsert_product(
  p_id          uuid,
  p_code        text,
  p_name        text,
  p_unit        text default 'TAB',
  p_reg_no      text default null,
  p_dosage_form text default null,
  p_appearance  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_id      uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_products() then
    raise exception 'เฉพาะฝ่ายวางแผน/ฝ่ายคลัง/ผู้บริหารจัดการผลิตภัณฑ์ได้';
  end if;

  p_code := btrim(coalesce(p_code, ''));
  p_name := btrim(coalesce(p_name, ''));
  p_unit := btrim(coalesce(p_unit, ''));

  if p_code = '' then raise exception 'กรุณาระบุรหัสผลิตภัณฑ์ (code)'; end if;
  if p_name = '' then raise exception 'กรุณาระบุชื่อผลิตภัณฑ์'; end if;
  if p_unit = '' then p_unit := 'TAB'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);

  if p_id is null then
    if exists (select 1 from public.products where code = p_code) then
      raise exception 'รหัสผลิตภัณฑ์ % มีอยู่แล้ว', p_code;
    end if;
    perform set_config('app.audit_reason', 'เพิ่มผลิตภัณฑ์ ' || p_code, true);
    insert into public.products (code, name, unit, reg_no, dosage_form, appearance, created_by)
    values (p_code, p_name, p_unit,
            nullif(btrim(coalesce(p_reg_no, '')), ''),
            nullif(btrim(coalesce(p_dosage_form, '')), ''),
            nullif(btrim(coalesce(p_appearance, '')), ''),
            v_profile)
    returning id into v_id;
  else
    if not exists (select 1 from public.products where id = p_id) then
      raise exception 'ไม่พบผลิตภัณฑ์ที่เลือก';
    end if;
    if exists (select 1 from public.products where code = p_code and id <> p_id) then
      raise exception 'รหัสผลิตภัณฑ์ % ถูกใช้กับรายการอื่นแล้ว', p_code;
    end if;
    perform set_config('app.audit_reason', 'แก้ผลิตภัณฑ์ ' || p_code, true);
    update public.products
       set code        = p_code,
           name        = p_name,
           unit        = p_unit,
           reg_no      = nullif(btrim(coalesce(p_reg_no, '')), ''),
           dosage_form = nullif(btrim(coalesce(p_dosage_form, '')), ''),
           appearance  = nullif(btrim(coalesce(p_appearance, '')), ''),
           updated_by  = v_profile
     where id = p_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.upsert_product(uuid, text, text, text, text, text, text)
  to authenticated;

comment on function public.upsert_product(uuid, text, text, text, text, text, text) is
  'เพิ่ม/แก้ผลิตภัณฑ์ — Part D (0070) เพิ่ม p_appearance (ลักษณะยา)';

-- ============================================================
-- ✅ ตรวจหลังรัน (paste แยกใน SQL Editor)
--
--   -- คอลัมน์ใหม่ต้องมี
--   select column_name, data_type
--     from information_schema.columns
--    where table_name = 'products' and column_name = 'appearance';
--
--   -- ต้องเหลือ upsert_product เวอร์ชันเดียว และเป็น 7 พารามิเตอร์
--   select p.oid::regprocedure
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'upsert_product';
-- ============================================================
