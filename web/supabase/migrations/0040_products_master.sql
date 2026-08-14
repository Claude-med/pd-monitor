-- ============================================================
-- PD Monitor — Part 2 ก้อน 1 / 0040_products_master.sql
-- ยกระดับ "ผลิตภัณฑ์" ให้เป็น master เดียวของทั้งระบบ + เลิกใช้ BOM + สถานีจริง 9 ตัว
--
--   (1) products.unit / reg_no / type (fg|rm|pm) — เตรียมรับข้อมูล materials ในก้อน 3
--   (2) upsert_product     — เพิ่ม/แก้ผลิตภัณฑ์ (ของเดิม create_product เพิ่มได้อย่างเดียว แก้ไม่ได้)
--   (3) set_product_active — ปุ่ม "ลบ" = ปิดใช้งาน (soft delete · ประวัติ GMP คงอยู่)
--   (4) set_station_active — ปุ่ม "ลบ" สถานี = ปิดใช้งาน (มี FK RESTRICT 4 จุดผูกอยู่)
--   (5) สถานีการผลิต 9 ตัวตามที่ฝ่ายผลิตขอ (เปลี่ยนชื่อ 8 · เพิ่ม ST-BAND · ปิด ST-MILL/ST-SIEVE)
--
-- ⚠️ ไม่แตะ enum production_station — dashboard.ts/daily.ts roll up ด้วย enum นี้ ไม่ใช่ stations.id
-- ⚠️ ไม่ drop product_recipes / recipe_items — jobs.recipe_id เป็น FK RESTRICT + เก็บประวัติสูตรตาม ALCOA
-- ⚠️ ยังไม่ drop create_product — /board/new ยังเรียกอยู่จนถึงก้อน 2
-- รัน "หลัง" 0001–0039
-- ============================================================

-- ------------------------------------------------------------
-- (1) คอลัมน์ใหม่ของ products
--     type: fg = ยาที่ผลิตขาย · rm = วัตถุดิบ · pm = บรรจุภัณฑ์
--     ใช้ text + check ไม่ใช้ enum — เลี่ยง gotcha "alter type add value ต้อง paste แยกไฟล์" (0038)
-- ------------------------------------------------------------
alter table public.products add column if not exists unit   text not null default 'TAB';
alter table public.products add column if not exists reg_no text;
alter table public.products add column if not exists type   text not null default 'fg';

do $$
begin
  alter table public.products
    add constraint products_type_chk check (type in ('fg', 'rm', 'pm'));
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_products_type on public.products (type);

comment on column public.products.unit   is 'หน่วยนับ — TAB / CAP / LT. / KG. (ย้ายมาจาก materials.unit)';
comment on column public.products.reg_no is 'เลขทะเบียนตำรับยา เช่น 1A 119/59';
comment on column public.products.type   is 'fg = ยาที่ผลิตขาย · rm = วัตถุดิบ · pm = บรรจุภัณฑ์';

