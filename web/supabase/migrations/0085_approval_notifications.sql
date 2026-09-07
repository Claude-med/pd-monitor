-- ============================================================
-- PD Monitor — Part Notification / 0085_approval_notifications.sql
--   ก้อน 2 "หัวหน้าทุกฝ่ายต้องรู้ทุกครั้งที่มีของรออนุมัติ"
--
--   ระบบมีการอนุมัติ 5 ชุดที่แยกกันคนละกลไก — เดิมมีแจ้งเตือนแค่ 2 ชุด:
--     ✓ ลงนาม QC/QA (e-sign)   → มี arrival/reject อยู่แล้ว (0062:429-453)
--     ✓ คำขอแก้ไขย้อนหลัง       → มีอยู่แล้ว (0084)
--     ✗ Line Clearance          → เงียบสนิททั้งขาไปและขากลับ
--     ✗ ผลตรวจ in-process       → เงียบสนิททั้งขาไปและขากลับ
--     ✗ บันทึกผลผลิต            → เงียบสนิททั้งขาไปและขากลับ
--   ไฟล์นี้เติม 3 ชุดที่ขาด ทั้ง "ขาไป" (⏳ รออนุมัติ) และ "ขากลับ" (✅ ผลการอนุมัติ)
--
--   (1) perform_line_clearance           → ⏳ production_lead   (skip_creator)
--   (2) check_line_clearance             → ✅ ผู้บันทึก (รายบุคคล)
--   (3) add_inprocess_check              → ⏳ qc_lead           (skip_creator)
--   (4) review_inprocess_check           → ✅ ผู้ลงผล (รายบุคคล)
--   (5) review_production_record         → ✅ ผู้บันทึก (รายบุคคล)
--   (6) reset_production_record_approval → ⏳ production_lead   (แถวเด้งกลับ "รออนุมัติ" เอง)
-- รัน "หลัง" 0084 (ต้องมี create_notification overload 9-arg แล้ว) · ไม่มี enum ใหม่ · รันซ้ำได้
--
-- 🔑 ทำไมไม่ต้องแตะ review_production_records (แบบติ๊กหลายแถว)
--    มันวนเรียก review_production_record() รายแถวอยู่แล้ว (0080:189) ⇒ ได้แจ้งเตือนครบทุกใบเอง
--    (เจตนาเดิมของ 0080:164-169 คือ "กติกาอยู่ที่ฟังก์ชันเดียว" — เดินตามนั้นต่อ)
--
-- 🔑 ทำไมไม่ต้องยิงซ้ำให้ role หัวหน้าฝ่ายอื่น
--    has_role() สืบทอด lead → base ทางเดียว (0078:65) ⇒ หัวหน้าเห็นใบของฝ่ายตัวเองอยู่แล้ว
--    และ 0084 ทำให้ผู้บริหาร/แอดมินเห็นทุกแถว ⇒ ยิงใบเดียวก็ถึงครบทุกชั้น
--
-- 🚨 add_production_record ไม่อยู่ในไฟล์นี้ทั้งที่ก็ต้องแจ้ง production_lead เหมือนกัน
--    เพราะก้อน 3 (0086) ต้องแก้ฟังก์ชันเดียวกันนี้อีก 3 จุด (เข้าสถานี / พร้อมเข้าแพ็ค / ข้อมูลไม่ครบ)
--    ⇒ รวมแก้ทีเดียวใน 0086 ดีกว่ายก create or replace ตัวเดียวกัน 2 รอบติด
--
-- 🚨 ทุกฟังก์ชันในไฟล์นี้ยกบอดี้ล่าสุดมา "ทั้งก้อน" แล้ว diff เทียบ (ธรรมเนียมโปรเจค)
--    perform/check_line_clearance ← 0062:178-285 / 294-335
--    add_inprocess_check          ← 0064:103-192
--    review_inprocess_check       ← 0069:63-134
--    review_production_record     ← 0080:92-158
--    reset_production_record_approval ← 0083:285-325
--
-- ℹ️ แจ้งเตือนชุดนี้ส่ง relevant_status = null ทั้งหมด — ไม่ได้ผูกกับสถานะงาน
--    จึงไม่ auto-hide เอง ต้องกด "อ่านแล้ว" (ข้อจำกัดที่รู้ตัว · กลไก auto-hide มีแค่ตัวเดียวคือ 0029:11-13)
-- ============================================================

