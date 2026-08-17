-- ============================================================
-- PD Monitor — Part 2.1 ก้อน 1 / 0044_product_delete_perms.sql
-- หน้า "ผลิตภัณฑ์ / ขั้นตอนการผลิต" — ลบจริง + สิทธิ์ฝ่ายคลัง + เลิกใช้ "ประเภท"
--
--   (1) can_manage_products()  — ฝ่ายวางแผน + ฝ่ายคลัง + ผู้บริหาร (ของเดิม = วางแผน/ผู้บริหาร)
--   (2) drop upsert_product เก่า (7 พารามิเตอร์) → สร้างใหม่ 6 ตัว (ตัด p_type)
--   (3) drop column products.type — ทีมเลิกใช้การแยก ยา/RM/PM แล้ว
--   (4) set_product_active — เปลี่ยน guard เป็น can_manage_products()
--   (5) delete_product / delete_station — "ลบจริงก่อน ติดแล้วปิดใช้งานให้อัตโนมัติ"
--
-- ⚠️ ต้อง drop function ก่อน create ใหม่ — ไม่งั้นเป็น overload ซ้อน 2 ตัว
--    PostgREST จะตอบ PGRST203 "เลือกไม่ถูก" (gotcha เดิมจาก 0039)
-- ⚠️ ข้อ (3) ย้อนกลับไม่ได้ — ถ้าอยากเก็บทางถอย ให้ comment บล็อกนั้นทิ้งก่อน paste
-- ℹ️ ลบจริงยังมีร่องรอย GMP: trigger trg_audit_products/trg_audit_stations (0002/0022)
--    เก็บ old_data ทั้งแถวไว้ใน audit_log ตอน DELETE อยู่แล้ว
-- รัน "หลัง" 0001–0043
-- ============================================================

-- ------------------------------------------------------------
-- (1) can_manage_products — ใครจัดการ "ทะเบียนผลิตภัณฑ์" ได้บ้าง
--     ฝ่ายคลังขอสิทธิ์เพิ่ม/แก้/ลบผลิตภัณฑ์เอง (แต่ยังแตะ route ไม่ได้ — นั่นคือ can_manage_stations)
--     has_role ถือว่า admin ผ่านทุก role อยู่แล้ว (0013)
-- ------------------------------------------------------------
create or replace function public.can_manage_products()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('planner')
      or public.has_role('warehouse')
      or public.has_role('manager');
$$;

grant execute on function public.can_manage_products() to authenticated;

comment on function public.can_manage_products() is
  'สิทธิ์จัดการทะเบียนผลิตภัณฑ์ = วางแผน/คลัง/ผู้บริหาร — ต้องตรงกับ canManageProducts() ใน web/lib/data/role-access.ts';

-- ------------------------------------------------------------
-- (2) drop upsert_product signature เก่า (มี p_type) — ต้องทำ "ก่อน" drop column
-- ------------------------------------------------------------
drop function if exists public.upsert_product(uuid, text, text, text, text, text, text);

-- ------------------------------------------------------------
-- (3) เลิกใช้คอลัมน์ type — ทีมยืนยันว่าไม่แยก ยา/RM/PM แล้ว
--     (check constraint products_type_chk + index idx_products_type ถูกลบตามไปเอง)
--     ⚠️ ผลข้างเคียงที่ยอมรับแล้ว: dropdown เลือกยาหน้าสร้างงานจะเห็นผลิตภัณฑ์ทุกตัว
-- ------------------------------------------------------------
alter table public.products drop column if exists type;

