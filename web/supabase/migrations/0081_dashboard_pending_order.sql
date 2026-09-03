-- ============================================================
-- PD Monitor — แดชบอร์ด Pending Order / 0081_dashboard_pending_order.sql
-- จัดกลุ่มแดชบอร์ดใหม่เป็น  Plan + WIP = Pending Order  (คำสั่งผู้บริหาร · A-p03)
--   (1) stations.is_packing — ธง "สถานีบรรจุ" (ใช้ derive ช่อง "แพ็ค" บนแดชบอร์ด)
--   (2) upsert_station      — รับ p_is_packing เพิ่ม (drop+create เพราะเปลี่ยน argument list)
--   (3) dashboard_job_counts()          — นับงาน 9 ช่อง + ติดปัญหา + รวม ในแถวเดียว
--   (4) dashboard_production_summary()  — รวมยอดผลผลิต/ค่าแรงรายสถานี ในช่วงวันที่
-- รัน "หลัง" 0080
--
-- 🎯 ที่มา: ผู้บริหารเขียนกำกับบนคู่มือหน้าแดชบอร์ดว่า "Plan + WIP = Pending Order"
--    และตีวงเล็บ WIP = ผลิต | แพ็ค | QC | QA | เข้าคลัง
--    ตรงกับ docs/feedback-raw-2026-08.md:131 (A-p03) และผังรายงาน F.PLN.10 (:112)
--
-- 🧩 ทำไม "แพ็ค" ไม่เป็นค่า enum ใหม่ใน job_status:
--    เพิ่มค่า enum = ต้องแก้ advance_job_status() + TRANSITIONS + stepper + create_notification()
--    + guard อีก 6 ตัวที่อ่าน jobs.status  และต้องมีคน "กดปุ่มส่งแพ็ค" เพิ่มอีกขั้นทุกใบ
--    ⇒ ใช้วิธีที่ feedback-raw-2026-08.md:143-145 เสนอไว้เอง: เก็บ enum 6 ค่าไว้เป็น "เฟส"
--      แล้ว derive ขั้นละเอียดจาก route + บันทึกผลผลิตล่าสุด → ไม่พังของเดิมสักจุด
--
-- 🧩 ทำไมต้องย้ายการนับมาไว้ที่ DB:
--    ของเดิม (lib/data/dashboard.ts) ดึง "ทุกแถว" ของ jobs + production_records
--    มานับใน JavaScript โดยไม่มี limit → พอข้อมูลเกินเพดาน max-rows ของ PostgREST (1,000)
--    ตัวเลขจะขาดหายเงียบ ๆ ไม่มี error ให้เห็น · นับที่ DB แล้วส่งมาแค่แถวสรุปจึงไม่มีเพดาน
--
-- ℹ️ ทั้ง 2 ฟังก์ชันเป็น security INVOKER (ไม่ใช่ definer) โดยตั้งใจ —
--    เป็นการ "อ่าน" ล้วน ๆ ตารางที่ทุกคนที่ล็อกอินอ่านได้อยู่แล้ว (policy read_authenticated)
--    ไม่ต้องยกสิทธิ์ให้ใคร · RLS ยังทำงานตามปกติ
--
-- ⚠️ ตัวเลขบนแดชบอร์ดจะ "เปลี่ยนจากที่ทีมเคยเห็น" หลังรันไฟล์นี้ (ตั้งใจ ไม่ใช่ bug):
--    · การ์ด "เสร็จ (FG)" แตกเป็น "รอเข้าคลัง" (ยังนับใน Pending) + "เข้าคลังแล้ว" (จบ)
--      — เดิมนับรวมกัน ทำให้ไม่ตรงกับ KPI "เข้าคลังแล้ว (FG)" บนบอร์ดงาน
--    · yield / ต้นทุนค่าแรง ตัดบันทึกผลผลิตที่ถูกตีกลับ (status='rejected' · 0080) ออก
--    · "ติดปัญหา N งาน" ไม่นับงานที่เข้าคลังไปแล้ว
-- ============================================================

