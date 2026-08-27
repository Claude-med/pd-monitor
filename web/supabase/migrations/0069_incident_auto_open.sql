-- ============================================================
-- PD Monitor — Part C.4 / 0069_incident_auto_open.sql  (ก้อน 6)
-- "การเปิด Incident Case ที่มาจากขั้นตอนอื่น ต้องนับเป็นการเปิดด้วย"
--
--   (1) กันเปิดซ้ำด้วย partial unique index (inprocess_check_id / qa_sample_id)
--   (2) review_inprocess_check — หัวหน้า QC ไม่อนุมัติ (หรืออนุมัติผลที่ไม่ผ่าน) → เปิดเคสเอง
--   (3) add_qa_sample / update_qa_sample — ผลตรวจ Finished product "ไม่ผ่าน" → เปิดเคสเอง
--
-- ℹ️ ทำไมเรียกใน RPC ไม่ใช่ trigger:
--    trigger บน inprocess_checks จะยิงตอน review_edit_request แก้ result ย้อนหลังด้วย
--    → เปิดเคสซ้ำโดยไม่มีใครสั่ง · และโปรเจคนี้ไม่มี trigger ที่เขียนข้ามตารางเลย
--    (มีแค่ set_row_meta / log_audit) · เรียกใน RPC ยังอยู่ในทรานแซกชันที่ตั้ง
--    app.audit_reason ไว้แล้ว = ประวัติอ่านรู้เรื่อง
--
-- ℹ️ ทำไม "ไม่" เปิดเคสตอน add_inprocess_check ที่ result='fail':
--    แถวนั้นยัง pending รอหัวหน้า QC ตัดสิน — เปิดตอนนั้นคือเปิดก่อนมีคำตัดสิน
--    (นี่คือสาเหตุที่ปุ่ม FailQuickOpen เดิมโชว์ผิดเวลา · ก้อนนี้ลบปุ่มนั้นทิ้ง)
--
-- ⚠️ ตั้งแต่ก้อนนี้ด่าน GMP เข้มขึ้น — ผลตรวจที่ไม่อนุมัติ/ตัวอย่างที่ไม่ผ่าน
--    จะเปิดเคสเองและบล็อก qa → finished_goods ทันทีจนกว่า QA จะปิด/ยกเลิก
-- รัน "หลัง" 0068
-- ============================================================

-- ------------------------------------------------------------
-- (0) pre-flight — ปุ่ม FailQuickOpen เดิมกดซ้ำจากคนละแท็บได้ (ไม่มีอะไรกัน)
--     ถ้ามีเคสซ้ำค้างอยู่ index ข้างล่างจะสร้างไม่ผ่าน → หยุดทั้งไฟล์แล้วให้คนตัดสินใจก่อน
-- ------------------------------------------------------------
do $$
declare
  v_dup integer;
begin
  select count(*) into v_dup from (
    select inprocess_check_id from public.deviations
     where inprocess_check_id is not null
     group by inprocess_check_id having count(*) > 1
  ) t;
  if v_dup > 0 then
    raise exception
      'มีผลตรวจ % รายการที่ถูกเปิด Incident Case ซ้ำมากกว่า 1 ใบ — ต้องเลือกเก็บใบเดียวก่อน (ดู query ท้ายไฟล์)', v_dup;
  end if;

  select count(*) into v_dup from (
    select qa_sample_id from public.deviations
     where qa_sample_id is not null
     group by qa_sample_id having count(*) > 1
  ) t;
  if v_dup > 0 then
    raise exception 'มีจุดเก็บตัวอย่าง % รายการที่ถูกเปิด Incident Case ซ้ำ', v_dup;
  end if;
end $$;

-- ------------------------------------------------------------
-- (1) กันเปิดซ้ำระดับฐานข้อมูล (ชั้นที่ 2 — ชั้นแรกคือ guard ใน open_deviation_internal)
-- ------------------------------------------------------------
create unique index if not exists uq_deviations_inprocess_check
  on public.deviations (inprocess_check_id) where inprocess_check_id is not null;
