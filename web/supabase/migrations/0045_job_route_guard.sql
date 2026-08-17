-- ============================================================
-- PD Monitor — Part 2.1 ก้อน 2 / 0045_job_route_guard.sql
-- อุดช่องโหว่ "งานที่ไม่มีขั้นตอนการผลิต" (job_routes ว่าง)
--
-- อาการเดิม: สร้างงานตอนผลิตภัณฑ์ยังไม่ได้ตั้ง route → job_routes ว่างถาวร
--   (ก) ฟอร์มบันทึกผลผลิต/in-process QC fallback เป็น "เลือกสถานีไหนก็ได้"
--   (ข) ⚠️ ด่าน GMP in_production→qc ไม่บล็อกเลย — inprocess_route_complete()
--       คืน true เมื่อ job_routes ว่าง (0034:137-157 · comment 0032:91 ยอมรับไว้ว่าเป็น backward compat)
--   (ค) ไม่มี RPC/UI ไหน sync route ย้อนหลังได้เลย (job_routes เขียนได้จาก create_job_with_order ที่เดียว)
--
--   (1) product_has_route()   — ผลิตภัณฑ์ตั้งขั้นตอนการผลิตแล้วหรือยัง
--   (2) create_job_with_order — เพิ่มด่านกันต้นทาง (body ยกจาก 0041:39-145 ทั้งดุ้น)
--   (3) sync_job_route()      — ซ่อมงานเก่าที่ route ว่าง (เงื่อนไขเข้ม กันชน snapshot GMP)
--
-- ⚠️ signature ของ create_job_with_order ไม่เปลี่ยน → create or replace ได้ ไม่ต้อง drop
--    แต่ต้องยกบอดี้มาครบทั้งดุ้น (auto job_no + batch + pack_* + copy route)
--    ไม่งั้น regression เงียบแบบรอบ 0039
-- ⚠️ job_routes = snapshot ตาม GMP ห้ามแก้ย้อนหลัง (0040:164-165)
--    sync_job_route จึงเติมได้เฉพาะงานที่ "ว่างจริง" และ "ยังไม่พ้น in_production" เท่านั้น
-- รัน "หลัง" 0001–0044
-- ============================================================

-- ------------------------------------------------------------
-- (1) product_has_route — นับเฉพาะสถานีที่ยังเปิดใช้งาน
--     สถานีที่ถูกปิด/ลบไปแล้วไม่ควรนับว่าผลิตภัณฑ์ "พร้อมผลิต"
-- ------------------------------------------------------------
create or replace function public.product_has_route(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.product_routes pr
      join public.stations s on s.id = pr.station_id
     where pr.product_id = p_product_id
       and s.is_active
  );
$$;

grant execute on function public.product_has_route(uuid) to authenticated;