-- ------------------------------------------------------------
-- (1) ธง "สถานีบรรจุ"
--     ST-PACK = ขั้นแพ็คจริงก่อนส่ง QC · ST-CAP (บรรจุแคปซูล) ตั้งใจไม่ติดธง
--     เพราะเป็นขั้นตอกเม็ด/อัดแคปซูล ไม่ใช่การแพ็คลงบรรจุภัณฑ์
--     ผู้บริหารติ๊กเพิ่ม/ถอดเองได้ที่หน้า "สูตรการผลิต → สถานี"
-- ------------------------------------------------------------
alter table public.stations
  add column if not exists is_packing boolean not null default false;

comment on column public.stations.is_packing is
  'สถานีนี้คือขั้น "แพ็ค" — งานที่บันทึกผลผลิตล่าสุดอยู่สถานีนี้จะไปอยู่ช่อง "แพ็ค" บนแดชบอร์ด';

update public.stations set is_packing = true where code = 'ST-PACK';

-- index ช่วย distinct on (job_id) order by record_date desc ใน (3)
create index if not exists idx_prod_job_date_desc
  on public.production_records (job_id, record_date desc, created_at desc);

-- ------------------------------------------------------------
-- (2) upsert_station — เพิ่มพารามิเตอร์ p_is_packing
--     create or replace เปลี่ยน argument list ไม่ได้ → ต้อง drop ตัวเดิมก่อน
--     บอดี้ยกมาทั้งดุ้นจาก 0059:79-135 แก้เฉพาะส่วน is_packing (ธรรมเนียมเดิมของโปรเจค)
-- ------------------------------------------------------------
drop function if exists public.upsert_station(uuid, text, text, integer, boolean);

create or replace function public.upsert_station(
  p_id         uuid,
  p_code       text,
  p_name       text,
  p_seq        integer default 100,
  p_is_active  boolean default true,
  p_is_packing boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_id      uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_stations() then
    raise exception 'เฉพาะผู้บริหารจัดการสถานีการผลิตได้';
  end if;

  p_code := btrim(coalesce(p_code, ''));
  p_name := btrim(coalesce(p_name, ''));
  if p_code = '' then raise exception 'กรุณาระบุรหัสสถานี (code)'; end if;
  if p_name = '' then raise exception 'กรุณาระบุชื่อสถานี'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);

  if p_id is null then
    if exists (select 1 from public.stations where code = p_code) then
      raise exception 'รหัสสถานี % มีอยู่แล้ว', p_code;
    end if;
    perform set_config('app.audit_reason', 'เพิ่มสถานี ' || p_code, true);
    insert into public.stations (code, name, seq, is_active, is_packing, created_by)
    values (p_code, p_name, coalesce(p_seq, 100),
            coalesce(p_is_active, true), coalesce(p_is_packing, false), v_profile)
    returning id into v_id;
  else
    if not exists (select 1 from public.stations where id = p_id) then
      raise exception 'ไม่พบสถานีที่เลือก';
    end if;
    if exists (select 1 from public.stations where code = p_code and id <> p_id) then
      raise exception 'รหัสสถานี % ถูกใช้กับสถานีอื่นแล้ว', p_code;
    end if;
    perform set_config('app.audit_reason', 'แก้สถานี ' || p_code, true);
    update public.stations
       set code = p_code, name = p_name,
           seq = coalesce(p_seq, seq), is_active = coalesce(p_is_active, is_active),
           is_packing = coalesce(p_is_packing, is_packing),
           updated_by = v_profile
     where id = p_id
    returning id into v_id;
  end if;

  return v_id;
end;
$fn$;

revoke execute on function public.upsert_station(uuid, text, text, integer, boolean, boolean) from public;
revoke execute on function public.upsert_station(uuid, text, text, integer, boolean, boolean) from anon;
grant  execute on function public.upsert_station(uuid, text, text, integer, boolean, boolean) to authenticated;

comment on function public.upsert_station(uuid, text, text, integer, boolean, boolean) is
  'เพิ่ม/แก้สถานีการผลิต (ผู้บริหาร) — 0081 เพิ่มธง "สถานีบรรจุ" (is_packing)';