create unique index if not exists uq_deviations_qa_sample
  on public.deviations (qa_sample_id) where qa_sample_id is not null;

-- ------------------------------------------------------------
-- (2) review_inprocess_check — ยกบอดี้จาก 0065 ทั้งดุ้น + auto-open ต่อท้าย
-- ------------------------------------------------------------
create or replace function public.review_inprocess_check(
  p_id       uuid,
  p_decision text,
  p_note     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_chk     public.inprocess_checks%rowtype;
  v_note    text;
  v_station text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_approve_inprocess() then
    raise exception 'เฉพาะหัวหน้า QC/ผู้บริหารอนุมัติผลตรวจได้';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'คำสั่งไม่ถูกต้อง';
  end if;

  select * into v_chk from public.inprocess_checks where id = p_id for update;
  if v_chk.id is null then raise exception 'ไม่พบผลตรวจที่เลือก'; end if;
  if v_chk.status <> 'pending' then
    raise exception 'ผลตรวจนี้ถูกพิจารณาไปแล้ว (สถานะ: %)', v_chk.status;
  end if;
  if v_chk.checked_by = v_profile then
    raise exception 'ผู้อนุมัติต้องเป็นคนละคนกับผู้ลงผลตรวจ (สองลายเซ็นตามแนว GMP)';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if p_decision = 'reject' and v_note is null then
    raise exception 'การไม่อนุมัติต้องระบุเหตุผล';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    case when p_decision = 'approve' then 'อนุมัติผลตรวจ in-process ' else 'ไม่อนุมัติผลตรวจ in-process ' end
    || coalesce(v_chk.param, ''), true);

  update public.inprocess_checks
     -- 🐞 cast จำเป็น — ทั้งสองแขนของ CASE เป็น unknown literal (บั๊ก 0064:244)
     set status       = (case when p_decision = 'approve' then 'approved' else 'rejected' end)::inprocess_status,
         approved_by  = v_profile,
         approved_at  = now(),
         approve_note = v_note,
         updated_by   = v_profile
   where id = p_id;

  -- ── Part C.4: ผลที่ "ไม่อนุมัติ" หรือ "อนุมัติแต่ผลไม่ผ่าน" = ต้องมี Incident Case ─────
  if p_decision = 'reject' or v_chk.result = 'fail' then
    select name into v_station from public.stations where id = v_chk.station_id;
    perform public.open_deviation_internal(
      v_chk.job_id,
      'ผลตรวจระหว่างผลิตไม่ผ่าน: ' || coalesce(v_chk.param, ''),
      'สถานี ' || coalesce(v_station, '—')
        || ' · ค่าที่วัดได้ ' || coalesce(v_chk.value, '—') || ' ' || coalesce(v_chk.unit, '')
        || case when p_decision = 'reject'
                then ' · หัวหน้า QC ไม่อนุมัติ: ' || coalesce(v_note, '')
                else ' · ผลไม่ผ่านสเปก' end,
      'in_process_fail', 'major', null, p_id, null, v_profile);
  end if;
end;
$fn$;

