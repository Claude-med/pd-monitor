-- ============================================================
-- PD Monitor — Part 2 ก้อน 2 / 0041_job_packaging.sql
-- ย้าย "รูปแบบบรรจุ" จากระดับยา → ระดับงานผลิต + เลิกผูกสูตรกับงาน
--
--   (1) jobs.pack_type + pack_pattern_1/2/3 — ยาตัวเดียวกันแต่ละล็อตบรรจุคนละแบบได้
--       สูงสุด 3 ขนาดต่องาน ตรงกับใบแจ้งผลิต F.PLN.01 ที่มีช่อง "ขนาดบรรจุ (1)(2)(3)"
--   (2) create_job_with_order — เพิ่ม 4 พารามิเตอร์บรรจุ + เลิก auto-select สูตร
--   (3) drop create_product — ย้ายไปใช้ upsert_product (0040) ที่หน้าผลิตภัณฑ์แล้ว
--
-- ⚠️ เพิ่มพารามิเตอร์ = signature ใหม่ → ต้อง drop ตัวเก่าก่อน ไม่งั้นเป็น overload ซ้อน 2 ตัว
-- ⚠️ ไม่แตะคอลัมน์ jobs.recipe_id (FK RESTRICT ไป product_recipes) — แค่เลิกเขียนค่าใหม่
--    งานเก่าที่เคยผูกสูตรไว้ยังอ่านประวัติได้ครบตาม ALCOA
-- ⚠️ คง copy product_routes → job_routes ไว้ — ด่านกั้น in-process QC ก่อนส่ง QC พึ่งอันนี้
--    (ไม่ได้พึ่ง BOM) ถ้าตัดออกด่านนี้จะพัง
-- รัน "หลัง" 0001–0040
-- ============================================================

-- ------------------------------------------------------------
-- (1) คอลัมน์บรรจุของงานผลิต
-- ------------------------------------------------------------
alter table public.jobs add column if not exists pack_type      text;
alter table public.jobs add column if not exists pack_pattern_1 text;
alter table public.jobs add column if not exists pack_pattern_2 text;
alter table public.jobs add column if not exists pack_pattern_3 text;

comment on column public.jobs.pack_type      is 'รูปแบบบรรจุ — Blister / Strip / ซอง / ขวด ฯลฯ';
comment on column public.jobs.pack_pattern_1 is 'ขนาดบรรจุ (1) เช่น 666 x 30 x 10''s';
comment on column public.jobs.pack_pattern_2 is 'ขนาดบรรจุ (2) — ว่างได้';
comment on column public.jobs.pack_pattern_3 is 'ขนาดบรรจุ (3) — ว่างได้';

-- ------------------------------------------------------------
-- (2) create_job_with_order — body ยกจาก 0039:226-334 ทั้งดุ้น
--     เปลี่ยน 2 จุด: + 4 พารามิเตอร์บรรจุ · − บล็อก auto-select สูตร (v_recipe)
-- ------------------------------------------------------------
drop function if exists public.create_job_with_order(
  text, uuid, numeric, text, date, text, date, date, text
);

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
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'ไม่พบผลิตภัณฑ์ที่เลือก';
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
  where pr.product_id = p_product_id;

  return v_job_no;
end;
$$;

grant execute on function public.create_job_with_order(
  text, uuid, numeric, text, date, text, date, date, text, text, text, text, text
) to authenticated;

-- ------------------------------------------------------------
-- (3) create_product — เลิกใช้แล้ว (หน้าสร้างงานผลิตไม่มีปุ่ม "เพิ่มยาใหม่" อีกต่อไป)
--     ใช้ upsert_product() จาก 0040 ที่หน้า "ผลิตภัณฑ์ / ขั้นตอนการผลิต" แทน
-- ------------------------------------------------------------
drop function if exists public.create_product(text, text, text, numeric);

-- ============================================================
-- ตรวจหลังรัน (ออปชัน)
--   select job_no, pack_type, pack_pattern_1, pack_pattern_2, pack_pattern_3
--     from public.jobs order by created_at desc limit 5;
--   -- ต้องมี create_job_with_order เพียง 1 ตัว (13 พารามิเตอร์)
--   select p.oid::regprocedure from pg_proc p
--    where p.proname in ('create_job_with_order','create_product');
-- ============================================================
