-- ============================================================
-- PD Monitor — Part Notification / 0088_notification_rpc_lockdown.sql
--   เก็บตกหลัง paste 0084–0087 · เจอตอนตรวจของจริงผ่าน REST ด้วย publishable key
--
--   (1) แถวเก่า 21 ใบที่ค้างจากบั๊ก B2 — ยังจ่าหน้าถึง "ทุกคน" อยู่ ⇒ ย้อนไปจ่าหน้าถึงผู้ยื่นให้ถูกคน
--   (2) revoke RPC ของกล่องแจ้งเตือนจาก public/anon — ตอนนี้ยิงได้โดยไม่ต้องล็อกอิน
-- รัน "หลัง" 0087 · ไม่มีตาราง/enum ใหม่ · รันซ้ำได้ปลอดภัย
--
-- 🔎 ที่มา — ทดสอบด้วย publishable key (สิทธิ์ anon ล้วน ไม่ได้ล็อกอิน) หลัง paste:
--      POST /rest/v1/rpc/get_inbox                  → 42501 permission denied ✅ (0087 revoke ไว้แล้ว)
--      POST /rest/v1/rpc/unread_notification_count  → คืนเลข 21 ❌ ไม่ควรตอบ
--    สาเหตุ: Postgres ให้ EXECUTE แก่ PUBLIC โดยปริยาย · การเขียน `grant ... to authenticated`
--    เฉย ๆ "ไม่ได้ถอน" สิทธิ์ของ PUBLIC ออก ⇒ ต้อง revoke ให้ชัดเจน (0084 ทำครบเฉพาะ create_notification)
--
--    เลข 21 ที่หลุดออกมา = แถวที่ target_role is null ทั้งหมด ซึ่งตรวจแล้วเป็น edit_reviewed
--    จากบั๊ก B2 (0083:194,256) ที่ 0084 เพิ่งปิดไป — 0084 หยุด "ใบใหม่" ได้ แต่ไม่ได้ล้างของเก่า
-- ============================================================

-- ------------------------------------------------------------
-- (1) ย้อนจ่าหน้าแถวเก่าให้ถูกคน
--
--   ทำไมจับคู่ด้วย (job_id, เวลา) ได้แม่น:
--     review_edit_request สร้างแจ้งเตือนในทรานแซกชันเดียวกับที่เขียน edit_requests.reviewed_at
--     ทั้ง notifications.created_at และ reviewed_at ใช้ now() ซึ่งเป็น "เวลาเริ่มทรานแซกชัน"
--     ⇒ ค่าตรงกันเป๊ะเสมอ · ตรวจกับข้อมูลจริงแล้ว: 21 ใบจับคู่ได้ 1:1 ครบทุกใบ ไม่มีกำกวมสักใบ
--
--   เงื่อนไข = 1 ใน subquery กันเคสที่มีคำขอหลายใบของงานเดียวกันถูกตัดสินในวินาทีเดียวกัน
--   (ไม่มีในข้อมูลตอนนี้ แต่ถ้าเกิดขึ้นก็ควร "ข้าม" ไม่ใช่เดาสุ่ม)
--   แถวที่จับคู่ไม่ได้จะตกไปข้อ (1b) ซึ่งซ่อนจากพนักงานทั่วไปแทน
-- ------------------------------------------------------------
update public.notifications n
   set target_profile_id = er.requested_by
  from public.edit_requests er
 where n.kind              = 'edit_reviewed'
   and n.target_role      is null
   and n.target_profile_id is null
   and er.job_id           = n.job_id
   and er.reviewed_at      = n.created_at
   and er.requested_by    is not null
   and (
     select count(*) from public.edit_requests e2
      where e2.job_id = n.job_id and e2.reviewed_at = n.created_at
   ) = 1;

-- (1b) ใบที่ยังจับคู่ไม่ได้ (ถ้ามี) — อย่าปล่อยให้ทั้งโรงงานเห็นต่อ
--      จ่าหน้าให้ผู้บริหารแทน (ยังตรวจสอบย้อนหลังได้ แต่พนักงานไม่เห็นคำขอของกันเอง)
update public.notifications
   set target_role = 'manager'
 where kind              = 'edit_reviewed'
   and target_role      is null
   and target_profile_id is null;

-- ------------------------------------------------------------
-- (2) ปิดสิทธิ์ RPC ของกล่องแจ้งเตือนไม่ให้ anon ยิงได้
--
--   ทั้ง 3 ตัวเป็น security definer ที่อ่านข้าม RLS
--   · unread_notification_count  — เดิม anon ยิงได้ และได้เลขกลับมาจริง (ช่องที่เจอ)
--   · mark_notification_read / mark_all_notifications_read — มี guard "ยังไม่ได้เข้าสู่ระบบ" อยู่แล้ว
--     จึงไม่ทำอะไรเสียหาย แต่ปิดให้เหมือนกันทั้งชุด จะได้ไม่ต้องมาไล่เดาทีหลังว่าตัวไหนเปิดอยู่
--
--   ⚠️ แพทเทิร์นที่ถูกของโปรเจคนี้คือ revoke public + revoke anon + grant authenticated ให้ครบ 3 บรรทัด
--      (เทียบ 0067:274-279 · 0083:126-128) — เขียนแค่ grant อย่างเดียวไม่พอ
-- ------------------------------------------------------------
revoke execute on function public.unread_notification_count() from public;
revoke execute on function public.unread_notification_count() from anon;
grant  execute on function public.unread_notification_count() to authenticated;

revoke execute on function public.mark_notification_read(uuid) from public;
revoke execute on function public.mark_notification_read(uuid) from anon;
grant  execute on function public.mark_notification_read(uuid) to authenticated;

revoke execute on function public.mark_all_notifications_read() from public;
revoke execute on function public.mark_all_notifications_read() from anon;
grant  execute on function public.mark_all_notifications_read() to authenticated;

-- ============================================================
-- ✅ ตรวจหลัง paste
--
--   -- ต้องได้ 0 แถว (ไม่เหลือใบที่จ่าหน้าถึง "ทุกคน" อีก)
--   select count(*) as broadcast_left
--     from public.notifications
--    where target_role is null and target_profile_id is null;
--
--   -- ต้องได้ false ทั้ง 3 แถว
--   select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_can
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('unread_notification_count','mark_notification_read',
--                        'mark_all_notifications_read','get_inbox','create_notification')
--    order by p.proname;
-- ============================================================
