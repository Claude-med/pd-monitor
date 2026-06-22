-- ============================================================
-- PD Monitor — D4 / 0006_job_transitions.sql
-- State machine: บังคับลำดับสถานะงานที่ฝั่ง server (กันข้ามขั้น)
-- + ตรวจสิทธิ์ตาม role + บันทึก audit ว่าใครเปลี่ยน/เหตุผล
-- (ตามที่ทีมย้ำใน full-demo-decision: "transition ข้ามขั้นกันที่ backend ไม่ใช่แค่ UI")
-- รัน "หลัง" 0001-0005
-- ============================================================

-- ลำดับที่อนุญาต (เดินหน้า):
--   รอแจ้งผลิต → มีแผนแล้ว → กำลังผลิต → QC → QA → FG
-- ตีกลับ (reject, ต้องมีเหตุผล):
--   QC → กำลังผลิต   ·   QA → กำลังผลิต
--
-- สิทธิ์:
--   manager      : รอแจ้งผลิต→มีแผนแล้ว (วางแผน) + เริ่มผลิตได้
--   production   : มีแผนแล้ว→กำลังผลิต, กำลังผลิต→QC
--   qc           : QC→QA (ผ่าน), QC→กำลังผลิต (ตีกลับ)
--   qa           : QA→FG (ปล่อย), QA→กำลังผลิต (ตีกลับ)

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
  v_is_reject boolean := false;
  v_allowed   boolean := false;
begin
  -- ต้องล็อกอิน
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;

  -- ล็อกแถวกัน concurrent
  select status into v_from from public.jobs where id = p_job_id for update;
  if v_from is null then
    raise exception 'ไม่พบงานนี้';
  end if;
  if v_from = p_to then
    raise exception 'สถานะไม่เปลี่ยนแปลง';
  end if;

  -- ตรวจ transition ที่อนุญาต + สิทธิ์
  if    v_from = 'pending_announce' and p_to = 'planned' then
    v_allowed := public.has_role('manager');
  elsif v_from = 'planned'          and p_to = 'in_production' then
    v_allowed := public.has_role('production') or public.has_role('manager');
  elsif v_from = 'in_production'     and p_to = 'qc' then
    v_allowed := public.has_role('production');
  elsif v_from = 'qc'               and p_to = 'qa' then
    v_allowed := public.has_role('qc');
  elsif v_from = 'qc'               and p_to = 'in_production' then
    v_allowed := public.has_role('qc'); v_is_reject := true;
  elsif v_from = 'qa'               and p_to = 'finished_goods' then
    v_allowed := public.has_role('qa');
  elsif v_from = 'qa'               and p_to = 'in_production' then
    v_allowed := public.has_role('qa'); v_is_reject := true;
  else
    raise exception 'เปลี่ยนสถานะจาก "%" ไป "%" ไม่ได้ (ผิดลำดับ)', v_from, p_to;
  end if;

  if not v_allowed then
    raise exception 'สิทธิ์ของคุณไม่สามารถทำขั้นตอนนี้ได้';
  end if;

  -- ตีกลับต้องมีเหตุผล
  if v_is_reject and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'การตีกลับต้องระบุเหตุผล';
  end if;

  -- ตั้ง audit attribution (ใครทำ + เหตุผล) ให้ trigger log_audit เก็บ
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
end;
$$;

grant execute on function public.advance_job_status(uuid, job_status, text) to authenticated;
