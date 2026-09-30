-- ============================================================
-- PD Monitor — Part I / 0103_dashboard_ot_labor.sql  (ก้อน 2)
--   แดชบอร์ด: แยกค่าแรง OT · การ์ด "ชั่วโมง OT รวม" · "ดูรายละเอียดการคำนวณ" ราย Job
--
-- ข้อมูล OT มีอยู่แล้วที่ production_records.work_period ('normal' | 'ot' · 0063)
--   แต่ dashboard_production_summary (0081) รวมทุกนาทีเป็นก้อนเดียว → คิดค่าแรง OT เท่าเวลาปกติ
--   นิยาม: OT = work_period = 'ot' · อย่างอื่น (normal / ไม่ระบุ) = เวลาปกติ
--
-- (1) dashboard_production_summary — เพิ่ม 2 คอลัมน์ "ต่อท้าย" (ot_minutes, ot_person_minutes)
--     เปลี่ยน return type → create or replace ไม่ได้ ต้อง drop ก่อน (grant หายตาม → ใส่คืนครบ 3 บรรทัด)
--     บอดี้ยกจาก 0081 ทั้งก้อน เปลี่ยนเฉพาะคอลัมน์ OT ที่เพิ่ม
-- (2) dashboard_labor_by_job — ใหม่ · คน-นาที ปกติ/OT ราย Job ในช่วงวันที่
--     เห็นเฉพาะผู้บริหาร + บัญชีต้นทุน (ตรงกับ canSeeCost ใน role-access.ts)
--
-- 🚨 ลำดับ deploy: paste ไฟล์นี้ "ก่อน" push โค้ด (โค้ดใหม่อ่านคอลัมน์ ot_* + เรียก RPC ใหม่)
--    ถ้าโค้ดขึ้นก่อน แดชบอร์ดจะขึ้นแถบเตือน "โหลดตัวเลขไม่สำเร็จ" จน paste
-- รัน "หลัง" 0102 · รันซ้ำได้
-- ============================================================


-- ------------------------------------------------------------
-- (1) dashboard_production_summary + OT
-- ------------------------------------------------------------
drop function if exists public.dashboard_production_summary(date, date);

create function public.dashboard_production_summary(
  p_from date,
  p_to   date
)
returns table (
  station_id        uuid,
  station_name      text,
  seq               integer,
  is_active         boolean,
  minutes           numeric,
  person_minutes    numeric,
  input_qty         numeric,
  output_qty        numeric,
  loss_qty          numeric,
  record_count      bigint,
  ot_minutes        numeric,  -- 0103: ส่วนที่เป็น OT ของ minutes
  ot_person_minutes numeric   -- 0103: ส่วนที่เป็น OT ของ person_minutes
)
language sql
stable
set search_path = public
as $fn$
  -- ⚠️ ตั้งชื่อคอลัมน์ในซับคิวรีให้ "ไม่ซ้ำ" กับชื่อคอลัมน์ใน returns table โดยตั้งใจ (ดู 0081)
  select t.sid, t.sname, t.sseq, t.sactive,
         t.smin, t.spmin,
         t.sinput, t.soutput, t.sloss, t.scount,
         t.sotmin, t.sotpmin
  from (
    select
      s.id                                     as sid,
      s.name                                   as sname,
      s.seq                                    as sseq,
      s.is_active                              as sactive,
      coalesce(sum(pr.minutes), 0)::numeric    as smin,
      coalesce(sum(pr.minutes * coalesce(pr.headcount, 1)), 0)::numeric as spmin,
      coalesce(sum(pr.input_qty), 0)::numeric  as sinput,
      coalesce(sum(pr.output_qty), 0)::numeric as soutput,
      coalesce(sum(pr.loss_qty), 0)::numeric   as sloss,
      count(pr.id)                             as scount,
      coalesce(sum(pr.minutes) filter (where pr.work_period = 'ot'), 0)::numeric as sotmin,
      coalesce(sum(pr.minutes * coalesce(pr.headcount, 1))
                 filter (where pr.work_period = 'ot'), 0)::numeric           as sotpmin
    from public.stations s
    left join public.production_records pr
      on  pr.station_id  = s.id
      and pr.record_date >= p_from
      and pr.record_date <= p_to
      and pr.status <> 'rejected'
    group by s.id, s.name, s.seq, s.is_active

    union all

    -- บันทึกที่ไม่ได้ผูกสถานี — โผล่ต่อท้ายเฉพาะเมื่อมีจริง
    select
      null::uuid,
      '(ไม่ระบุสถานี)'::text,
      2147483647,
      true,
      coalesce(sum(pr.minutes), 0)::numeric,
      coalesce(sum(pr.minutes * coalesce(pr.headcount, 1)), 0)::numeric,
      coalesce(sum(pr.input_qty), 0)::numeric,
      coalesce(sum(pr.output_qty), 0)::numeric,
      coalesce(sum(pr.loss_qty), 0)::numeric,
      count(pr.id),
      coalesce(sum(pr.minutes) filter (where pr.work_period = 'ot'), 0)::numeric,
      coalesce(sum(pr.minutes * coalesce(pr.headcount, 1))
                 filter (where pr.work_period = 'ot'), 0)::numeric
    from public.production_records pr
    where pr.station_id is null
      and pr.record_date >= p_from
      and pr.record_date <= p_to
      and pr.status <> 'rejected'
    having count(pr.id) > 0
  ) t
  order by t.sseq, t.sname;
