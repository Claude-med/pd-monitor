-- ============================================================
-- PD Monitor — D10 / 0015_record_machine.sql  (A1 ก้อน 2)
-- ผูก "งานนี้ใช้เครื่องไหน" เข้ากับการบันทึกผลผลิต
--   + กันเลือกเครื่องที่สถานะ "ซ่อมบำรุง / ถึงกำหนดสอบเทียบ" (validate ใน RPC)
-- รัน "หลัง" 0001–0014
-- ============================================================

-- 1) คอลัมน์ machine_id (ออปชัน — งานเก่า/บางสถานีไม่ผูกเครื่องก็ได้)
alter table public.production_records
  add column if not exists machine_id uuid references public.machines(id);

create index if not exists idx_prod_machine on public.production_records(machine_id);

-- 2) add_production_record เวอร์ชันใหม่ — เพิ่ม p_machine_id (10 args)
--    drop ตัวเดิม (9 args จาก 0010) ก่อน เพราะเปลี่ยนจำนวนพารามิเตอร์
drop function if exists public.add_production_record(
  uuid, production_station, numeric, numeric, numeric, numeric, date, text, uuid
);

create or replace function public.add_production_record(
  p_job_id      uuid,
  p_station     production_station,
  p_input       numeric,
  p_output      numeric,
  p_loss        numeric default 0,
  p_hours       numeric default null,
  p_record_date date    default current_date,
  p_note        text    default null,
  p_client_id   uuid    default null,
  p_machine_id  uuid    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_status  job_status;
  v_loss    numeric := coalesce(p_loss, 0);
  v_id      uuid;
  v_mc      record;
begin
  -- ต้องล็อกอิน
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;

  -- เฉพาะฝ่ายผลิต/ผู้บริหารบันทึกผลผลิตได้
  if not (public.has_role('production') or public.has_role('manager')) then
    raise exception 'สิทธิ์ของคุณบันทึกผลผลิตไม่ได้ (เฉพาะฝ่ายผลิต/ผู้บริหาร)';
  end if;

  -- ---------- idempotency ----------
  if p_client_id is not null then
    select id into v_id from public.production_records where client_id = p_client_id;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- ตรวจงาน + guard สถานะ
  select status into v_status from public.jobs where id = p_job_id for update;
  if v_status is null then
    raise exception 'ไม่พบงานนี้';
  end if;
  if v_status not in ('in_production', 'qc', 'qa') then
    raise exception 'บันทึกผลผลิตได้เฉพาะงานที่เริ่มผลิตแล้ว (สถานะปัจจุบัน: %)', v_status;
  end if;

  -- ---------- ตรวจเครื่องจักร (ถ้าระบุ) ----------
  if p_machine_id is not null then
    select id, code, status, is_active into v_mc
      from public.machines where id = p_machine_id;
    if v_mc.id is null then
      raise exception 'ไม่พบเครื่องจักรที่เลือก';
    end if;
    if not v_mc.is_active then
      raise exception 'เครื่อง % ถูกปิดใช้งานแล้ว เลือกไม่ได้', v_mc.code;
    end if;
    if v_mc.status in ('maintenance', 'calibration_due') then
      raise exception 'เครื่อง % อยู่สถานะซ่อม/ถึงกำหนดสอบเทียบ — เริ่มงานบนเครื่องนี้ไม่ได้', v_mc.code;
    end if;
  end if;

  -- ---------- validation ----------
  if p_input is null or p_input < 0 then
    raise exception 'ยอดตั้งต้น (input) จำเป็นต้องกรอกและห้ามติดลบ';
  end if;
  if p_output is null or p_output < 0 then
    raise exception 'ยอดผลิตได้ (output) จำเป็นต้องกรอกและห้ามติดลบ';
  end if;
  if v_loss < 0 then
    raise exception 'ของเสีย (loss) ห้ามติดลบ';
  end if;
  if p_hours is not null and (p_hours < 0 or p_hours > 24) then
    raise exception 'ชั่วโมงทำงานต้องอยู่ระหว่าง 0–24';
  end if;
  if p_output > p_input then
    raise exception 'ยอดผลิตได้ (%) มากกว่ายอดตั้งต้น (%) ไม่ได้', p_output, p_input;
  end if;
  if (p_output + v_loss) > p_input then
    raise exception 'ผลิตได้ + ของเสีย (%) มากกว่ายอดตั้งต้น (%) ไม่ได้', (p_output + v_loss), p_input;
  end if;
  if p_record_date > current_date then
    raise exception 'วันที่บันทึกเป็นวันในอนาคตไม่ได้';
  end if;

  -- ---------- audit attribution ----------
  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกผลผลิต ' || p_station::text, true);

  insert into public.production_records
    (job_id, station, record_date, input_qty, output_qty, loss_qty, hours,
     operator_id, note, created_by, client_id, machine_id)
  values
    (p_job_id, p_station, p_record_date, p_input, p_output, v_loss, p_hours,
     v_profile, nullif(btrim(coalesce(p_note, '')), ''), v_profile, p_client_id, p_machine_id)
  on conflict (client_id) do nothing
  returning id into v_id;

  if v_id is null and p_client_id is not null then
    select id into v_id from public.production_records where client_id = p_client_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.add_production_record(
  uuid, production_station, numeric, numeric, numeric, numeric, date, text, uuid, uuid
) to authenticated;
