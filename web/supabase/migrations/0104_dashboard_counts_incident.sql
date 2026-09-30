-- ============================================================
-- PD Monitor — Part I / 0104_dashboard_counts_incident.sql  (ก้อน 3)
--   กล่อง Pending Order บนแดชบอร์ด: กรองตามบริษัทได้ · "งานมีปัญหา" นับ Incident ที่ยังเปิดด้วย
--
-- นิยามใหม่ "งานมีปัญหา" (ใช้ตรงกันทั้งแดชบอร์ดและบอร์ดงาน — ผู้ใช้เลือก 30 ก.ย. 69)
--   = ติดธงปัญหา (jobs.problem is not null)  หรือ  มี Incident Case ที่ยังไม่ปิด
--   "ยังไม่ปิด" = status not in ('closed','cancelled') — ตัวเดียวกับ has_open_deviation() (0067)
--                 และ isDeviationOpen() ฝั่งแอป (lib/data/deviation-constants.ts)
--   ไม่นับงานที่เข้าคลังแล้ว (บอร์ดงานก็ซ่อนงานพวกนี้ ⇒ ตัวเลขตรงกัน)
--
-- dashboard_job_counts — ยกบอดี้ 0081 · เปลี่ยน:
--   · รับ p_company_id (null = ทุกบริษัท) — ตรงกับตัวกรองบริษัทของบอร์ดงาน (jobs.company_id)
--   · problem นิยามใหม่ · เพิ่มคอลัมน์ incident_open ต่อท้าย (จำนวน "งาน" ที่มี Incident เปิด ไม่ใช่จำนวน Incident)
--   signature เปลี่ยน → drop ตัวเก่าก่อน (กัน overload 2 ตัว · PGRST203)
--
-- 🚨 ลำดับ deploy: paste ไฟล์นี้ "ก่อน" push โค้ด
-- รัน "หลัง" 0103 · รันซ้ำได้
-- ============================================================

drop function if exists public.dashboard_job_counts();
drop function if exists public.dashboard_job_counts(uuid);

create function public.dashboard_job_counts(p_company_id uuid default null)
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
  problem          bigint,  -- 0104: ธงปัญหา หรือ Incident เปิด (ไม่นับงานที่เข้าคลังแล้ว)
  total            bigint,
  incident_open    bigint   -- 0104: งานที่มี Incident ยังไม่ปิด (ไม่นับงานที่เข้าคลังแล้ว)
)
language sql
stable
set search_path = public
as $fn$
  with latest as (
    -- สถานีของบันทึกผลผลิตล่าสุดของแต่ละงาน (ไม่นับบันทึกที่ถูกตีกลับ — 0080)
    select distinct on (pr.job_id) pr.job_id, pr.station_id
      from public.production_records pr
     where pr.status <> 'rejected'
     order by pr.job_id, pr.record_date desc, pr.created_at desc
  ),
  open_inc as (
    select distinct d.job_id
      from public.deviations d
     where d.status not in ('closed', 'cancelled')
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
    count(*) filter (where (j.problem is not null or oi.job_id is not null)
                       and not (j.status = 'finished_goods' and fg.job_id is not null)),
    count(*),
    count(*) filter (where oi.job_id is not null
                       and not (j.status = 'finished_goods' and fg.job_id is not null))
  from public.jobs j
  left join latest              l  on l.job_id  = j.id
  left join public.stations     s  on s.id      = l.station_id
  left join public.fg_inventory fg on fg.job_id = j.id
  left join open_inc            oi on oi.job_id = j.id
  where p_company_id is null or j.company_id = p_company_id;
$fn$;

revoke execute on function public.dashboard_job_counts(uuid) from public;
revoke execute on function public.dashboard_job_counts(uuid) from anon;
grant  execute on function public.dashboard_job_counts(uuid) to authenticated;

comment on function public.dashboard_job_counts(uuid) is
  'นับงานทุกช่องของแดชบอร์ด (Plan / WIP / เข้าคลังแล้ว / มีปัญหา / Incident เปิด) ในแถวเดียว · กรองบริษัทได้ (null = ทั้งหมด)';


-- ============================================================
-- ✅ ตรวจหลัง paste (รันทีละข้อ)
--
-- ข้อ 1 · เหลือฟังก์ชันตัวเดียว (ไม่มี overload ค้าง)
--   select oid::regprocedure from pg_proc where proname = 'dashboard_job_counts';
--   ✅ 1 แถว: dashboard_job_counts(uuid)
--
-- ข้อ 2 · ช่องต่าง ๆ ยังรวมกันได้เท่าจำนวนงานทั้งหมด
--   select c.unplan + c.pending_announce + c.planned + c.producing + c.packing
--        + c.qc + c.qa + c.awaiting_fg + c.in_stock as sum_buckets,
--          c.total as total_jobs, c.problem, c.incident_open
--     from public.dashboard_job_counts() c;
--   ✅ sum_buckets = total_jobs · incident_open ≤ problem
--
-- ข้อ 3 · incident_open ตรงกับข้อมูลจริง
--   select count(distinct d.job_id)
--     from public.deviations d
--     join public.jobs j on j.id = d.job_id
--     left join public.fg_inventory fg on fg.job_id = j.id
--    where d.status not in ('closed','cancelled')
--      and not (j.status = 'finished_goods' and fg.job_id is not null);
--   ✅ เท่ากับ incident_open ของข้อ 2
--
-- ข้อ 4 · กรองบริษัทได้ (เปลี่ยน id เป็นบริษัทจริงจาก select id, name from public.companies)
--   select total from public.dashboard_job_counts('<company-id>');
--   ✅ ≤ total ของข้อ 2
-- ============================================================