$fn$;

revoke execute on function public.dashboard_production_summary(date, date) from public;
revoke execute on function public.dashboard_production_summary(date, date) from anon;
grant  execute on function public.dashboard_production_summary(date, date) to authenticated;

comment on function public.dashboard_production_summary(date, date) is
  'รวมยอดผลผลิต/คน-นาที (แยกส่วน OT) รายสถานีในช่วงวันที่ (ไม่นับบันทึกที่ถูกตีกลับ) — ไม่ชนเพดาน max-rows';


-- ------------------------------------------------------------
-- (2) dashboard_labor_by_job — รายละเอียดการคำนวณค่าแรง ราย Job
--     ผลรวมทุกแถว = ยอดรวมของ (1) เสมอ (เงื่อนไขกรองชุดเดียวกัน · บันทึกทุกแถวมี job_id)
--     security invoker (ค่าเริ่มต้น) — RLS ของ production_records/jobs ใช้ตามปกติ
-- ------------------------------------------------------------
create or replace function public.dashboard_labor_by_job(
  p_from date,
  p_to   date
)
returns table (
  job_id                uuid,
  job_no                text,
  product_name          text,
  record_count          bigint,
  normal_person_minutes numeric,
  ot_person_minutes     numeric,
  ot_minutes            numeric
)
language plpgsql
stable
set search_path = public
as $fn$
begin
  if not (public.has_role('manager') or public.has_role('cost')) then
    raise exception 'เฉพาะผู้บริหาร/บัญชีต้นทุนดูรายละเอียดค่าแรงได้';
  end if;

  return query
  select
    j.id,
    j.job_no::text,
    p.name::text,
    count(pr.id),
    coalesce(sum(pr.minutes * coalesce(pr.headcount, 1))
               filter (where pr.work_period is distinct from 'ot'), 0)::numeric,
    coalesce(sum(pr.minutes * coalesce(pr.headcount, 1))
               filter (where pr.work_period = 'ot'), 0)::numeric,
    coalesce(sum(pr.minutes) filter (where pr.work_period = 'ot'), 0)::numeric
  from public.production_records pr
  join public.jobs j          on j.id = pr.job_id
  left join public.orders o   on o.id = j.order_id
  left join public.products p on p.id = o.product_id
  where pr.record_date >= p_from
    and pr.record_date <= p_to
    and pr.status <> 'rejected'
  group by j.id, j.job_no, p.name
  order by j.job_no;
end;
$fn$;

revoke execute on function public.dashboard_labor_by_job(date, date) from public;
revoke execute on function public.dashboard_labor_by_job(date, date) from anon;
grant  execute on function public.dashboard_labor_by_job(date, date) to authenticated;

comment on function public.dashboard_labor_by_job(date, date) is
  'คน-นาที ปกติ/OT ราย Job ในช่วงวันที่ (ไม่นับบันทึกที่ถูกตีกลับ) — ผู้บริหาร/บัญชีต้นทุนเท่านั้น';


-- ============================================================
-- ✅ ตรวจหลัง paste (รันทีละข้อ · เปลี่ยนช่วงวันที่ให้ตรงกับที่มีข้อมูล)
--
-- ข้อ 1 · summary มีคอลัมน์ OT แล้ว
--   select station_name, minutes, ot_minutes, person_minutes, ot_person_minutes
--     from public.dashboard_production_summary('2026-09-01', '2026-09-30');
--   ✅ ได้ทุกสถานี · ot_minutes ≤ minutes ทุกแถว
--   ❌ error "column ot_minutes does not exist" = ไฟล์นี้ยังไม่ได้รัน
--
-- ข้อ 2 · ยอด OT ตรงกับข้อมูลดิบ
--   select (select sum(ot_person_minutes) from public.dashboard_production_summary('2026-09-01','2026-09-30')) as จากสรุป,
--          (select coalesce(sum(minutes * coalesce(headcount,1)),0) from public.production_records
--            where record_date between '2026-09-01' and '2026-09-30'
--              and status <> 'rejected' and work_period = 'ot')                                        as จากตารางจริง;
--   ✅ 2 ค่าเท่ากัน
--
-- ข้อ 3 · ราย Job รวมแล้วเท่ากับยอดรวม (ใช้บัญชีผู้บริหารใน SQL Editor ไม่ได้ → เทียบผ่านหน้าเว็บ)
--   บนแดชบอร์ด กด "ดูรายละเอียดการคำนวณ" → แถว "รวม" ท้ายตาราง ✅ ต้องเท่ากับการ์ด "ต้นทุนค่าแรงรวม"
--
-- ข้อ 4 · สิทธิ์
--   select has_function_privilege('anon', 'public.dashboard_labor_by_job(date,date)', 'execute');
--   ✅ false
-- ============================================================