-- ------------------------------------------------------------
-- (2) create_job_with_order — body ยกจาก 0041:39-145 ทั้งดุ้น
--     เปลี่ยน 2 จุด:
--       + ด่านใหม่ "ผลิตภัณฑ์ต้องมีขั้นตอนการผลิตก่อน"
--       + copy route กรอง s.is_active (ของเดิมลอกสถานีที่ถูกปิดใช้งานมาด้วย
--         ทำให้งานมีขั้นตอนที่บันทึกผลไม่ได้ค้างอยู่ในลิสต์)
-- ------------------------------------------------------------
create or replace function public.create_job_with_order(
  p_customer       text,
  p_product_id     uuid,
  p_quantity       numeric,
  p_unit           text,
  p_due_date       date,
  p_job_no         text,
  p_planned_start  date default null,
  p_planned_end    date default null,
  p_lot_no         text default null,
  p_pack_type      text default null,
  p_pack_pattern_1 text default null,
  p_pack_pattern_2 text default null,
  p_pack_pattern_3 text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_order   uuid;
  v_batch   uuid;
  v_job     uuid;
  v_job_no  text;
  v_code    text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.can_plan_jobs() then
    raise exception 'เฉพาะฝ่ายวางแผน/ผู้บริหารสร้างงานผลิตได้';
  end if;

  -- ---------- validate ----------
  p_customer := btrim(coalesce(p_customer, ''));
  v_job_no   := btrim(coalesce(p_job_no, ''));
  if p_customer = '' then raise exception 'กรุณาระบุลูกค้า'; end if;
  if p_product_id is null then raise exception 'กรุณาเลือกผลิตภัณฑ์'; end if;

  select code into v_code from public.products where id = p_product_id;
  if v_code is null then
    raise exception 'ไม่พบผลิตภัณฑ์ที่เลือก';
  end if;

  -- ⭐ ด่านใหม่ (Part 2.1): ไม่มีขั้นตอนการผลิต = สร้างงานไม่ได้
  --    ถ้าปล่อยผ่าน job_routes จะว่าง แล้วด่าน in-process QC ก่อนส่ง QC จะไม่ทำงาน
  if not public.product_has_route(p_product_id) then
    raise exception
      'ผลิตภัณฑ์ % ยังไม่ได้ตั้งขั้นตอนการผลิต — ไปตั้งที่หน้า "ผลิตภัณฑ์ / ขั้นตอนการผลิต" ก่อนสร้างงาน', v_code;
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'จำนวนต้องมากกว่า 0';
  end if;

  -- ออกเลขงานอัตโนมัติถ้าเว้นว่าง (กันชนด้วย sequence + วน loop เผื่อชนเลขที่ใส่มือไว้)
  if v_job_no = '' then
    loop
      v_job_no := 'JOB-' || to_char(current_date, 'YYYY') || '-'
                  || lpad(nextval('public.job_no_seq')::text, 4, '0');
      exit when not exists (select 1 from public.jobs where job_no = v_job_no);
    end loop;
  else
    if exists (select 1 from public.jobs where job_no = v_job_no) then
      raise exception 'เลขงาน % มีอยู่แล้ว — กรุณาใช้เลขอื่น', v_job_no;
    end if;
  end if;

  if p_planned_start is not null and p_planned_end is not null
     and p_planned_end < p_planned_start then
    raise exception 'วันสิ้นสุดแผนต้องไม่ก่อนวันเริ่ม';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'สร้างงานผลิตใหม่ ' || v_job_no, true);

  -- ---------- order ----------
  insert into public.orders (order_no, customer, product_id, quantity, unit, due_date, created_by)
  values ('ORD-' || v_job_no, p_customer, p_product_id, p_quantity,
          coalesce(nullif(btrim(coalesce(p_unit, '')), ''), 'เม็ด'), p_due_date, v_profile)
  returning id into v_order;

  -- ---------- batch (ถ้าระบุล็อต) ----------
  if p_lot_no is not null and btrim(p_lot_no) <> '' then
    if exists (select 1 from public.batches where lot_no = btrim(p_lot_no)) then
      raise exception 'เลขล็อต % มีอยู่แล้ว', btrim(p_lot_no);
    end if;
    insert into public.batches (lot_no, order_id, product_id, created_by)
    values (btrim(p_lot_no), v_order, p_product_id, v_profile)
    returning id into v_batch;
  end if;

  -- ---------- job (Part 2: ไม่ผูก recipe_id อีกแล้ว — โรงงานไม่ได้ใช้ BOM) ----------
  insert into public.jobs
    (job_no, order_id, batch_id, status, planned_start, planned_end,
     pack_type, pack_pattern_1, pack_pattern_2, pack_pattern_3, created_by)
  values
    (v_job_no, v_order, v_batch, 'pending_announce', p_planned_start, p_planned_end,
     nullif(btrim(coalesce(p_pack_type, '')), ''),
     nullif(btrim(coalesce(p_pack_pattern_1, '')), ''),
     nullif(btrim(coalesce(p_pack_pattern_2, '')), ''),
     nullif(btrim(coalesce(p_pack_pattern_3, '')), ''),
     v_profile)
  returning id into v_job;

  -- ---------- copy route ของผลิตภัณฑ์ → job_routes (snapshot ตาม GMP) ----------
  insert into public.job_routes (job_id, station_id, step_no, station_group, note, created_by)
  select v_job, pr.station_id, pr.step_no, s.station_group, pr.note, v_profile
  from public.product_routes pr
  join public.stations s on s.id = pr.station_id
  where pr.product_id = p_product_id
    and s.is_active;

  return v_job_no;
