-- ============================================================
-- PD Monitor — Part 3 ก้อน 2 / 0048_job_no_be_bulk.sql
-- JOB NO. เลข 6 หลักแบบโรงงาน + สร้างงานทีเดียวหลายใบ + 3 ช่องใหม่
--
--   (1) jobs.request_no / cpo_date / sub_status — "ใบคำขอ" · "C.P.O DATE" · "Status"
--   (2) job_no_counters + next_job_nos() — ออกเลข 690001 (ปี พ.ศ. 2 หลัก + running 4 หลัก)
--   (3) drop create_job_with_order (13 args) → create_production_jobs() สร้างได้ทีละหลายใบ
--
-- ⚠️ ต้อง drop function เก่าก่อน — ไม่งั้นเป็น overload ซ้อน PostgREST ตอบ PGRST203
--    (gotcha เดิมจาก 0039/0041/0044)
-- ⚠️ รัน scripts/cleanup_test_jobs_delete.sql "ก่อน" ไฟล์นี้ — งานเลขรูปแบบเก่าปนอยู่
--    จะทำให้การเรียงบนบอร์ดแยกเป็น 2 กลุ่ม (ตัวเลขมาก่อนตัวอักษร)
-- ℹ️ jobs.planned_start/planned_end และ batches.lot_no ยังอยู่ในฐานข้อมูลเหมือนเดิม
--    แค่ไม่มีให้กรอกในหน้าสร้างงานแล้ว (lot_no ย้ายไปให้ฝ่ายผลิตกรอกในก้อน 3)
-- รัน "หลัง" 0001–0047
-- ============================================================

-- ------------------------------------------------------------
-- (1) 3 คอลัมน์ใหม่ของ jobs
-- ------------------------------------------------------------
alter table public.jobs add column if not exists request_no text;
alter table public.jobs add column if not exists cpo_date   date;
alter table public.jobs add column if not exists sub_status text;

create index if not exists idx_jobs_request_no on public.jobs(request_no);

comment on column public.jobs.request_no is
  'ใบคำขอ — เลขที่ใบสั่งผลิตจากลูกค้า (ผู้ใช้กรอกเอง) ⚠️ คนละตัวกับ orders.order_no ที่ระบบ gen เป็น ORD-<job_no> · ใบที่สร้างพร้อมกันจะใช้เลขนี้ร่วมกัน = ตัวจับกลุ่ม';
comment on column public.jobs.cpo_date is
  'C.P.O DATE — วันที่ลูกค้าสั่งผลิต';
comment on column public.jobs.sub_status is
  'Status (ข้อความอิสระ) — ⚠️ ห้ามใช้ตัดสินด่าน GMP ใดๆ · flow จริงคุมด้วย enum jobs.status เท่านั้น · เป็นก้าวแรกของ "สถานะย่อย ~20 ขั้น" ที่จะทำรอบหน้า';