-- ------------------------------------------------------------
-- (4) upsert_product — เพิ่ม/แก้ผลิตภัณฑ์ (6 พารามิเตอร์)
-- ------------------------------------------------------------
create or replace function public.upsert_product(
  p_id          uuid,
  p_code        text,
  p_name        text,
  p_unit        text default 'TAB',
  p_reg_no      text default null,
  p_dosage_form text default null
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
    insert into public.products (code, name, unit, reg_no, dosage_form, created_by)
    values (p_code, p_name, p_unit,
            nullif(btrim(coalesce(p_reg_no, '')), ''),
            nullif(btrim(coalesce(p_dosage_form, '')), ''),
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
           updated_by  = v_profile
     where id = p_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.upsert_product(uuid, text, text, text, text, text)
  to authenticated;

-- ------------------------------------------------------------
-- (5) set_product_active — ยังต้องมีอยู่ (ปุ่ม "กู้คืน" ของที่เคยปิดใช้งานไป)
--     เปลี่ยนแค่ guard ให้ฝ่ายคลังใช้ได้ด้วย · signature เดิม ไม่ต้อง drop
-- ------------------------------------------------------------
create or replace function public.set_product_active(
  p_id        uuid,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_code    text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_products() then
    raise exception 'เฉพาะฝ่ายวางแผน/ฝ่ายคลัง/ผู้บริหารจัดการผลิตภัณฑ์ได้';
  end if;

  select code into v_code from public.products where id = p_id;
  if v_code is null then raise exception 'ไม่พบผลิตภัณฑ์ที่เลือก'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    case when coalesce(p_is_active, true)
         then 'เปิดใช้งานผลิตภัณฑ์ ' || v_code
         else 'ปิดใช้งานผลิตภัณฑ์ ' || v_code end, true);

  update public.products
     set is_active = coalesce(p_is_active, true), updated_by = v_profile
   where id = p_id;

  return p_id;
end;
$$;

grant execute on function public.set_product_active(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- (6) delete_product — "ลบจริงก่อน ติดแล้วปิดใช้งานให้อัตโนมัติ"
--     คืน jsonb { action: 'deleted' | 'deactivated', message: '...' }
--
--     ⚠️ ต้อง pre-check material_lots เอง — FK เป็น on delete cascade (0042:62)
--        ถ้าไม่เช็ก ลบยา 1 ตัว = ล็อตในคลังของยานั้นหายเงียบทั้งหมด
--     product_routes / product_recipes เป็น cascade เหมือนกัน แต่ "ตั้งใจให้หายตาม"
--     (เป็นของลูกของผลิตภัณฑ์นั้นล้วนๆ ไม่ใช่ประวัติการผลิต)
-- ------------------------------------------------------------
create or replace function public.delete_product(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_code    text;
  v_orders  integer;
  v_jobs    integer;
  v_batches integer;
  v_fg      integer;
  v_lots    integer;
  v_parts   text[] := '{}';
  v_msg     text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_products() then
    raise exception 'เฉพาะฝ่ายวางแผน/ฝ่ายคลัง/ผู้บริหารจัดการผลิตภัณฑ์ได้';
  end if;

  select code into v_code from public.products where id = p_id;
  if v_code is null then raise exception 'ไม่พบผลิตภัณฑ์ที่เลือก'; end if;

  select count(*) into v_orders  from public.orders        where product_id = p_id;
  select count(*) into v_batches from public.batches       where product_id = p_id;
  select count(*) into v_fg      from public.fg_inventory  where product_id = p_id;
  select count(*) into v_lots    from public.material_lots where product_id = p_id;
  select count(*) into v_jobs
    from public.jobs j
    join public.orders o on o.id = j.order_id
   where o.product_id = p_id;

  perform set_config('app.current_profile_id', v_profile::text, true);

  -- ยังไม่มีใครใช้ → ลบออกจากฐานข้อมูลจริง
  if v_orders = 0 and v_batches = 0 and v_fg = 0 and v_lots = 0 then
    perform set_config('app.audit_reason',
      'ลบผลิตภัณฑ์ ' || v_code || ' (ยังไม่ถูกใช้งาน — ลบจริง)', true);
    delete from public.products where id = p_id;
    return jsonb_build_object(
      'action', 'deleted',
      'message', 'ลบผลิตภัณฑ์ ' || v_code || ' ออกจากระบบแล้ว'
    );
  end if;

  -- ถูกใช้งานไปแล้ว → เก็บแถวไว้เป็นประวัติ GMP แต่ปิดใช้งาน
  if v_jobs    > 0 then v_parts := v_parts || ('งานผลิต '        || v_jobs    || ' ใบ');    end if;
  if v_orders  > 0 then v_parts := v_parts || ('ใบสั่งผลิต '      || v_orders  || ' ใบ');    end if;
  if v_batches > 0 then v_parts := v_parts || ('ล็อตการผลิต '     || v_batches || ' รายการ'); end if;
  if v_fg      > 0 then v_parts := v_parts || ('สต็อก FG '        || v_fg      || ' รายการ'); end if;
  if v_lots    > 0 then v_parts := v_parts || ('ล็อตในคลัง '      || v_lots    || ' ล็อต');   end if;
  v_msg := 'ลบไม่ได้ — มี' || array_to_string(v_parts, ' · ') || ' ใช้อยู่ · เปลี่ยนเป็นปิดใช้งานแทนแล้ว';

  perform set_config('app.audit_reason',
    'ปิดใช้งานผลิตภัณฑ์ ' || v_code || ' (' || array_to_string(v_parts, ' · ') || ')', true);

  update public.products
     set is_active = false, updated_by = v_profile
   where id = p_id;

  return jsonb_build_object('action', 'deactivated', 'message', v_msg);
end;
$$;

grant execute on function public.delete_product(uuid) to authenticated;

-- ------------------------------------------------------------
-- (7) delete_station — โครงเดียวกัน (สิทธิ์ยังเป็นผู้บริหารเท่านั้น)
--     RESTRICT 3 จุด: job_routes · inprocess_checks · production_records
--     product_routes เป็น cascade — ถอดสถานีออกจากสูตรคือสิ่งที่ตั้งใจ
--     แต่บอกจำนวนไว้ใน audit reason ให้ตามรอยได้
-- ------------------------------------------------------------
create or replace function public.delete_station(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_code    text;
  v_jroutes integer;
  v_checks  integer;
  v_records integer;
  v_proutes integer;
  v_parts   text[] := '{}';
  v_msg     text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_stations() then
    raise exception 'เฉพาะผู้บริหารจัดการสถานีการผลิตได้';
  end if;

  select code into v_code from public.stations where id = p_id;
  if v_code is null then raise exception 'ไม่พบสถานีที่เลือก'; end if;

  select count(*) into v_jroutes from public.job_routes         where station_id = p_id;
  select count(*) into v_checks  from public.inprocess_checks   where station_id = p_id;
  select count(*) into v_records from public.production_records where station_id = p_id;
  select count(*) into v_proutes from public.product_routes     where station_id = p_id;

  perform set_config('app.current_profile_id', v_profile::text, true);

  if v_jroutes = 0 and v_checks = 0 and v_records = 0 then
    perform set_config('app.audit_reason',
      'ลบสถานี ' || v_code || ' (ยังไม่ถูกใช้งาน — ลบจริง'
      || case when v_proutes > 0
              then ' · ถอดออกจากสูตร ' || v_proutes || ' รายการ' else '' end || ')', true);
    delete from public.stations where id = p_id;
    return jsonb_build_object(
      'action', 'deleted',
      'message', 'ลบสถานี ' || v_code || ' ออกจากระบบแล้ว'
        || case when v_proutes > 0
                then ' (ถอดออกจากขั้นตอนการผลิตของผลิตภัณฑ์ ' || v_proutes || ' รายการ)' else '' end
    );
  end if;

  if v_records > 0 then v_parts := v_parts || ('บันทึกผลผลิต ' || v_records || ' รายการ'); end if;
  if v_checks  > 0 then v_parts := v_parts || ('ผลตรวจ in-process ' || v_checks || ' รายการ'); end if;
  if v_jroutes > 0 then v_parts := v_parts || ('ขั้นตอนการผลิตของงาน ' || v_jroutes || ' รายการ'); end if;
  v_msg := 'ลบไม่ได้ — มี' || array_to_string(v_parts, ' · ') || ' ใช้อยู่ · เปลี่ยนเป็นปิดใช้งานแทนแล้ว';

  perform set_config('app.audit_reason',
    'ปิดใช้งานสถานี ' || v_code || ' (' || array_to_string(v_parts, ' · ') || ')', true);

  update public.stations
     set is_active = false, updated_by = v_profile
   where id = p_id;

  return jsonb_build_object('action', 'deactivated', 'message', v_msg);
end;
$$;

grant execute on function public.delete_station(uuid) to authenticated;

-- ============================================================
-- ตรวจหลังรัน (ออปชัน)
--   select code, name, unit, reg_no, dosage_form, is_active from public.products order by code;
--   -- ต้องไม่มีคอลัมน์ type แล้ว
--   select proname, pg_get_function_identity_arguments(oid)
--     from pg_proc where proname in ('upsert_product','delete_product','delete_station',
--                                    'can_manage_products');
--   -- upsert_product ต้องมีแถวเดียว (6 อาร์กิวเมนต์) — ถ้าเห็น 2 แถว = overload ซ้อน
-- ============================================================
