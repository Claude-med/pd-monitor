-- ============================================================
-- PD Monitor — D8 ส่วน 2 / 0010_record_idempotency.sql
-- รองรับ "บันทึกแบบทนเน็ตกระตุก" (recommendations.md C1)
-- เพิ่ม client_id (UUID ที่ฝั่ง client สร้าง) เป็น idempotency key
--   → เวลา retry การบันทึกซ้ำ (เช่น เขียนลง DB สำเร็จแต่ response หลุด)
--     จะไม่เกิดแถวซ้ำ — สำคัญมากสำหรับโรงงานยา (ห้ามมี record ผลผลิตซ้ำ)
-- รัน "หลัง" 0001–0009
-- ============================================================

-- 1) คอลัมน์ client_id (เก่าที่ไม่มี = null ได้ · null หลายแถวไม่ชน unique ใน Postgres)
alter table public.production_records add column if not exists client_id uuid;

do $$ begin
  alter table public.production_records add constraint production_records_client_id_key unique (client_id);
exception when duplicate_object then null; end $$;

-- 2) add_production_record เวอร์ชันใหม่ — เพิ่ม p_client_id (idempotent)
--    drop ตัวเดิม (8 args) ก่อน เพราะเปลี่ยนจำนวนพารามิเตอร์
drop function if exists public.add_production_record(
  uuid, production_station, numeric, numeric, numeric, numeric, date, text
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
  p_client_id   uuid    default null
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

  -- ---------- idempotency: ถ้า client_id นี้บันทึกไปแล้ว คืน id เดิม (ไม่ทำซ้ำ) ----------
  if p_client_id is not null then
    select id into v_id from public.production_records where client_id = p_client_id;
    if v_id is not null then
      return v_id;   -- = retry ของรายการที่บันทึกสำเร็จไปแล้ว
    end if;
  end if;

  -- ตรวจงาน + guard สถานะ (ล็อกแถวกัน concurrent)
  select status into v_status from public.jobs where id = p_job_id for update;
  if v_status is null then
    raise exception 'ไม่พบงานนี้';
  end if;
  if v_status not in ('in_production', 'qc', 'qa') then
    raise exception 'บันทึกผลผลิตได้เฉพาะงานที่เริ่มผลิตแล้ว (สถานะปัจจุบัน: %)', v_status;
  end if;

  -- ---------- validation (server เป็นด่านตัดสิน) ----------
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

  -- ---------- ตั้ง audit attribution ให้ trigger log_audit เก็บ ----------
  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกผลผลิต ' || p_station::text, true);

  insert into public.production_records
    (job_id, station, record_date, input_qty, output_qty, loss_qty, hours, operator_id, note, created_by, client_id)
  values
    (p_job_id, p_station, p_record_date, p_input, p_output, v_loss, p_hours,
     v_profile, nullif(btrim(coalesce(p_note, '')), ''), v_profile, p_client_id)
  on conflict (client_id) do nothing
  returning id into v_id;

  -- ถ้า on conflict (มี retry พร้อมกัน) → ดึง id เดิมที่อีกธุรกรรมเพิ่งเขียน
  if v_id is null and p_client_id is not null then
    select id into v_id from public.production_records where client_id = p_client_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.add_production_record(
  uuid, production_station, numeric, numeric, numeric, numeric, date, text, uuid
) to authenticated;