-- ------------------------------------------------------------
-- (2) ตัวออกเลขงาน — 690001 = ปี พ.ศ. 2 หลัก + running 4 หลัก (reset ทุกปี)
--
--     ใช้ตาราง counter ไม่ใช่ sequence เพราะ
--       · sequence reset รายปีไม่ได้
--       · nextval กินเลขทิ้งเมื่อ rollback → เลขงานขาดช่วง (ไม่ผ่าน GMP)
--       · counter + "insert on conflict do update returning" เป็น atomic คำสั่งเดียว
--         ล็อกเฉพาะแถวของปีนั้นจน commit → สร้างพร้อมกันก็ไม่ชนเลข และจองทีเดียวหลายใบได้
-- ------------------------------------------------------------
create table if not exists public.job_no_counters (
  year_be    smallint primary key,        -- ปี พ.ศ. 2 หลักท้าย (2569 → 69)
  last_seq   integer  not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.job_no_counters is
  'ตัวนับเลขงานต่อปี พ.ศ. — next_job_nos() จองเลขจากที่นี่ · เต็มที่ 9999 ใบ/ปี';

alter table public.job_no_counters enable row level security;

drop policy if exists read_job_no_counters on public.job_no_counters;
create policy read_job_no_counters on public.job_no_counters
  for select to authenticated using (true);

-- seed จากเลขงาน 6 หลักที่มีอยู่จริง (ถ้าล้างงานเก่าแล้วจะได้ 0 แถว = เริ่ม 690001)
insert into public.job_no_counters (year_be, last_seq)
select left(job_no, 2)::smallint, max(right(job_no, 4)::int)
  from public.jobs
 where job_no ~ '^[0-9]{6}$'
 group by 1
on conflict (year_be) do update
  set last_seq = greatest(public.job_no_counters.last_seq, excluded.last_seq);

create or replace function public.next_job_nos(p_count integer default 1)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year  smallint;
  v_last  integer;
  v_seq   integer;
  v_no    text;
  v_out   text[] := '{}';
  v_guard integer := 0;
begin
  if p_count is null or p_count < 1 then
    raise exception 'จำนวนใบที่จะสร้างต้องอย่างน้อย 1 ใบ';
  end if;

  -- ⚠️ ต้องแปลงเป็นเวลาไทยก่อน — session ของ Supabase เป็น UTC
  --    ถ้าใช้ current_date ดิบ ช่วงเที่ยงคืน–07:00 ของวันปีใหม่จะออกเลขปีเก่า
  v_year := ((extract(year from (now() at time zone 'Asia/Bangkok'))::int + 543) % 100)::smallint;

  -- จองเลขทั้งช่วงในคำสั่งเดียว (atomic) แล้วไล่ย้อนขึ้นไป p_count ตัว
  insert into public.job_no_counters (year_be, last_seq, updated_at)
  values (v_year, p_count, now())
  on conflict (year_be) do update
    set last_seq   = public.job_no_counters.last_seq + p_count,
        updated_at = now()
  returning last_seq into v_last;

  if v_last > 9999 then
    raise exception 'เลขงานของปี % เต็มแล้ว (9999 ใบ) — ติดต่อผู้ดูแลระบบ', v_year;
  end if;

  for v_seq in (v_last - p_count + 1) .. v_last loop
    v_no := lpad(v_year::text, 2, '0') || lpad(v_seq::text, 4, '0');

    -- กันชนกับเลขที่เคย import มือไว้ล่วงหน้า: จองเพิ่มทีละใบจนกว่าจะได้เลขว่าง
    while exists (select 1 from public.jobs where job_no = v_no) loop
      v_guard := v_guard + 1;
      if v_guard > 1000 then
        raise exception 'ออกเลขงานไม่สำเร็จ — มีเลขซ้ำในระบบมากผิดปกติ';
      end if;
      update public.job_no_counters
         set last_seq = last_seq + 1, updated_at = now()
       where year_be = v_year
      returning last_seq into v_last;
      if v_last > 9999 then
        raise exception 'เลขงานของปี % เต็มแล้ว (9999 ใบ)', v_year;
      end if;
      v_no := lpad(v_year::text, 2, '0') || lpad(v_last::text, 4, '0');
    end loop;

    v_out := v_out || v_no;
  end loop;

  return v_out;
end;
$$;

grant execute on function public.next_job_nos(integer) to authenticated;

comment on function public.next_job_nos(integer) is
  'จองเลขงานใหม่ p_count ใบ คืนเป็น array — atomic กันชนตอนสร้างพร้อมกัน';

-- ------------------------------------------------------------
-- (3) สร้างงานผลิต — รองรับทีละหลายใบ
--     ⚠️ drop ตัวเก่าก่อน (signature + return type เปลี่ยนทั้งคู่)
-- ------------------------------------------------------------
drop function if exists public.create_job_with_order(
  text, uuid, numeric, text, date, text, date, date, text, text, text, text, text
);

create or replace function public.create_production_jobs(
  p_customer_id    uuid,
  p_product_id     uuid,
  p_quantity       numeric,          -- Batch size ต่อ 1 ใบ (ทุกใบเท่ากัน)
  p_unit           text,
  p_due_date       date,
  p_request_no     text    default null,
  p_cpo_date       date    default null,
  p_sub_status     text    default null,
  p_pack_type      text    default null,
  p_pack_pattern_1 text    default null,
  p_pack_pattern_2 text    default null,
  p_pack_pattern_3 text    default null,
  p_count          integer default 1
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile  uuid;
  v_customer text;
  v_code     text;
  v_unit     text;
  v_request  text;
  v_sub      text;
  v_nos      text[];
  v_job_no   text;
  v_order    uuid;
  v_job      uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.can_plan_jobs() then
    raise exception 'เฉพาะฝ่ายวางแผน/ผู้บริหารสร้างงานผลิตได้';
  end if;

  -- ---------- validate ----------
  if p_customer_id is null then raise exception 'กรุณาเลือกลูกค้า'; end if;
  select name into v_customer from public.customers where id = p_customer_id;
  if v_customer is null then raise exception 'ไม่พบลูกค้าที่เลือก'; end if;

  if p_product_id is null then raise exception 'กรุณาเลือกผลิตภัณฑ์'; end if;
  select code into v_code from public.products where id = p_product_id;
  if v_code is null then raise exception 'ไม่พบผลิตภัณฑ์ที่เลือก'; end if;

  -- ด่าน GMP (0045) — ห้ามถอด: ไม่มีขั้นตอนการผลิต = บันทึกผลผลิต/ตรวจ in-process ไม่ได้
  if not public.product_has_route(p_product_id) then
    raise exception
      'ผลิตภัณฑ์ % ยังไม่ได้ตั้งขั้นตอนการผลิต — ไปตั้งที่หน้า "ผลิตภัณฑ์ / ขั้นตอนการผลิต" ก่อนสร้างงาน', v_code;
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Batch size ต้องมากกว่า 0';
  end if;

  if p_count is null or p_count < 1 then
    raise exception 'จำนวนใบที่จะสร้างต้องอย่างน้อย 1 ใบ';
  end if;
  if p_count > 50 then
    raise exception 'สร้างได้สูงสุด 50 ใบต่อครั้ง (ขอมา % ใบ)', p_count;
  end if;

  v_unit    := coalesce(nullif(btrim(coalesce(p_unit, '')), ''), 'เม็ด');
  v_request := nullif(btrim(coalesce(p_request_no, '')), '');
  v_sub     := nullif(btrim(coalesce(p_sub_status, '')), '');

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'สร้างงานผลิต ' || p_count || ' ใบ · ' || v_code || ' · ลูกค้า ' || v_customer
    || coalesce(' · ใบคำขอ ' || v_request, ''), true);

  -- ---------- จองเลขงานทั้งชุด ----------
  v_nos := public.next_job_nos(p_count);

  foreach v_job_no in array v_nos loop
    -- ใบสั่งผลิต (1 ใบต่อ 1 งาน — ทั่วทั้งแอปอ่าน orders.quantity เป็นจำนวนของงานใบนั้น)
    insert into public.orders
      (order_no, customer, customer_id, product_id, quantity, unit, due_date, created_by)
    values
      ('ORD-' || v_job_no, v_customer, p_customer_id, p_product_id,
       p_quantity, v_unit, p_due_date, v_profile)
    returning id into v_order;

    -- งานผลิต — ยังไม่ผูก batch (LOT No. ให้ฝ่ายผลิตกรอกทีหลัง)
    insert into public.jobs
      (job_no, order_id, batch_id, status,
       request_no, cpo_date, sub_status,
       pack_type, pack_pattern_1, pack_pattern_2, pack_pattern_3, created_by)
    values
      (v_job_no, v_order, null, 'pending_announce',
       v_request, p_cpo_date, v_sub,
       nullif(btrim(coalesce(p_pack_type, '')), ''),
       nullif(btrim(coalesce(p_pack_pattern_1, '')), ''),
       nullif(btrim(coalesce(p_pack_pattern_2, '')), ''),
       nullif(btrim(coalesce(p_pack_pattern_3, '')), ''),
       v_profile)
    returning id into v_job;

    -- snapshot ขั้นตอนการผลิตตาม GMP — กรองสถานีที่ปิดใช้งานออก (0045)
    insert into public.job_routes (job_id, station_id, step_no, station_group, note, created_by)
    select v_job, pr.station_id, pr.step_no, s.station_group, pr.note, v_profile
      from public.product_routes pr
      join public.stations s on s.id = pr.station_id
     where pr.product_id = p_product_id
       and s.is_active;
  end loop;

  return v_nos;
end;
$$;

grant execute on function public.create_production_jobs(
  uuid, uuid, numeric, text, date, text, date, text, text, text, text, text, integer
) to authenticated;

comment on function public.create_production_jobs(
  uuid, uuid, numeric, text, date, text, date, text, text, text, text, text, integer
) is
  'สร้างงานผลิตทีละ 1–50 ใบจากข้อมูลชุดเดียว (ฝ่ายวางแผน/ผู้บริหาร) — เลขงานออกเองเป็น 6 หลัก คืน array ของ job_no';

-- ============================================================
-- ตรวจหลังรัน (ออปชัน)
--   -- ต้องเหลือ create_production_jobs ตัวเดียว ไม่มี create_job_with_order ค้าง
--   select oid::regprocedure from pg_proc where proname like 'create_%job%';
--   -- ทดลองจองเลข (จะกินเลขจริง 3 ตัว — ทำตอนยังไม่เริ่มใช้จริงเท่านั้น)
--   select public.next_job_nos(3);
--   select * from public.job_no_counters;
-- ============================================================