end;
$$;

grant execute on function public.create_job_with_order(
  text, uuid, numeric, text, date, text, date, date, text, text, text, text, text
) to authenticated;

-- ------------------------------------------------------------
-- (3) sync_job_route — ซ่อมงานเก่าที่ job_routes ว่าง
--     คืนจำนวนสถานีที่ใส่ให้
--
--     เงื่อนไข 2 ชั้น (ห้ามผ่อน — นี่คือสิ่งที่กันไม่ให้ทับ snapshot GMP):
--       (ก) job_routes ของงานนั้นต้อง "ว่างจริง"  → ไม่มีทางเขียนทับของเดิม
--       (ข) สถานะงานต้องเป็น pending_announce / planned / in_production
--           งานที่ส่ง QC ไปแล้วห้ามเปลี่ยนขั้นตอนย้อนหลัง (เอกสารการผลิตออกไปแล้ว)
-- ------------------------------------------------------------
create or replace function public.sync_job_route(p_job_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile    uuid;
  v_job_no     text;
  v_status     job_status;
  v_product_id uuid;
  v_code       text;
  v_count      integer;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_plan_jobs() then
    raise exception 'เฉพาะฝ่ายวางแผน/ผู้บริหารซ่อมขั้นตอนการผลิตของงานได้';
  end if;

  select j.job_no, j.status, o.product_id
    into v_job_no, v_status, v_product_id
    from public.jobs j
    join public.orders o on o.id = j.order_id
   where j.id = p_job_id;

  if v_job_no is null then raise exception 'ไม่พบงานที่เลือก'; end if;

  -- (ก) ห้ามทับของเดิมเด็ดขาด
  if exists (select 1 from public.job_routes where job_id = p_job_id) then
    raise exception 'งาน % มีขั้นตอนการผลิตอยู่แล้ว — แก้ย้อนหลังไม่ได้ตามหลัก GMP', v_job_no;
  end if;

  -- (ข) เลยขั้นผลิตไปแล้วห้ามเติม
  if v_status not in ('pending_announce', 'planned', 'in_production') then
    raise exception 'งาน % เลยขั้นตอนการผลิตไปแล้ว (สถานะ %) — เติมขั้นตอนย้อนหลังไม่ได้', v_job_no, v_status;
  end if;

  select code into v_code from public.products where id = v_product_id;
  if not public.product_has_route(v_product_id) then
    raise exception
      'ผลิตภัณฑ์ % ยังไม่ได้ตั้งขั้นตอนการผลิต — ไปตั้งที่หน้า "ผลิตภัณฑ์ / ขั้นตอนการผลิต" ก่อน',
      coalesce(v_code, '');
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'เติมขั้นตอนการผลิตย้อนหลังให้งาน ' || v_job_no || ' (ตอนสร้างงานผลิตภัณฑ์ยังไม่มี route)', true);

  insert into public.job_routes (job_id, station_id, step_no, station_group, note, created_by)
  select p_job_id, pr.station_id, pr.step_no, s.station_group, pr.note, v_profile
  from public.product_routes pr
  join public.stations s on s.id = pr.station_id
  where pr.product_id = v_product_id
    and s.is_active;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.sync_job_route(uuid) to authenticated;

-- ============================================================
-- ตรวจหลังรัน (ออปชัน)
--   -- งานที่ยังไม่มีขั้นตอนการผลิต (ต้องซ่อมด้วยปุ่มในหน้างาน)
--   select j.job_no, j.status
--     from public.jobs j
--    where not exists (select 1 from public.job_routes jr where jr.job_id = j.id)
--    order by j.created_at desc;
--
--   -- ผลิตภัณฑ์ที่ยังตั้งขั้นตอนการผลิตไม่ครบ (สร้างงานไม่ได้แล้ว)
--   select code, name from public.products p
--    where p.is_active and not public.product_has_route(p.id) order by code;
--
--   -- create_job_with_order ต้องมีตัวเดียว (13 อาร์กิวเมนต์)
--   select oid::regprocedure from pg_proc where proname = 'create_job_with_order';
-- ============================================================
