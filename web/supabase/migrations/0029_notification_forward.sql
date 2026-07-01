-- ============================================================
-- PD Monitor — 0029_notification_forward.sql  (C1: แจ้งงานเลื่อนขั้น + auto-hide)
--   (C1a) แจ้ง role ปลายทางเมื่องาน "เลื่อนขั้น" (forward) — "งานมาถึงหน้าที่คุณแล้ว"
--   (C1b) auto-hide แจ้งเตือนที่ "หมดหน้าที่" เมื่องานเลื่อนพ้นสถานะนั้น/รับเข้าคลังแล้ว
--         ผ่านคอลัมน์ notifications.relevant_status (null = แสดงตลอด เช่น deviation)
-- คง GATE เดิม (line clearance + deviation) และ noti reject เดิมทุกอย่าง
-- รัน "หลัง" 0026
-- ============================================================

-- ------------------------------------------------------------
-- (C1b) เพิ่มคอลัมน์ relevant_status — สถานะที่แจ้งเตือนนี้ "เกี่ยวข้อง"
--   เมื่องานเลื่อนพ้นสถานะนี้ → ถือว่าแจ้งเตือนหมดหน้าที่ (ซ่อนอัตโนมัติ)
-- ------------------------------------------------------------
alter table public.notifications
  add column if not exists relevant_status job_status;

-- ------------------------------------------------------------
-- create_notification (overload 7-arg) — เพิ่ม relevant_status
--   ตัว 6-arg เดิมยังอยู่ (open_deviation ใช้ = deviation แสดงตลอด)
-- ------------------------------------------------------------
create or replace function public.create_notification(
  p_kind            text,
  p_title           text,
  p_body            text,
  p_job_id          uuid,
  p_job_no          text,
  p_target_role     app_role,
  p_relevant_status job_status
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.notifications
    (kind, title, body, job_id, job_no, target_role, relevant_status, created_by)
  values
    (p_kind, p_title, nullif(btrim(coalesce(p_body, '')), ''),
     p_job_id, p_job_no, p_target_role, p_relevant_status, public.current_profile_id())
  returning id into v_id;
  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- (C1a) advance_job_status — คงเดิม + แจ้ง role ปลายทางเมื่อ forward
-- ------------------------------------------------------------
create or replace function public.advance_job_status(
  p_job_id uuid,
  p_to     job_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile   uuid;
  v_from      job_status;
  v_job_no    text;
  v_is_reject boolean := false;
  v_allowed   boolean := false;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;

  select status, job_no into v_from, v_job_no from public.jobs where id = p_job_id for update;
  if v_from is null then
    raise exception 'ไม่พบงานนี้';
  end if;
  if v_from = p_to then
    raise exception 'สถานะไม่เปลี่ยนแปลง';
  end if;

  if    v_from = 'pending_announce' and p_to = 'planned' then
    v_allowed := public.has_role('manager');
  elsif v_from = 'planned'          and p_to = 'in_production' then
    v_allowed := public.has_role('production') or public.has_role('manager');
    if v_allowed and not public.line_clearance_passed(p_job_id) then
      raise exception 'เริ่มผลิตไม่ได้ — ต้องทำ Line Clearance ให้ผ่านก่อน (เคลียร์ของเก่า/ทำความสะอาด/ตั้งเครื่อง + ผู้ตรวจรับเซ็น)';
    end if;
  elsif v_from = 'in_production'     and p_to = 'qc' then
    v_allowed := public.has_role('production');
  elsif v_from = 'qc'               and p_to = 'qa' then
    v_allowed := public.has_role('qc');
  elsif v_from = 'qc'               and p_to = 'in_production' then
    v_allowed := public.has_role('qc'); v_is_reject := true;
  elsif v_from = 'qa'               and p_to = 'finished_goods' then
    v_allowed := public.has_role('qa');
    if v_allowed and public.has_open_deviation(p_job_id) then
      raise exception 'ปล่อยผ่าน FG ไม่ได้ — ยังมี deviation เปิดค้าง ต้องปิด (closed) ก่อน';
    end if;
  elsif v_from = 'qa'               and p_to = 'in_production' then
    v_allowed := public.has_role('qa'); v_is_reject := true;
  else
    raise exception 'เปลี่ยนสถานะจาก "%" ไป "%" ไม่ได้ (ผิดลำดับ)', v_from, p_to;
  end if;

  if not v_allowed then
    raise exception 'สิทธิ์ของคุณไม่สามารถทำขั้นตอนนี้ได้';
  end if;

  if v_is_reject and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'การตีกลับต้องระบุเหตุผล';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config(
    'app.audit_reason',
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''),
             case when v_is_reject then 'ตีกลับ' else 'เปลี่ยนสถานะ' end),
    true
  );

  update public.jobs
     set status     = p_to,
         updated_by = v_profile
   where id = p_job_id;

  if v_is_reject then
    -- B4: แจ้งฝ่ายผลิตเมื่องานถูกตีกลับ (relevant = in_production → ซ่อนเมื่อส่งต่อไปแล้ว)
    perform public.create_notification(
      'reject',
      'งาน ' || v_job_no || ' ถูกตีกลับ',
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'ไม่ระบุเหตุผล'),
      p_job_id, v_job_no, 'production', 'in_production');
  else
    -- C1a: แจ้ง role ปลายทางว่า "งานมาถึงหน้าที่คุณแล้ว"
    --   (ข้าม planned→in_production เพราะฝ่ายผลิตเป็นคนกดเริ่มเอง)
    if    p_to = 'planned' then
      perform public.create_notification(
        'arrival', 'งาน ' || v_job_no || ' ยืนยันแผนแล้ว — พร้อมเริ่มผลิต',
        null, p_job_id, v_job_no, 'production', 'planned');
    elsif p_to = 'qc' then
      perform public.create_notification(
        'arrival', 'งาน ' || v_job_no || ' ส่งถึง QC แล้ว',
        'รอตรวจสอบคุณภาพ (QC)', p_job_id, v_job_no, 'qc', 'qc');
    elsif p_to = 'qa' then
      perform public.create_notification(
        'arrival', 'งาน ' || v_job_no || ' ส่งถึง QA แล้ว',
        'รอ QA ปล่อยผ่าน', p_job_id, v_job_no, 'qa', 'qa');
    elsif p_to = 'finished_goods' then
      perform public.create_notification(
        'arrival', 'งาน ' || v_job_no || ' พร้อมรับเข้าคลัง FG',
        'QA ปล่อยผ่านแล้ว — รอฝ่ายคลังรับเข้า', p_job_id, v_job_no, 'warehouse', 'finished_goods');
    end if;
  end if;
end;
$$;

grant execute on function public.advance_job_status(uuid, job_status, text) to authenticated;

-- ------------------------------------------------------------
-- (C1b) unread_notification_count — ไม่นับแจ้งเตือนที่หมดหน้าที่แล้ว
--   หมดหน้าที่ = relevant_status ไม่ตรงสถานะงานปัจจุบัน
--              หรือ (FG) รับเข้าคลังแล้ว (มีใน fg_inventory)
-- ------------------------------------------------------------
create or replace function public.unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.notifications n
   where (n.target_role is null or public.has_role(n.target_role))
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
     and not exists (
       select 1 from public.notification_reads r
        where r.notification_id = n.id
          and r.profile_id = public.current_profile_id()
     );
$$;

grant execute on function public.unread_notification_count() to authenticated;