-- ------------------------------------------------------------
-- (2) upsert_product — เพิ่ม/แก้ผลิตภัณฑ์
--     สิทธิ์: can_plan_jobs() (ฝ่ายวางแผน/ผู้บริหาร) — เดียวกับ create_product ใน 0039
-- ------------------------------------------------------------
create or replace function public.upsert_product(
  p_id          uuid,
  p_code        text,
  p_name        text,
  p_type        text default 'fg',
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
  if not public.can_plan_jobs() then
    raise exception 'เฉพาะฝ่ายวางแผน/ผู้บริหารจัดการผลิตภัณฑ์ได้';
  end if;

  p_code := btrim(coalesce(p_code, ''));
  p_name := btrim(coalesce(p_name, ''));
  p_type := btrim(coalesce(p_type, 'fg'));
  p_unit := btrim(coalesce(p_unit, ''));

  if p_code = '' then raise exception 'กรุณาระบุรหัสผลิตภัณฑ์ (code)'; end if;
  if p_name = '' then raise exception 'กรุณาระบุชื่อผลิตภัณฑ์'; end if;
  if p_type not in ('fg', 'rm', 'pm') then
    raise exception 'ประเภทผลิตภัณฑ์ไม่ถูกต้อง (ต้องเป็น fg / rm / pm)';
  end if;
  if p_unit = '' then p_unit := 'TAB'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);

  if p_id is null then
    if exists (select 1 from public.products where code = p_code) then
      raise exception 'รหัสผลิตภัณฑ์ % มีอยู่แล้ว', p_code;
    end if;
    perform set_config('app.audit_reason', 'เพิ่มผลิตภัณฑ์ ' || p_code, true);
    insert into public.products (code, name, type, unit, reg_no, dosage_form, created_by)
    values (p_code, p_name, p_type, p_unit,
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
           type        = p_type,
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

grant execute on function public.upsert_product(uuid, text, text, text, text, text, text)
  to authenticated;

-- ------------------------------------------------------------
-- (3) set_product_active — ปิด/เปิดใช้งานผลิตภัณฑ์ (แทนการลบจริง)
--     ⚠️ ลบจริงไม่ได้: orders/batches/fg_inventory ผูกแบบ RESTRICT + เป็นประวัติ GMP
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
  if not public.can_plan_jobs() then
    raise exception 'เฉพาะฝ่ายวางแผน/ผู้บริหารจัดการผลิตภัณฑ์ได้';
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
-- (4) set_station_active — ปิด/เปิดใช้งานสถานี (แทนการลบจริง)
--     ⚠️ ลบจริงไม่ได้: product_routes · job_routes · inprocess_checks · production_records
--        ผูกแบบ RESTRICT ทั้ง 4 จุด (job_routes = snapshot ตาม GMP ห้ามแก้ย้อนหลัง)
-- ------------------------------------------------------------
create or replace function public.set_station_active(
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
  if not public.can_manage_stations() then
    raise exception 'เฉพาะผู้บริหารจัดการสถานีการผลิตได้';
  end if;

  select code into v_code from public.stations where id = p_id;
  if v_code is null then raise exception 'ไม่พบสถานีที่เลือก'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    case when coalesce(p_is_active, true)
         then 'เปิดใช้งานสถานี ' || v_code
         else 'ปิดใช้งานสถานี ' || v_code end, true);

  update public.stations
     set is_active = coalesce(p_is_active, true), updated_by = v_profile
   where id = p_id;

  return p_id;
end;
$$;

grant execute on function public.set_station_active(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- (5) สถานีการผลิตจริง 9 ตัว (ฝ่ายผลิตยืนยัน — เอกสาร feedback B-p07)
--     "บด/ร่อน" ถูกยุบเข้า "ผสมเปียก" → ปิดใช้งาน ไม่ลบ (มี production_records อ้างอยู่)
--     station_group ยังใช้ enum 4 กลุ่มเดิมเป็น rollup ของ dashboard — ห้ามแตะ
-- ------------------------------------------------------------
select set_config('app.audit_reason', 'ปรับสถานีการผลิตตาม Part 2 (ฝ่ายผลิต)', true);

update public.stations set name = 'เตรียมวัตถุดิบ', seq = 10, is_active = true where code = 'ST-WEIGH';
update public.stations set name = 'ผสมเปียก',       seq = 20, is_active = true where code = 'ST-WMIX';
update public.stations set name = 'ผสมแห้ง',        seq = 30, is_active = true where code = 'ST-DMIX';
update public.stations set name = 'ตอกเม็ด',         seq = 40, is_active = true where code = 'ST-TAB';
update public.stations set name = 'เคลือบฟิล์ม',      seq = 50, is_active = true where code = 'ST-FILM';
update public.stations set name = 'เข้าแคปซูล',       seq = 60, is_active = true where code = 'ST-CAP';

insert into public.stations (code, name, station_group, seq, is_active)
values ('ST-BAND', 'คาดแคปซูล', 'tableting', 70, true)
on conflict (code) do nothing;

update public.stations set name = 'เลือกยา', seq = 80, is_active = true where code = 'ST-SORT';
update public.stations set name = 'บรรจุ',   seq = 90, is_active = true where code = 'ST-PACK';

-- ยุบเข้า "ผสมเปียก" ตามที่ฝ่ายผลิตแจ้ง
update public.stations set is_active = false where code in ('ST-MILL', 'ST-SIEVE');

-- ------------------------------------------------------------
-- (6) realtime — หน้า /recipes เปลี่ยนไปฟัง products แทน product_recipes/recipe_items
-- ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.products;
exception
  when duplicate_object then null;
end $$;

-- ============================================================
-- ตรวจหลังรัน (ออปชัน)
--   select code, name, unit, reg_no, type, is_active from public.products order by code;
--   select code, name, station_group, seq, is_active from public.stations order by seq;
--   -- ต้องได้ 9 แถวที่ is_active = true และ ST-MILL/ST-SIEVE = false
-- ============================================================