-- ------------------------------------------------------------
-- (3) dashboard_job_counts — นับงานทุกช่องของแดชบอร์ดในแถวเดียว
--
--   Pending Order = Plan + WIP
--   ├─ Plan : unplan · pending_announce · planned
--   └─ WIP  : producing · packing · qc · qa · awaiting_fg
--   นอก Pending : in_stock (เข้าคลังแล้ว = จบจริง)
--
--   🚨 ทุกช่องแยกกันเด็ดขาด ไม่มีงานถูกนับซ้ำ ⇒ ผลรวม 9 ช่อง = total เสมอ
--      (คำสั่งตรวจข้อนี้อยู่ท้ายไฟล์ — ใช้เป็น regression test ได้)
--
--   "เข้าคลังแล้ว" ยึดนิยามเดียวกับ KPI บอร์ดงาน (board-view.tsx:114) =
--   status='finished_goods' และมีแถวใน fg_inventory
--   (สถานะ finished_goods เฉย ๆ แปลว่า QA ปล่อยผ่านแล้ว แต่คลังอาจยังไม่รับเข้า)
--
--   "ยังไม่ลงแผน (unplan)" ดูทั้ง plan_month และ sub_status — ไม่ใช่ plan_month อย่างเดียว
--   เพราะข้อมูลจริงมีทั้ง 2 แบบ: บางใบตั้ง plan_month ผ่านสถานะระบบ "มีแผน"
--   บางใบพิมพ์ข้อความเอง เช่น "แผน 08/69" โดยไม่ได้ตั้ง plan_month (เช่น job 690001)
--   ถ้าดู plan_month อย่างเดียวจะไปตีว่าใบหลังนี้ "ยังไม่ลงแผน" ทั้งที่ฝ่ายวางแผนลงไว้แล้ว
-- ------------------------------------------------------------
create or replace function public.dashboard_job_counts()
returns table (
  unplan           bigint,  -- รอแจ้งผลิต + ยังไม่ระบุเดือนแผน
  pending_announce bigint,  -- รอแจ้งผลิต + ลงเดือนแผนแล้ว
  planned          bigint,
  producing        bigint,
  packing          bigint,
  qc               bigint,
  qa               bigint,
  awaiting_fg      bigint,  -- QA ปล่อยผ่านแล้ว แต่คลังยังไม่รับเข้า
  in_stock         bigint,  -- เข้าคลังแล้ว = จบจริง
  problem          bigint,  -- ติดปัญหา (ไม่นับงานที่เข้าคลังไปแล้ว)
  total            bigint
)
language sql
stable
set search_path = public
as $fn$
  with latest as (
    -- สถานีของบันทึกผลผลิตล่าสุดของแต่ละงาน
    -- ไม่นับบันทึกที่ถูกตีกลับ (0080) — ตัวเลขที่ไม่ผ่านไม่ควรบอกว่างานอยู่สถานีไหน
    select distinct on (pr.job_id) pr.job_id, pr.station_id
      from public.production_records pr
     where pr.status <> 'rejected'
     order by pr.job_id, pr.record_date desc, pr.created_at desc
  )
  select
    count(*) filter (where j.status = 'pending_announce'
                       and j.plan_month is null
                       and coalesce(btrim(j.sub_status), '') in ('', 'ไม่มีแผน')),
    count(*) filter (where j.status = 'pending_announce'
                       and not (j.plan_month is null
                                and coalesce(btrim(j.sub_status), '') in ('', 'ไม่มีแผน'))),
    count(*) filter (where j.status = 'planned'),
    count(*) filter (where j.status = 'in_production' and not coalesce(s.is_packing, false)),
    count(*) filter (where j.status = 'in_production' and coalesce(s.is_packing, false)),
    count(*) filter (where j.status = 'qc'),
    count(*) filter (where j.status = 'qa'),
    count(*) filter (where j.status = 'finished_goods' and fg.job_id is null),
    count(*) filter (where j.status = 'finished_goods' and fg.job_id is not null),
    count(*) filter (where j.problem is not null
                       and not (j.status = 'finished_goods' and fg.job_id is not null)),
    count(*)
  from public.jobs j
  left join latest              l  on l.job_id  = j.id
  left join public.stations     s  on s.id      = l.station_id
  left join public.fg_inventory fg on fg.job_id = j.id;
