-- ============================================================
-- PD Monitor — D9 / 0011_create_job.sql
-- หน้าจอ "สร้างงานผลิตใหม่" (requirement ข้อ 1: ฝ่ายวางแผนสร้าง Job + ลงแผนได้)
-- เขียนผ่านฟังก์ชัน security definer (แพตเทิร์นเดียวกับ add_production_record / advance_job_status)
--   = บังคับสิทธิ์ที่ server + ตั้ง audit GUC ให้ trigger เก็บ "ใครสร้าง"
-- รัน "หลัง" 0001–0010
-- ============================================================

-- ------------------------------------------------------------
-- 1) create_product — เพิ่มยา/ผลิตภัณฑ์ใหม่ (manager เท่านั้น)
-- ------------------------------------------------------------
create or replace function public.create_product(
  p_code               text,
  p_name               text,
  p_dosage_form        text    default null,
  p_standard_time_hours numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_id      uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.has_role('manager') then
    raise exception 'เฉพาะผู้บริหาร/ฝ่ายวางแผนเพิ่มผลิตภัณฑ์ได้';
  end if;

  p_code := btrim(coalesce(p_code, ''));
  p_name := btrim(coalesce(p_name, ''));
  if p_code = '' then raise exception 'กรุณาระบุรหัสยา (code)'; end if;
  if p_name = '' then raise exception 'กรุณาระบุชื่อยา'; end if;
  if exists (select 1 from public.products where code = p_code) then
    raise exception 'รหัสยา % มีอยู่แล้ว', p_code;
  end if;
  if p_standard_time_hours is not null and p_standard_time_hours < 0 then
    raise exception 'เวลามาตรฐาน (ชม.) ห้ามติดลบ';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'เพิ่มผลิตภัณฑ์ ' || p_code, true);

  insert into public.products (code, name, dosage_form, standard_time_hours, created_by)
  values (p_code, p_name, nullif(btrim(coalesce(p_dosage_form, '')), ''),
          p_standard_time_hours, v_profile)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_product(text, text, text, numeric) to authenticated;

-- ------------------------------------------------------------
-- 2) create_job_with_order — สร้างออเดอร์ + งานผลิต (+ ล็อตถ้ามี) ในธุรกรรมเดียว
--    manager เท่านั้น · งานใหม่เริ่มที่สถานะ 'pending_announce' (รอแจ้งผลิต)
--    order_no = 'ORD-' || job_no (ผูกกัน + unique อัตโนมัติเพราะ job_no unique)
-- ------------------------------------------------------------
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
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.has_role('manager') then
    raise exception 'เฉพาะผู้บริหาร/ฝ่ายวางแผนสร้างงานผลิตได้';
  end if;

  -- ---------- validate ----------
  p_job_no   := btrim(coalesce(p_job_no, ''));
  p_customer := btrim(coalesce(p_customer, ''));
  if p_job_no = ''   then raise exception 'กรุณาระบุเลขงาน (Job No)'; end if;
  if p_customer = '' then raise exception 'กรุณาระบุลูกค้า'; end if;
  if p_product_id is null then raise exception 'กรุณาเลือกผลิตภัณฑ์'; end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'ไม่พบผลิตภัณฑ์ที่เลือก';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'จำนวนต้องมากกว่า 0';
  end if;
  if exists (select 1 from public.jobs where job_no = p_job_no) then
    raise exception 'เลขงาน % มีอยู่แล้ว — กรุณาใช้เลขอื่น', p_job_no;
  end if;
  if p_planned_start is not null and p_planned_end is not null
     and p_planned_end < p_planned_start then
    raise exception 'วันสิ้นสุดแผนต้องไม่ก่อนวันเริ่ม';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'สร้างงานผลิตใหม่ ' || p_job_no, true);

  -- ---------- order ----------
  insert into public.orders (order_no, customer, product_id, quantity, unit, due_date, created_by)
  values ('ORD-' || p_job_no, p_customer, p_product_id, p_quantity,
          coalesce(nullif(btrim(coalesce(p_unit, '')), ''), 'เม็ด'), p_due_date, v_profile)
  returning id into v_order;

  -- ---------- batch (ถ้าระบุล็อต) ----------
  if p_lot_no is not null and btrim(p_lot_no) <> '' then
    if exists (select 1 from public.batches where lot_no = btrim(p_lot_no)) then
      raise exception 'เลขล็อต % มีอยู่แล้ว', btrim(p_lot_no);
    end if;
    insert into public.batches (lot_no, order_id, product_id, created_by)
    values (btrim(p_lot_no), v_order, p_product_id, v_profile)
    returning id into v_batch;
  end if;

  -- ---------- job ----------
  insert into public.jobs
    (job_no, order_id, batch_id, status, planned_start, planned_end, created_by)
  values
    (p_job_no, v_order, v_batch, 'pending_announce', p_planned_start, p_planned_end, v_profile);

  return p_job_no;
end;
$$;

grant execute on function public.create_job_with_order(
  text, uuid, numeric, text, date, text, date, date, text
) to authenticated;