-- ------------------------------------------------------------
-- (1) perform_line_clearance — บอดี้ 0062:178-285 · เพิ่มแจ้ง ⏳ หัวหน้าฝ่ายผลิต
--     นี่คือข้อที่ทีมรายงานตรง ๆ ว่า "หัวหน้าฝ่ายผลิตไม่ได้จับแจ้งเตือน Line Clearance"
-- ------------------------------------------------------------
create or replace function public.perform_line_clearance(
  p_job_route_id     uuid,
  p_machine_id       uuid,
  p_cleared_old      boolean,
  p_cleaned          boolean,
  p_setup_done       boolean,
  p_setup_minutes    numeric default null,
  p_cleared_old_time time    default null,
  p_cleaned_time     time    default null,
  p_room             text    default null,
  p_headcount        integer default null,
  p_note             text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_job_id  uuid;
  v_step    integer;
  v_st_name text;
  v_mc_code text;
  v_job_no  text;
  v_id      uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_perform_line_clearance() then
    raise exception 'เฉพาะฝ่ายผลิต/หัวหน้าฝ่ายผลิต/ผู้บริหารบันทึก Line Clearance ได้';
  end if;

  select jr.job_id, jr.step_no, s.name
    into v_job_id, v_step, v_st_name
    from public.job_routes jr
    join public.stations s on s.id = jr.station_id
   where jr.id = p_job_route_id;
  if v_job_id is null then raise exception 'ไม่พบขั้นตอนการผลิตที่เลือก'; end if;

  -- เครื่องต้องถูกผูกกับขั้นตอนนี้ไว้แล้ว (0061) — กันทำ LC ให้เครื่องที่ไม่ได้ใช้ในขั้นตอนนี้
  select m.code into v_mc_code
    from public.job_route_machines jrm
    join public.machines m on m.id = jrm.machine_id
   where jrm.job_route_id = p_job_route_id
     and jrm.machine_id   = p_machine_id;
  if v_mc_code is null then
    raise exception 'เครื่องจักรนี้ยังไม่ได้ถูกเลือกไว้ในขั้นตอนที่ % (%) — เลือกเครื่องก่อน', v_step, v_st_name;
  end if;

  if p_setup_minutes is not null and p_setup_minutes < 0 then
    raise exception 'เวลา set-up ห้ามติดลบ';
  end if;
  if p_headcount is not null and p_headcount < 1 then
    raise exception 'จำนวนคนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'บันทึก Line Clearance ขั้นตอนที่ ' || v_step || ' (' || v_st_name || ') เครื่อง ' || v_mc_code, true);

  insert into public.line_clearances
    (job_id, job_route_id, machine_id,
     cleared_old, cleaned, setup_done, setup_minutes,
     cleared_old_time, cleaned_time, room, headcount, note,
     performed_by, performed_at, created_by)
  values
    (v_job_id, p_job_route_id, p_machine_id,
     coalesce(p_cleared_old, false), coalesce(p_cleaned, false),
     coalesce(p_setup_done, false), p_setup_minutes,
     p_cleared_old_time, p_cleaned_time,
     nullif(btrim(coalesce(p_room, '')), ''), p_headcount,
     nullif(btrim(coalesce(p_note, '')), ''),
     v_profile, now(), v_profile)
  on conflict (job_route_id, machine_id) do update
    set cleared_old      = excluded.cleared_old,
        cleaned          = excluded.cleaned,
        setup_done       = excluded.setup_done,
        setup_minutes    = excluded.setup_minutes,
        cleared_old_time = excluded.cleared_old_time,
        cleaned_time     = excluded.cleaned_time,
        room             = excluded.room,
        headcount        = excluded.headcount,
        note             = excluded.note,
        performed_by     = v_profile,
        performed_at     = now(),
        checked_by       = null,   -- บันทึกใหม่ = ต้องยืนยันใหม่
        checked_at       = null,
        updated_by       = v_profile
  returning id into v_id;

  -- 0085: หัวหน้าฝ่ายผลิตเป็นผู้ยืนยันใบนี้ (can_check_line_clearance) แต่เดิมไม่มีอะไรบอกเขาเลย
  --   ⇒ ใบเคลียร์ไลน์ค้างรอลายเซ็นโดยไม่มีใครรู้ · งานติดที่ด่านบันทึกผลผลิต (0063:196-215)
  --   skip_creator = true → คนที่เพิ่งบันทึกเองไม่ต้องได้ใบนี้
  --   (หัวหน้าที่บันทึกเองก็ไม่ได้ — ต้องให้หัวหน้าอีกคนยืนยัน ตามกฎสองลายเซ็น 0062:317-319)
  select job_no into v_job_no from public.jobs where id = v_job_id;
  perform public.create_notification(
    'approval_request',
    'Line Clearance งาน ' || coalesce(v_job_no, '') || ' รอหัวหน้ายืนยัน',
    'ขั้นตอนที่ ' || v_step || ' (' || v_st_name || ') เครื่อง ' || v_mc_code,
    v_job_id, v_job_no, 'production_lead'::app_role, null::job_status, null::uuid, true);

  return v_id;
end;
$fn$;

revoke execute on function public.perform_line_clearance(
  uuid, uuid, boolean, boolean, boolean, numeric, time, time, text, integer, text
) from public;
revoke execute on function public.perform_line_clearance(
  uuid, uuid, boolean, boolean, boolean, numeric, time, time, text, integer, text
) from anon;
grant execute on function public.perform_line_clearance(
  uuid, uuid, boolean, boolean, boolean, numeric, time, time, text, integer, text
) to authenticated;

comment on function public.perform_line_clearance(
  uuid, uuid, boolean, boolean, boolean, numeric, time, time, text, integer, text
) is
  'บันทึก Line Clearance ของ 1 ขั้นตอน × 1 เครื่องจักร (ฝ่ายผลิต) — บันทึกใหม่ล้างลายเซ็นผู้ยืนยันเดิมเสมอ · 0085 แจ้งหัวหน้าฝ่ายผลิตให้มายืนยัน';

-- ------------------------------------------------------------
-- (2) check_line_clearance — บอดี้ 0062:294-335 · เพิ่มแจ้ง ✅ กลับถึงผู้บันทึก (รายบุคคล)
-- ------------------------------------------------------------
create or replace function public.check_line_clearance(p_lc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_lc      record;
  v_job_no  text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_check_line_clearance() then
    raise exception 'เฉพาะหัวหน้าฝ่ายผลิต/ผู้บริหารยืนยัน Line Clearance ได้';
  end if;

  select * into v_lc from public.line_clearances where id = p_lc_id for update;
  if v_lc.id is null or v_lc.performed_by is null then
    raise exception 'ยังไม่มีการบันทึกเคลียร์ไลน์ใบนี้ ให้ฝ่ายผลิตบันทึกก่อน';
  end if;
  if not (v_lc.cleared_old or v_lc.cleaned or v_lc.setup_done) then
    raise exception 'ต้องติ๊กอย่างน้อย 1 ข้อก่อนยืนยัน';
  end if;
  if v_lc.performed_by = v_profile then
    raise exception 'ผู้ยืนยันต้องเป็นคนละคนกับผู้ทำเคลียร์ไลน์ (สองลายเซ็นตามแนว GMP)';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ยืนยัน Line Clearance', true);

  update public.line_clearances
     set checked_by = v_profile, checked_at = now(), updated_by = v_profile
   where id = p_lc_id;

  -- 0085: บอกกลับ "คนที่บันทึกเคลียร์ไลน์" ว่าปลดล็อกให้บันทึกผลผลิตได้แล้ว
  --   ส่งถึงตัวบุคคล (target_profile_id) ไม่ใช่ทั้งฝ่าย — เป็นเรื่องของคนคนเดียว
  select job_no into v_job_no from public.jobs where id = v_lc.job_id;
  perform public.create_notification(
    'approval_result',
    'Line Clearance งาน ' || coalesce(v_job_no, '') || ' ได้รับการยืนยันแล้ว',
    'เริ่มบันทึกผลผลิตของขั้นตอนนี้ได้',
    v_lc.job_id, v_job_no, null::app_role, null::job_status, v_lc.performed_by, false);
end;
$fn$;

revoke execute on function public.check_line_clearance(uuid) from public;
revoke execute on function public.check_line_clearance(uuid) from anon;
grant  execute on function public.check_line_clearance(uuid) to authenticated;

comment on function public.check_line_clearance(uuid) is
  'ยืนยัน Line Clearance 1 ใบ (หัวหน้าฝ่ายผลิต/ผู้บริหาร) — ต้องคนละคนกับผู้ทำ · ติ๊กอย่างน้อย 1 ข้อ · 0085 แจ้งผลกลับผู้บันทึก';

-- ------------------------------------------------------------
-- (3) add_inprocess_check — บอดี้ 0064:103-192 · เพิ่มแจ้ง ⏳ หัวหน้า QC
-- ------------------------------------------------------------
create or replace function public.add_inprocess_check(
  p_job_id               uuid,
  p_job_route_id         uuid,
  p_param                text,
  p_value                text         default null,
  p_unit                 text         default null,
  p_result               check_result default 'pass',
  p_note                 text         default null,
  p_production_record_id uuid         default null,
  p_valid_date           date         default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile    uuid;
  v_id         uuid;
  v_status     job_status;
  v_station_id uuid;
  v_route_job  uuid;
  v_job_no     text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_record_inprocess() then
    raise exception 'เฉพาะ QC/หัวหน้า QC/ผู้บริหารบันทึกผลตรวจระหว่างผลิตได้';
  end if;

  select status into v_status from public.jobs where id = p_job_id;
  if v_status is null then raise exception 'ไม่พบงานที่เลือก'; end if;
  if v_status not in ('in_production', 'qc', 'qa') then
    raise exception 'บันทึกตรวจระหว่างผลิตได้เฉพาะงานที่กำลังผลิต/QC/QA';
  end if;

  p_param := nullif(btrim(coalesce(p_param, '')), '');
  if p_param is null then raise exception 'กรุณาระบุหัวข้อที่ตรวจ'; end if;
  if p_job_route_id is null then raise exception 'กรุณาเลือกขั้นตอนการผลิต'; end if;

  select job_id, station_id into v_route_job, v_station_id
    from public.job_routes where id = p_job_route_id;
  if v_station_id is null then raise exception 'ไม่พบขั้นตอนการผลิตที่เลือก'; end if;
  if v_route_job <> p_job_id then
    raise exception 'ขั้นตอนการผลิตนี้ไม่ใช่ของงานที่เลือก';
  end if;

  if p_production_record_id is not null
     and not exists (
       select 1 from public.production_records
        where id = p_production_record_id
          and job_id = p_job_id
          and (job_route_id = p_job_route_id or station_id = v_station_id)
     ) then
    raise exception 'บันทึกผลผลิตที่เลือกไม่ได้อยู่ในขั้นตอนนี้';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกตรวจระหว่างผลิต ' || p_param, true);

  -- แถวใหม่เริ่มที่ pending เสมอ — ไม่ให้ส่ง status เข้ามาเองได้
  -- (แพทเทิร์นเดียวกับ upsert_job_material ที่ไม่มีพารามิเตอร์ status ให้ส่ง · 0056)
  insert into public.inprocess_checks
    (job_id, job_route_id, station_id, production_record_id,
     param, value, unit, result, valid_date, status, checked_by, note, created_by)
  values
    (p_job_id, p_job_route_id, v_station_id, p_production_record_id, p_param,
     nullif(btrim(coalesce(p_value, '')), ''),
     nullif(btrim(coalesce(p_unit, '')), ''),
     coalesce(p_result, 'pass'), p_valid_date, 'pending', v_profile,
     nullif(btrim(coalesce(p_note, '')), ''), v_profile)
  returning id into v_id;

  -- 0085: แถวใหม่เป็น pending เสมอ (บรรทัดบน) แต่เดิมไม่มีอะไรบอกหัวหน้า QC ว่ามีของรออนุมัติ
  --   skip_creator = true → หัวหน้า QC ที่ลงผลเองไม่ต้องได้ใบนี้
  --   (เขาอนุมัติของตัวเองไม่ได้อยู่แล้ว · 0069:93-95 — ต้องให้หัวหน้าอีกคนมาอนุมัติ)
  select job_no into v_job_no from public.jobs where id = p_job_id;
  perform public.create_notification(
    'approval_request',
    'ผลตรวจระหว่างผลิต งาน ' || coalesce(v_job_no, '') || ' รอหัวหน้า QC อนุมัติ',
    p_param || coalesce(' = ' || nullif(btrim(coalesce(p_value, '')), ''), ''),
    p_job_id, v_job_no, 'qc_lead'::app_role, null::job_status, null::uuid, true);

  return v_id;
end;
$fn$;

revoke execute on function public.add_inprocess_check(
  uuid, uuid, text, text, text, check_result, text, uuid, date
) from public;
revoke execute on function public.add_inprocess_check(
  uuid, uuid, text, text, text, check_result, text, uuid, date
) from anon;
grant execute on function public.add_inprocess_check(
  uuid, uuid, text, text, text, check_result, text, uuid, date
) to authenticated;

comment on function public.add_inprocess_check(
  uuid, uuid, text, text, text, check_result, text, uuid, date
) is
  'บันทึกผลตรวจ in-process (QC) — แถวใหม่เป็น pending เสมอ · 0085 แจ้งหัวหน้า QC ว่ามีผลรออนุมัติ';

-- ------------------------------------------------------------
-- (4) review_inprocess_check — บอดี้ 0069:63-134 · เพิ่มแจ้ง ✅ กลับถึง QC ผู้ลงผล
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
  v_job_no  text;
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

  -- 0085: บอกกลับ "คน QC ที่ลงผล" ว่าผลถูกอนุมัติหรือถูกตีกลับ
  --   เดิมรู้ได้ทางเดียวคือเปิดหน้างานมาไล่ดูเอง (ถ้า reject จะมี Incident Case เด้งไป QA เท่านั้น)
  select job_no into v_job_no from public.jobs where id = v_chk.job_id;
  perform public.create_notification(
    'approval_result',
    case when p_decision = 'approve'
         then 'ผลตรวจ "' || coalesce(v_chk.param, '') || '" ได้รับอนุมัติแล้ว'
         else 'ผลตรวจ "' || coalesce(v_chk.param, '') || '" ไม่ได้รับอนุมัติ' end,
    coalesce(v_note, 'งาน ' || coalesce(v_job_no, '')),
    v_chk.job_id, v_job_no, null::app_role, null::job_status, v_chk.checked_by, false);

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

comment on function public.review_inprocess_check(uuid, text, text) is
  'อนุมัติ/ไม่อนุมัติผลตรวจ in-process (หัวหน้า QC/ผู้บริหาร) — 0085 แจ้งผลกลับผู้ลงผล · ผลไม่ผ่าน/ไม่อนุมัติเปิด Incident Case ให้เอง';

-- ------------------------------------------------------------
-- (5) review_production_record — บอดี้ 0080:92-158 · เพิ่มแจ้ง ✅ กลับถึงผู้บันทึก
-- ------------------------------------------------------------
create or replace function public.review_production_record(
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
  v_rec     public.production_records%rowtype;
  v_note    text;
  v_job_no  text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.can_approve_production_record() then
    raise exception 'เฉพาะหัวหน้าฝ่ายผลิต/ผู้บริหารอนุมัติบันทึกผลผลิตได้';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'คำสั่งไม่ถูกต้อง';
  end if;

  select * into v_rec from public.production_records where id = p_id for update;
  if v_rec.id is null then
    raise exception 'ไม่พบบันทึกผลผลิตที่เลือก';
  end if;
  if v_rec.status <> 'pending' then
    raise exception 'บันทึกนี้ถูกพิจารณาไปแล้ว (สถานะ: %)', v_rec.status;
  end if;

  -- 🔑 สองลายเซ็นตามแนว GMP — เทียบทั้งผู้บันทึกและผู้ปฏิบัติงานที่ระบุไว้ในแถว
  if v_rec.created_by = v_profile or v_rec.operator_id = v_profile then
    raise exception 'ผู้อนุมัติต้องเป็นคนละคนกับผู้บันทึกผลผลิต (สองลายเซ็นตามแนว GMP)';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if p_decision = 'reject' and v_note is null then
    raise exception 'การไม่อนุมัติต้องระบุเหตุผล';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    case when p_decision = 'approve'
         then 'อนุมัติบันทึกผลผลิต'
         else 'ไม่อนุมัติบันทึกผลผลิต' end
    || ' (' || to_char(v_rec.record_date, 'DD/MM/YYYY') || ')', true);

  update public.production_records
     set status       = (case when p_decision = 'approve' then 'approved' else 'rejected' end)::production_record_status,
         approved_by  = v_profile,
         approved_at  = now(),
         approve_note = v_note,
         updated_by   = v_profile
   where id = p_id;

  -- 0085: บอกกลับ "ผู้บันทึก" ว่าแถวถูกอนุมัติหรือถูกตีกลับ (เดิมเงียบสนิท)
  --   ส่งถึงตัวบุคคล ⇒ review_production_records (แบบหลายแถว) ได้ตามไปเองทุกใบ
  --   เพราะมันวนเรียกฟังก์ชันนี้รายแถวอยู่แล้ว (0080:189) — ไม่ต้องแก้ตัว bulk
  select job_no into v_job_no from public.jobs where id = v_rec.job_id;
  perform public.create_notification(
    'approval_result',
    case when p_decision = 'approve'
         then 'บันทึกผลผลิต ' || to_char(v_rec.record_date, 'DD/MM/YYYY') || ' ได้รับอนุมัติ'
         else 'บันทึกผลผลิต ' || to_char(v_rec.record_date, 'DD/MM/YYYY') || ' ไม่ได้รับอนุมัติ' end,
    coalesce(v_note, 'งาน ' || coalesce(v_job_no, '')),
    v_rec.job_id, v_job_no, null::app_role, null::job_status,
    coalesce(v_rec.operator_id, v_rec.created_by), false);
end;
$fn$;

revoke execute on function public.review_production_record(uuid, text, text) from public;
revoke execute on function public.review_production_record(uuid, text, text) from anon;
grant  execute on function public.review_production_record(uuid, text, text) to authenticated;

comment on function public.review_production_record(uuid, text, text) is
  'อนุมัติ/ไม่อนุมัติบันทึกผลผลิต 1 แถว (หัวหน้าฝ่ายผลิต/ผู้บริหาร) — ต้องคนละคนกับผู้บันทึก · ไม่อนุมัติต้องมีเหตุผล · 0085 แจ้งผลกลับผู้บันทึก';

-- ------------------------------------------------------------
-- (6) reset_production_record_approval — บอดี้ 0083:285-325 · เพิ่มแจ้ง ⏳ หัวหน้าฝ่ายผลิต
-- ------------------------------------------------------------
create or replace function public.reset_production_record_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_job_no text;
begin
  if old.status in ('approved', 'rejected')
     and new.status = old.status
     and (
          new.input_qty   is distinct from old.input_qty
       or new.output_qty  is distinct from old.output_qty
       or new.loss_qty    is distinct from old.loss_qty
       or new.minutes     is distinct from old.minutes
       or new.headcount   is distinct from old.headcount
       or new.record_date is distinct from old.record_date
       or new.shift       is distinct from old.shift
       or new.work_period is distinct from old.work_period
       or new.station_id  is distinct from old.station_id
       or new.machine_id  is distinct from old.machine_id
       or new.input_unit  is distinct from old.input_unit
       or new.output_unit is distinct from old.output_unit
       or new.loss_unit   is distinct from old.loss_unit
     )
  then
    new.status       := 'pending';
    new.approved_by  := null;
    new.approved_at  := null;
    new.approve_note := null;

    -- 0085: แถวเด้งกลับ "รออนุมัติ" เองเงียบ ๆ → หัวหน้าไม่รู้ว่าต้องกลับมาอนุมัติใหม่
    --   skip_creator = false โดยตั้งใจ — คนที่เพิ่งอนุมัติ "คำขอแก้ไข" มักเป็นหัวหน้าคนเดิม
    --   และเขาคือคนที่ต้องมากดอนุมัติแถวนี้ใหม่ จึงต้องเห็นใบนี้ด้วย
    select job_no into v_job_no from public.jobs where id = new.job_id;
    perform public.create_notification(
      'approval_request',
      'บันทึกผลผลิต ' || to_char(new.record_date, 'DD/MM/YYYY') || ' ถูกแก้ไข — ต้องอนุมัติใหม่',
      'งาน ' || coalesce(v_job_no, '') || ' · ค่าที่บันทึกไว้เปลี่ยนหลังผ่านการตัดสินไปแล้ว',
      new.job_id, v_job_no, 'production_lead'::app_role, null::job_status, null::uuid, false);
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_reset_prod_approval on public.production_records;
create trigger trg_reset_prod_approval
  before update on public.production_records
  for each row execute function public.reset_production_record_approval();

comment on function public.reset_production_record_approval() is
  'แก้ตัวเลข/หน่วยของบันทึกที่หัวหน้าตัดสินไปแล้ว → เด้งกลับ "รออนุมัติ" + ล้างลายเซ็นเดิม · 0085 แจ้งหัวหน้าฝ่ายผลิตให้มาอนุมัติใหม่';

-- ============================================================
-- ✅ ตรวจหลัง paste (รันใน SQL Editor)
--   select proname, position('create_notification' in prosrc) > 0 as has_notify
--     from pg_proc
--    where proname in ('perform_line_clearance','check_line_clearance','add_inprocess_check',
--                      'review_inprocess_check','review_production_record',
--                      'reset_production_record_approval')
--    order by proname;                       -- ต้องได้ true ครบทั้ง 6 แถว
--
--   select prosecdef from pg_proc where proname='reset_production_record_approval';
--                                           -- ต้องได้ true (definer — ไม่งั้นเรียก create_notification ไม่ได้)
-- ============================================================
