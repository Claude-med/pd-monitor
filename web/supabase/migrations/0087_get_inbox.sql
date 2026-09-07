-- ============================================================
-- PD Monitor — Part Notification / 0087_get_inbox.sql
--   ก้อน 4 (ส่วน DB) — RPC get_inbox() : ย้ายการกรอง "แจ้งเตือนหมดหน้าที่" ลงมาอยู่ที่ SQL
--
-- 🐞 บั๊กที่ปิด: ตัวเลขบนกระดิ่งไม่ตรงกับจำนวนรายการที่เห็น
--    ของเดิม lib/data/notifications.ts อ่านตารางตรงด้วย .limit(50) "ก่อน" กรองใบที่หมดหน้าที่
--    แล้วค่อยกรองในหน่วยความจำ ⇒ ถ้าใน 50 แถวล่าสุดมีใบหมดหน้าที่ปนอยู่ 20 ใบ จะเห็นแค่ 30 รายการ
--    ขณะที่ unread_notification_count() (0084) นับทั้งตารางไม่มี limit
--    ยิ่งไฟล์ 0085–0086 เพิ่มจุดยิงแจ้งเตือนอีก 12 จุด ช่องว่างนี้จะยิ่งถ่างขึ้นเรื่อย ๆ
--
-- 🎁 ผลพลอยได้: ตรรกะ "ใครเห็นใบไหน" + "ใบไหนหมดหน้าที่" เคยถูกเขียนซ้ำ 2 ภาษา
--    (SQL ใน unread_notification_count · TypeScript ใน isStale())
--    ไฟล์นี้ทำให้เหลือแหล่งเดียวคือ SQL — ฝั่งแอปลบ isStale() ทิ้งได้
--
-- 🚨 where ของฟังก์ชันนี้ต้องเหมือน unread_notification_count() (0084) เป๊ะ
--    ต่างกันแค่ตัวนี้ "ไม่กรองใบที่อ่านแล้วทิ้ง" (คืน read มาเป็นคอลัมน์ให้ UI ตัดสินใจเอง)
--    แก้ที่ไหนต้องแก้อีกที่เสมอ
--
-- รัน "หลัง" 0086 · ไม่มี enum/ตารางใหม่ · รันซ้ำได้
-- ============================================================

create or replace function public.get_inbox(
  p_limit  integer     default 30,
  p_before timestamptz default null
)
returns table (
  id         uuid,
  kind       text,
  title      text,
  body       text,
  job_no     text,
  created_at timestamptz,
  read       boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.kind, n.title, n.body, n.job_no, n.created_at,
         exists (
           select 1 from public.notification_reads r
            where r.notification_id = n.id
              and r.profile_id = public.current_profile_id()
         ) as read
    from public.notifications n
   where (
           (n.target_profile_id is not null and n.target_profile_id = public.current_profile_id())
           or (
             n.target_profile_id is null
             and (n.target_role is null or public.has_role(n.target_role) or public.has_role('manager'))
           )
         )
     and (not n.skip_creator or n.created_by is distinct from public.current_profile_id())
     and (
       n.relevant_status is null
       or (
         n.relevant_status = (select j.status from public.jobs j where j.id = n.job_id)
         and not (
           n.relevant_status = 'finished_goods'
           and exists (select 1 from public.fg_inventory f where f.job_id = n.job_id)
         )
       )
     )
     and (p_before is null or n.created_at < p_before)
   order by n.created_at desc
   -- เพดานแข็ง 200 กันหน้าเว็บดึงทั้งตารางเมื่อผู้บริหารเห็นทุกแถว
   limit least(greatest(coalesce(p_limit, 30), 1), 200);
$$;

revoke execute on function public.get_inbox(integer, timestamptz) from public;
revoke execute on function public.get_inbox(integer, timestamptz) from anon;
grant  execute on function public.get_inbox(integer, timestamptz) to authenticated;

comment on function public.get_inbox(integer, timestamptz) is
  'กล่องแจ้งเตือนของผู้ใช้ปัจจุบัน — กรอง "ใครเห็นใบไหน" + "ใบหมดหน้าที่" ที่ SQL แล้วค่อย limit · เงื่อนไข where ต้องตรงกับ unread_notification_count() เสมอ';

-- ============================================================
-- ✅ ตรวจหลัง paste
--   select count(*) from public.get_inbox(30, null);          -- ต้องรันผ่าน ไม่ error
--   select public.unread_notification_count();                 -- เทียบกับจำนวนใบที่ read = false
--   select count(*) from public.get_inbox(200, null) where not read;
--        -- 2 ค่าหลังต้องเท่ากัน (ถ้าใบยังไม่เกิน 200)
-- ============================================================