$fn$;

revoke execute on function public.dashboard_job_counts() from public;
revoke execute on function public.dashboard_job_counts() from anon;
grant  execute on function public.dashboard_job_counts() to authenticated;

comment on function public.dashboard_job_counts() is
  'นับงานทุกช่องของแดชบอร์ด (Plan / WIP / เข้าคลังแล้ว) ในแถวเดียว — ไม่ชนเพดาน max-rows';

-- ------------------------------------------------------------
-- (4) dashboard_production_summary — รวมยอดผลผลิตรายสถานีในช่วงวันที่
--
--   คืน "ทุกสถานี" แม้ช่วงนั้นไม่มีบันทึก (ได้แถว 0) — พฤติกรรมเดิมของ dashboard.ts:68-81
--   + แถวพิเศษ station_id = null "(ไม่ระบุสถานี)" สำหรับบันทึกที่ไม่ได้ผูกสถานี
--     เฉพาะเมื่อมีจริงเท่านั้น ⇒ ผลรวมของทุกแถว = ยอดรวมจริงเสมอ
--     (ของเดิมยอดรวมนับทุกบันทึก แต่ตารางรายสถานีทิ้งบันทึกที่ station_id เป็น null → ไม่ตรงกัน)
--
--   เก็บ "นาที" ตามที่ DB เก็บจริง (0063 เปลี่ยน hours → minutes) — ฝั่งแอปหาร 60 เอง
--   person_minutes = minutes × จำนวนคน (ไม่ระบุ = 1 คน) — สูตรเดิมที่ dashboard.ts:91
-- ------------------------------------------------------------
create or replace function public.dashboard_production_summary(
  p_from date,
  p_to   date
)
returns table (
  station_id     uuid,
  station_name   text,
  seq            integer,
  is_active      boolean,
  minutes        numeric,
  person_minutes numeric,
  input_qty      numeric,
  output_qty     numeric,
  loss_qty       numeric,
  record_count   bigint
)
language sql
stable
set search_path = public
as $fn$
  -- ⚠️ ตั้งชื่อคอลัมน์ในซับคิวรีให้ "ไม่ซ้ำ" กับชื่อคอลัมน์ใน returns table โดยตั้งใจ
  --    ฟังก์ชัน language sql มองชื่อใน returns table เป็น OUT parameter ที่อยู่ใน scope ด้วย
  --    ชื่อชนกันเมื่อไหร่ Postgres จะฟ้อง 'column reference ... is ambiguous' ตอนสร้างฟังก์ชัน
  select t.sid, t.sname, t.sseq, t.sactive,
         t.smin, t.spmin,
         t.sinput, t.soutput, t.sloss, t.scount
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
      count(pr.id)                             as scount
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
      count(pr.id)
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
  'รวมยอดผลผลิต/คน-นาที รายสถานีในช่วงวันที่ (ไม่นับบันทึกที่ถูกตีกลับ) — ไม่ชนเพดาน max-rows';

-- ------------------------------------------------------------
-- ตรวจผลหลัง paste
-- ------------------------------------------------------------
-- select code, name, is_packing from public.stations order by seq;
--   -- ST-PACK ต้องเป็น true (ตัวเดียว ถ้ายังไม่ได้ติ๊กเพิ่มเอง)
--
-- select * from public.dashboard_job_counts();
--   -- ต้องได้ 1 แถว ไม่ error
--
-- select c.unplan + c.pending_announce + c.planned + c.producing + c.packing
--      + c.qc + c.qa + c.awaiting_fg + c.in_stock  as sum_buckets,
--        c.total                                    as total_jobs
--   from public.dashboard_job_counts() c;
--   -- 🚨 สองค่าต้องเท่ากัน (ไม่งั้นแปลว่ามีงานถูกนับซ้ำหรือหล่นหาย)
--
-- select * from public.dashboard_production_summary('2026-06-01', '2026-06-30');