revoke execute on function public.review_inprocess_check(uuid, text, text) from public;
revoke execute on function public.review_inprocess_check(uuid, text, text) from anon;
grant  execute on function public.review_inprocess_check(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- (3) add_qa_sample — ยกบอดี้จาก 0066 ทั้งดุ้น + auto-open เมื่อผล = ไม่ผ่าน
-- ------------------------------------------------------------
create or replace function public.add_qa_sample(
  p_job_id       uuid,
  p_qty          numeric      default null,
  p_unit         text         default null,
  p_result       check_result default null,
  p_collected_at timestamptz  default null,
  p_note         text         default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_id      uuid;
  v_status  job_status;
  v_at      timestamptz;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_record_qa_sample() then
    raise exception 'เฉพาะ QA/ผู้บริหารบันทึกจุดเก็บตัวอย่างได้';
  end if;

  select status into v_status from public.jobs where id = p_job_id;
  if v_status is null then raise exception 'ไม่พบงานที่เลือก'; end if;
  if v_status <> 'qa' then
    raise exception 'บันทึกจุดเก็บตัวอย่างได้เฉพาะงานที่อยู่สถานะ QA';
  end if;

  if p_qty is not null and p_qty < 0 then raise exception 'จำนวนตัวอย่างห้ามติดลบ'; end if;

  v_at := coalesce(p_collected_at, now());
  if v_at > now() + interval '1 day' then
    raise exception 'วันเวลาที่เก็บตัวอย่างล่วงหน้าเกินไป';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกจุดเก็บตัวอย่าง (ตรวจ Finished product)', true);

  insert into public.qa_samples
    (job_id, qty, unit, result, collected_at, collected_by, note, created_by)
  values
    (p_job_id, p_qty,
     nullif(btrim(coalesce(p_unit, '')), ''),
     p_result, v_at, v_profile,
     nullif(btrim(coalesce(p_note, '')), ''), v_profile)
  returning id into v_id;

  -- ผล "ไม่ผ่าน" = ต้องมี Incident Case ทุกครั้ง (ทีมสั่งว่านับเป็นการเปิดเคสด้วย)
  if p_result = 'fail' then
    perform public.open_deviation_internal(
      p_job_id,
      'ตรวจ Finished product ไม่ผ่าน',
      'จุดเก็บตัวอย่างเมื่อ ' || to_char(v_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI')
        || case when p_note is not null and btrim(p_note) <> '' then ' · ' || btrim(p_note) else '' end,
      'qa_sample_fail', 'major', null, null, v_id, v_profile);
  end if;

  return v_id;
end;
$fn$;

revoke execute on function public.add_qa_sample(uuid, numeric, text, check_result, timestamptz, text) from public;
revoke execute on function public.add_qa_sample(uuid, numeric, text, check_result, timestamptz, text) from anon;
grant  execute on function public.add_qa_sample(uuid, numeric, text, check_result, timestamptz, text) to authenticated;

-- ------------------------------------------------------------
-- (4) update_qa_sample — ยกบอดี้จาก 0066 + เปิดเคสเมื่อผล "เปลี่ยนเป็น" ไม่ผ่าน
--
--     ⚠️ แก้กลับเป็น "ผ่าน" ภายหลัง จะ "ไม่" ปิดเคสอัตโนมัติ —
--        แต่บันทึกหมายเหตุไว้ให้ QA ตัดสินใจปิด/ยกเลิกเอง (ALCOA: ระบบไม่ลบร่องรอย)
-- ------------------------------------------------------------
create or replace function public.update_qa_sample(
  p_id           uuid,
  p_qty          numeric      default null,
  p_unit         text         default null,
  p_result       check_result default null,
  p_collected_at timestamptz  default null,
  p_note         text         default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_row     public.qa_samples%rowtype;
  v_status  job_status;
  v_at      timestamptz;
  v_dev     uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_record_qa_sample() then
    raise exception 'เฉพาะ QA/ผู้บริหารแก้ไขจุดเก็บตัวอย่างได้';
  end if;

  select * into v_row from public.qa_samples where id = p_id for update;
  if v_row.id is null then raise exception 'ไม่พบรายการที่เลือก'; end if;
  if v_row.deleted_at is not null then raise exception 'รายการนี้ถูกลบไปแล้ว'; end if;

  select status into v_status from public.jobs where id = v_row.job_id;
  if v_status <> 'qa' then
    raise exception 'แก้ไขจุดเก็บตัวอย่างได้เฉพาะงานที่ยังอยู่สถานะ QA';
  end if;

  if p_qty is not null and p_qty < 0 then raise exception 'จำนวนตัวอย่างห้ามติดลบ'; end if;

  v_at := coalesce(p_collected_at, v_row.collected_at);
  if v_at > now() + interval '1 day' then
    raise exception 'วันเวลาที่เก็บตัวอย่างล่วงหน้าเกินไป';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'แก้ไขจุดเก็บตัวอย่าง (ตรวจ Finished product)', true);

  update public.qa_samples
     set qty          = p_qty,
         unit         = nullif(btrim(coalesce(p_unit, '')), ''),
         result       = p_result,
         collected_at = v_at,
         note         = nullif(btrim(coalesce(p_note, '')), ''),
         updated_by   = v_profile
   where id = p_id;

  if p_result = 'fail' and v_row.result is distinct from 'fail' then
    perform public.open_deviation_internal(
      v_row.job_id,
      'ตรวจ Finished product ไม่ผ่าน',
      'จุดเก็บตัวอย่างเมื่อ ' || to_char(v_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI')
        || ' (แก้ผลย้อนหลังเป็น ไม่ผ่าน)',
      'qa_sample_fail', 'major', null, null, p_id, v_profile);

  elsif v_row.result = 'fail' and p_result is distinct from 'fail' then
    -- ไม่ปิดเคสให้เอง — บันทึกไว้ใน timeline แล้วให้ QA ตัดสินใจ
    select id into v_dev from public.deviations where qa_sample_id = p_id;
    if v_dev is not null then
      insert into public.deviation_comments (deviation_id, role_group, body, created_by)
      values (v_dev, coalesce(public.current_role_group(), 'qa'),
              'ℹ️ ผลตรวจ Finished product ของตัวอย่างที่เป็นต้นเหตุ ถูกแก้เป็น "'
                || coalesce(p_result::text, 'ยังไม่ลงผล') || '" — โปรดพิจารณาปิดหรือยกเลิกเคสนี้',
              v_profile);
    end if;
  end if;
end;
$fn$;

revoke execute on function public.update_qa_sample(uuid, numeric, text, check_result, timestamptz, text) from public;
revoke execute on function public.update_qa_sample(uuid, numeric, text, check_result, timestamptz, text) from anon;
grant  execute on function public.update_qa_sample(uuid, numeric, text, check_result, timestamptz, text) to authenticated;

-- ============================================================
-- ตรวจหลังรัน (คัดลอกไปรันแยกได้)
-- ------------------------------------------------------------
-- -- index กันซ้ำมีจริง (ต้องได้ 2 แถว)
-- select indexname from pg_indexes where tablename = 'deviations'
--   and indexname in ('uq_deviations_inprocess_check','uq_deviations_qa_sample');
--
-- -- ไม่มี overload ซ้อน (ต้องได้ตัวละ 1)
-- select proname, count(*) from pg_proc
--  where proname in ('review_inprocess_check','add_qa_sample','update_qa_sample')
--  group by proname;
--
-- -- ทดสอบจริงบนเว็บ: หัวหน้า QC กด "ไม่อนุมัติ" 1 รายการ แล้วเช็ก
-- select d.id, d.title, d.status, d.dev_type, d.inprocess_check_id
--   from public.deviations d where d.inprocess_check_id is not null
--  order by d.created_at desc limit 5;
--
-- -- ถ้า pre-flight ข้อ (0) ฟ้องว่ามีเคสซ้ำ ใช้ query นี้ดูว่าซ้ำที่ไหน:
-- -- select inprocess_check_id, array_agg(id order by created_at), array_agg(status)
-- --   from public.deviations where inprocess_check_id is not null
-- --  group by inprocess_check_id having count(*) > 1;
-- -- แนะนำเก็บใบเก่าสุดที่ยังไม่ปิด แล้วยกเลิกใบที่เหลือด้วย update_deviation(...,'cancelled',...)
-- ============================================================
