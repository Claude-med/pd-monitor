-- ============================================================
-- PD Monitor — D10 / 0019_headcount_autojobno.sql  (A5)
-- (1) จำนวนคนต่อขั้น (headcount) ใน production_records → ต้นทุนค่าแรง = ชม. × คน × อัตรา
-- (2) auto-gen เลขงาน (JOB-YYYY-NNNN) ด้วย sequence (กันชนตอนสร้างพร้อมกัน) · override ได้
-- รัน "หลัง" 0001–0018
-- ============================================================

-- ------------------------------------------------------------
-- (1) headcount
-- ------------------------------------------------------------
alter table public.production_records
  add column if not exists headcount integer check (headcount is null or headcount >= 1);

-- add_production_record เวอร์ชันใหม่ (11 args) — เพิ่ม p_headcount
-- drop ตัวเดิม (10 args จาก 0015) ก่อน
drop function if exists public.add_production_record(
  uuid, production_station, numeric, numeric, numeric, numeric, date, text, uuid, uuid
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
  p_machine_id  uuid    default null,
  p_headcount   integer default null
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
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  if not (public.has_role('production') or public.has_role('manager')) then
    raise exception 'สิทธิ์ของคุณบันทึกผลผลิตไม่ได้ (เฉพาะฝ่ายผลิต/ผู้บริหาร)';
  end if;

  -- idempotency
  if p_client_id is not null then
    select id into v_id from public.production_records where client_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;

  -- งาน + guard สถานะ
  select status into v_status from public.jobs where id = p_job_id for update;
  if v_status is null then raise exception 'ไม่พบงานนี้'; end if;
  if v_status not in ('in_production', 'qc', 'qa') then
    raise exception 'บันทึกผลผลิตได้เฉพาะงานที่เริ่มผลิตแล้ว (สถานะปัจจุบัน: %)', v_status;
  end if;

  -- เครื่องจักร (ถ้าระบุ)
  if p_machine_id is not null then
    select id, code, status, is_active into v_mc
      from public.machines where id = p_machine_id;
    if v_mc.id is null then raise exception 'ไม่พบเครื่องจักรที่เลือก'; end if;
    if not v_mc.is_active then raise exception 'เครื่อง % ถูกปิดใช้งานแล้ว เลือกไม่ได้', v_mc.code; end if;
    if v_mc.status in ('maintenance', 'calibration_due') then
      raise exception 'เครื่อง % อยู่สถานะซ่อม/ถึงกำหนดสอบเทียบ — เริ่มงานบนเครื่องนี้ไม่ได้', v_mc.code;
    end if;
  end if;

  -- validation
  if p_input is null or p_input < 0 then
    raise exception 'ยอดตั้งต้น (input) จำเป็นต้องกรอกและห้ามติดลบ';
  end if;
  if p_output is null or p_output < 0 then
    raise exception 'ยอดผลิตได้ (output) จำเป็นต้องกรอกและห้ามติดลบ';
  end if;
  if v_loss < 0 then raise exception 'ของเสีย (loss) ห้ามติดลบ'; end if;
  if p_hours is not null and (p_hours < 0 or p_hours > 24) then
    raise exception 'ชั่วโมงทำงานต้องอยู่ระหว่าง 0–24';
  end if;
  if p_headcount is not null and p_headcount < 1 then
    raise exception 'จำนวนคนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
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

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกผลผลิต ' || p_station::text, true);

  insert into public.production_records
    (job_id, station, record_date, input_qty, output_qty, loss_qty, hours,
     operator_id, note, created_by, client_id, machine_id, headcount)
  values
    (p_job_id, p_station, p_record_date, p_input, p_output, v_loss, p_hours,
     v_profile, nullif(btrim(coalesce(p_note, '')), ''), v_profile, p_client_id,
     p_machine_id, p_headcount)
  on conflict (client_id) do nothing
  returning id into v_id;

  if v_id is null and p_client_id is not null then
    select id into v_id from public.production_records where client_id = p_client_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.add_production_record(
  uuid, production_station, numeric, numeric, numeric, numeric, date, text, uuid, uuid, integer
) to authenticated;

-- ------------------------------------------------------------
-- (2) auto-gen เลขงาน — sequence + ยกเครื่อง create_job_with_order
--     เว้น p_job_no ว่าง = ออกเลขอัตโนมัติ JOB-YYYY-NNNN · ใส่เองได้ (override)
-- ------------------------------------------------------------
create sequence if not exists public.job_no_seq;

create or replace function public.create_job_with_order(
  p_customer      text,
  p_product_id    uuid,
  p_quantity      numeric,
  p_unit          text,
  p_due_date      date,
  p_job_no        text,
  p_planned_start date default null,
  p_planned_end   date default null,
  p_lot_no        text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_order   uuid;
  v_batch   uuid;
  v_job_no  text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.has_role('manager') then
    raise exception 'เฉพาะผู้บริหาร/ฝ่ายวางแผนสร้างงานผลิตได้';
  end if;

  p_customer := btrim(coalesce(p_customer, ''));
  v_job_no   := btrim(coalesce(p_job_no, ''));

  if p_customer = '' then raise exception 'กรุณาระบุลูกค้า'; end if;
  if p_product_id is null then raise exception 'กรุณาเลือกผลิตภัณฑ์'; end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'ไม่พบผลิตภัณฑ์ที่เลือก';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'จำนวนต้องมากกว่า 0';
  end if;

  -- ออกเลขงานอัตโนมัติถ้าเว้นว่าง (กันชนด้วย sequence + วน loop เผื่อชนเลขที่ใส่มือไว้)
  if v_job_no = '' then
    loop
      v_job_no := 'JOB-' || to_char(current_date, 'YYYY') || '-'
                  || lpad(nextval('public.job_no_seq')::text, 4, '0');
      exit when not exists (select 1 from public.jobs where job_no = v_job_no);
    end loop;
  else
    if exists (select 1 from public.jobs where job_no = v_job_no) then
      raise exception 'เลขงาน % มีอยู่แล้ว — กรุณาใช้เลขอื่น', v_job_no;
    end if;
  end if;

  if p_planned_start is not null and p_planned_end is not null
     and p_planned_end < p_planned_start then
    raise exception 'วันสิ้นสุดแผนต้องไม่ก่อนวันเริ่ม';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'สร้างงานผลิตใหม่ ' || v_job_no, true);

  insert into public.orders (order_no, customer, product_id, quantity, unit, due_date, created_by)
  values ('ORD-' || v_job_no, p_customer, p_product_id, p_quantity,
          coalesce(nullif(btrim(coalesce(p_unit, '')), ''), 'เม็ด'), p_due_date, v_profile)
  returning id into v_order;

  if p_lot_no is not null and btrim(p_lot_no) <> '' then
    if exists (select 1 from public.batches where lot_no = btrim(p_lot_no)) then
      raise exception 'เลขล็อต % มีอยู่แล้ว', btrim(p_lot_no);
    end if;
    insert into public.batches (lot_no, order_id, product_id, created_by)
    values (btrim(p_lot_no), v_order, p_product_id, v_profile)
    returning id into v_batch;
  end if;

  insert into public.jobs
    (job_no, order_id, batch_id, status, planned_start, planned_end, created_by)
  values
    (v_job_no, v_order, v_batch, 'pending_announce', p_planned_start, p_planned_end, v_profile);

  return v_job_no;
end;
$$;

grant execute on function public.create_job_with_order(
  text, uuid, numeric, text, date, text, date, date, text
) to authenticated;
