-- ============================================================
-- PD Monitor — D5 / 0007_production_records.sql
-- บันทึกผลผลิตรายวัน (Daily Production Record) ผ่านฟังก์ชัน server
-- = ด่านตัดสินความถูกต้องของข้อมูล (ALCOA: Accurate) + บันทึก audit ว่าใครกรอก
-- (อ่านคู่ docs/recommendations.md C2 + Notion ฟีเจอร์ข้อ 9 Decimal/Validation)
-- รัน "หลัง" 0001-0006
-- ============================================================
--
-- ทำไมต้องเป็นฟังก์ชัน ไม่ใช่ insert ตรงจาก client:
--   1) validate ที่ server (กัน client ปลอม/ข้าม validation ฝั่งหน้าจอ)
--   2) ตั้ง app.current_profile_id ให้ trigger log_audit เก็บ "ใครกรอก" (ALCOA: Attributable)
--   3) บังคับ guard สถานะงาน (บันทึกได้เฉพาะงานที่เริ่มผลิตแล้ว · ล็อกเมื่อ FG ตาม A5)
--
-- กฎ validate (ตรงกับ validateRecord() ฝั่งหน้าจอ ที่ lib/data/station-constants.ts):
--   - input/output จำเป็น · ทุกค่าตัวเลขห้ามติดลบ · รองรับทศนิยม
--   - output <= input · output + loss <= input
--   - hours 0–24 · วันที่บันทึกล้ำอนาคตไม่ได้

create or replace function public.add_production_record(
  p_job_id      uuid,
  p_station     production_station,
  p_input       numeric,
  p_output      numeric,
  p_loss        numeric default 0,
  p_hours       numeric default null,
  p_record_date date    default current_date,
  p_note        text    default null
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

  -- เฉพาะฝ่ายผลิต/ผู้บริหารบันทึกผลผลิตได้ (ตรวจซ้ำ ไม่พึ่ง RLS เพราะฟังก์ชันนี้ bypass)
  if not (public.has_role('production') or public.has_role('manager')) then
    raise exception 'สิทธิ์ของคุณบันทึกผลผลิตไม่ได้ (เฉพาะฝ่ายผลิต/ผู้บริหาร)';
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
    (job_id, station, record_date, input_qty, output_qty, loss_qty, hours, operator_id, note, created_by)
  values
    (p_job_id, p_station, p_record_date, p_input, p_output, v_loss, p_hours,
     v_profile, nullif(btrim(coalesce(p_note, '')), ''), v_profile)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.add_production_record(
  uuid, production_station, numeric, numeric, numeric, numeric, date, text
) to authenticated;
