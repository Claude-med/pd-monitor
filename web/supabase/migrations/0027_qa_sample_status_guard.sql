-- ============================================================
-- PD Monitor — 0027_qa_sample_status_guard.sql  (B2)
-- ยกเครื่อง add_qa_sample: เพิ่ม "gate สถานะงาน = qa เท่านั้น"
--   (เดิมเช็กแค่ role qa/manager แต่บันทึกได้ทุกสถานะ)
-- คง signature + logic เดิมทั้งหมด เพิ่มเฉพาะเงื่อนไขสถานะ
-- รัน "หลัง" 0024
-- ============================================================

create or replace function public.add_qa_sample(
  p_job_id       uuid,
  p_sample_point text,
  p_qty          numeric default null,
  p_unit         text    default null,
  p_note         text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_id      uuid;
  v_status  job_status;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not (public.has_role('qa') or public.has_role('manager')) then
    raise exception 'เฉพาะ QA/ผู้บริหารบันทึกจุดเก็บตัวอย่างได้';
  end if;

  -- gate สถานะ: เก็บตัวอย่าง QA ได้เฉพาะงานที่อยู่ขั้น QA
  select status into v_status from public.jobs where id = p_job_id;
  if v_status is null then raise exception 'ไม่พบงานที่เลือก'; end if;
  if v_status <> 'qa' then
    raise exception 'บันทึกจุดเก็บตัวอย่าง QA ได้เฉพาะงานที่อยู่สถานะ QA';
  end if;

  p_sample_point := nullif(btrim(coalesce(p_sample_point, '')), '');
  if p_sample_point is null then raise exception 'กรุณาระบุจุด/รอบเก็บตัวอย่าง'; end if;
  if p_qty is not null and p_qty < 0 then raise exception 'จำนวนตัวอย่างห้ามติดลบ'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกจุดเก็บตัวอย่าง QA ' || p_sample_point, true);

  insert into public.qa_samples
    (job_id, sample_point, qty, unit, collected_by, note, created_by)
  values
    (p_job_id, p_sample_point, p_qty,
     nullif(btrim(coalesce(p_unit, '')), ''),
     v_profile, nullif(btrim(coalesce(p_note, '')), ''), v_profile)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.add_qa_sample(uuid, text, numeric, text, text)
  to authenticated;
