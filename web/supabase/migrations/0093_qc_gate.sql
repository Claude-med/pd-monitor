-- ============================================================
-- PD Monitor — Part F / 0093_qc_gate.sql
--   ด่าน "กำลังผลิต → QC" ตัวใหม่ + บังคับผูกผลตรวจ in-process กับบันทึกผลผลิตรายวัน
--
-- 🎯 โจทย์จากทีม
--   "ในการ์ดขั้นตอนทุกขั้นของงานนั้น ต้องมีบันทึกผลผลิตรายวันที่อนุมัติแล้วอย่างน้อย 1 รายการ
--    และตรวจระหว่างผลิต (In-process QC) ต้องมีครบทุกรายการที่บันทึกผลผลิตรายวันมี
--    จึงจะส่งงานจาก กำลังผลิต ไป QC ได้"
--
-- ของเดิมหลวมกว่านั้นมาก: inprocess_route_complete() (0064:264-284) ขอแค่
-- "มีผลตรวจ in-process ที่ผ่าน + อนุมัติ อย่างน้อย 1 สถานี" ก็ไปต่อได้แล้ว
--
-- กติกาใหม่ 4 ข้อ
--   R0  ต้องมีบันทึกผลผลิตที่ status = 'approved' อย่างน้อย 1 รายการ
--       (กันงานที่ไม่มี route ผ่านฟรี — job_routes ว่าง ⇒ R1 เป็นจริงโดยปริยาย)
--   R1  ทุกขั้นตอนใน job_routes ต้องมีบันทึกผลผลิต 'approved' ที่สถานีนั้น ≥ 1 รายการ
--   R2  ต้องไม่เหลือบันทึกผลผลิตที่ยัง 'pending' (รอหัวหน้าฝ่ายผลิตอนุมัติ)
--   R3  บันทึกผลผลิตที่ 'approved' ทุกใบ ต้องมี in-process check ที่ชี้มาหาด้วย
--       production_record_id และ result='pass' + status='approved'
--
-- 📌 แถวที่ 'rejected' ไม่นับทั้ง R2 และ R3 — ถือว่าถูกตีทิ้งแล้ว
--    ไม่งั้นบันทึกที่หัวหน้ากด "ไม่อนุมัติ" จะทำให้งานติดตลอดกาล
--
-- 📌 ผู้อนุมัติยังแยกกันเหมือนเดิมตามที่ผู้ใช้ยืนยัน (กฎสองลายเซ็น)
--    บันทึกผลผลิตรายวัน = หัวหน้าฝ่ายผลิต (0080) · in-process QC = หัวหน้า QC (0064)
--
-- 🚨 ก่อน paste ไฟล์นี้ ให้รันคำสั่งสำรวจท้ายไฟล์ก่อน — ด่านนี้มีผลกับงานที่กำลังผลิตอยู่ทันที
--
-- รัน "หลัง" 0092 · รันซ้ำได้ (backfill เป็น idempotent)
-- ============================================================


-- ------------------------------------------------------------
-- (1) qc_gate_issues — คืน "รายการสิ่งที่ยังขาด" เป็นข้อความไทย
--
-- 🔑 ทำไมคืน text[] ไม่ใช่ boolean: หน้างานเอาไปแสดงเป็นเช็กลิสต์ "ก่อนส่ง QC ต้องมี…"
--    ได้เลย และ advance_job_status ใช้ชุดเดียวกันไปประกอบข้อความ error
--    ⇒ สิ่งที่ผู้ใช้เห็นบนหน้าจอกับเหตุผลที่ DB ปฏิเสธ ตรงกันเสมอ (ไม่ต้องเขียนกติกาซ้ำ 2 ที่)
-- ------------------------------------------------------------
create or replace function public.qc_gate_issues(p_job_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_out   text[] := '{}';
  v_n     int;
  v_names text;
begin
  if p_job_id is null then
    return array['ไม่พบงานที่เลือก'];
  end if;

  -- R0 ----------------------------------------------------------------
  select count(*) into v_n
    from public.production_records
   where job_id = p_job_id and status = 'approved';
  if v_n = 0 then
    v_out := array_append(v_out,
      'ยังไม่มีบันทึกผลผลิตรายวันที่หัวหน้าฝ่ายผลิตอนุมัติเลยสักรายการ');
  end if;

  -- R1 ----------------------------------------------------------------
  select string_agg(x.label, ' · ' order by x.step_no) into v_names
    from (
      select jr.step_no,
             jr.step_no || '. ' || s.name as label
        from public.job_routes jr
        join public.stations s on s.id = jr.station_id
       where jr.job_id = p_job_id
         and not exists (
           select 1 from public.production_records pr
            where pr.job_id = p_job_id
              and pr.station_id = jr.station_id
              and pr.status = 'approved'
         )
    ) x;
  if v_names is not null then
    v_out := array_append(v_out,
      'ขั้นตอนที่ยังไม่มีบันทึกผลผลิตที่อนุมัติแล้ว: ' || v_names);
  end if;

  -- R2 ----------------------------------------------------------------
  select count(*) into v_n
    from public.production_records
   where job_id = p_job_id and status = 'pending';
  if v_n > 0 then
    v_out := array_append(v_out,
      'ยังมีบันทึกผลผลิตรออนุมัติจากหัวหน้าฝ่ายผลิตอีก ' || v_n || ' รายการ');
  end if;

  -- R3 ----------------------------------------------------------------
  select string_agg(x.label, ' · ' order by x.record_date, x.label) into v_names
    from (
      select pr.record_date,
             to_char(pr.record_date, 'DD/MM') || ' ' || coalesce(s.name, '—') as label
        from public.production_records pr
        left join public.stations s on s.id = pr.station_id
       where pr.job_id = p_job_id
         and pr.status = 'approved'
         and not exists (
           select 1 from public.inprocess_checks ic
            where ic.production_record_id = pr.id
              and ic.result = 'pass'
              and ic.status = 'approved'
         )
    ) x;
  if v_names is not null then
    v_out := array_append(v_out,
      'บันทึกผลผลิตที่ยังไม่มีผลตรวจ In-process (ผ่าน + หัวหน้า QC อนุมัติ): ' || v_names);
  end if;

  return v_out;
end;
$fn$;

revoke execute on function public.qc_gate_issues(uuid) from public;
revoke execute on function public.qc_gate_issues(uuid) from anon;
grant  execute on function public.qc_gate_issues(uuid) to authenticated;

comment on function public.qc_gate_issues(uuid) is
  'สิ่งที่ยังขาดก่อนส่งงานจาก "กำลังผลิต" ไป "QC" (R0–R3 · Part F 0093) — array ว่าง = ผ่าน · ใช้ร่วมกันทั้งเช็กลิสต์บนหน้าจอและ guard ใน advance_job_status';

create or replace function public.ready_for_qc(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(cardinality(public.qc_gate_issues(p_job_id)), 0) = 0;
$$;

revoke execute on function public.ready_for_qc(uuid) from public;
revoke execute on function public.ready_for_qc(uuid) from anon;
grant  execute on function public.ready_for_qc(uuid) to authenticated;


-- ------------------------------------------------------------
-- (2) advance_job_status — เปลี่ยนด่าน in_production → qc ให้ใช้ qc_gate_issues()
--     ยกบอดี้จาก 0062:341-456 · เปลี่ยนเฉพาะสาขานั้น + ตัวแปร v_issues
--     🔴 สาขาอื่นยกมาครบทุกบรรทัด (lot no. · deviation · บล็อกแจ้งเตือน 7-arg)
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
as $fn$
declare
  v_profile   uuid;
  v_from      job_status;
  v_job_no    text;
  v_batch     uuid;
  v_is_reject boolean := false;
  v_allowed   boolean := false;
  v_issues    text[];          -- Part F (0093)
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;

  select status, job_no, batch_id into v_from, v_job_no, v_batch
    from public.jobs where id = p_job_id for update;
  if v_from is null then
    raise exception 'ไม่พบงานนี้';
  end if;
  if v_from = p_to then
    raise exception 'สถานะไม่เปลี่ยนแปลง';
  end if;

  if    v_from = 'pending_announce' and p_to = 'planned' then
    v_allowed := public.can_plan_jobs();          -- Part A: ฝ่ายวางแผน + ผู้บริหาร
  elsif v_from = 'planned'          and p_to = 'in_production' then
    v_allowed := public.has_role('production')
              or public.has_role('production_lead')
              or public.has_role('manager');
    -- GATE (0049): ต้องกรอกเลขล็อตก่อน — เริ่มผลิตแล้วช่องเลขล็อตจะล็อกทันที
    if v_allowed and v_batch is null then
      raise exception 'เริ่มผลิตไม่ได้ — ต้องกรอก LOT No. (Batch NO.) ของงานนี้ก่อน';
    end if;
    -- Part C.3 ก้อน 4: ถอดด่าน Line Clearance ออกจากตรงนี้
    --   ทีมยืนยันว่าคนกด "เริ่มผลิต" เป็นธุรการ ส่วนคนทำ LC คือพนักงานหน้างานในขั้นกำลังผลิต
    --   ด่าน LC ย้ายไปอยู่ที่ add_production_record (กั้นรายสถานี/เครื่อง) แทน
  elsif v_from = 'in_production'     and p_to = 'qc' then
    v_allowed := public.has_role('production') or public.has_role('production_lead');
    -- GATE (Part F · 0093) — เข้มขึ้นจากเดิมที่ขอแค่ "in-process ผ่าน ≥1 สถานี" (0034 · 0064:264-284)
    --   ตอนนี้ต้องครบทั้ง 4 ข้อ (R0–R3) · รายละเอียด + ข้อความไทยอยู่ที่ qc_gate_issues()
    --   หน้างานเรียกฟังก์ชันเดียวกันไปโชว์เป็นเช็กลิสต์ ⇒ ข้อความตรงกันเสมอ
    if v_allowed then
      v_issues := public.qc_gate_issues(p_job_id);
      if coalesce(cardinality(v_issues), 0) > 0 then
        raise exception 'ส่ง QC ไม่ได้ — %', array_to_string(v_issues, ' · ');
      end if;
    end if;
  elsif v_from = 'qc'               and p_to = 'qa' then
    v_allowed := public.has_role('qc') or public.has_role('qc_lead');
  elsif v_from = 'qc'               and p_to = 'in_production' then
    v_allowed := public.has_role('qc') or public.has_role('qc_lead'); v_is_reject := true;
  elsif v_from = 'qa'               and p_to = 'finished_goods' then
    v_allowed := public.has_role('qa');
    -- GATE: ปล่อยผ่าน FG ไม่ได้ถ้ายังมี deviation เปิดค้าง (B3)
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

  -- ---------- แจ้งเตือน ----------
  if v_is_reject then
    perform public.create_notification(
      'reject',
      'งาน ' || v_job_no || ' ถูกตีกลับ',
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'ไม่ระบุเหตุผล'),
      p_job_id, v_job_no, 'production', 'in_production');
  else
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
$fn$;

revoke execute on function public.advance_job_status(uuid, job_status, text) from public;
revoke execute on function public.advance_job_status(uuid, job_status, text) from anon;
grant  execute on function public.advance_job_status(uuid, job_status, text) to authenticated;


-- ------------------------------------------------------------
-- (3) add_inprocess_check — บังคับเลือก "บันทึกผลผลิตรายวัน" ที่ผลตรวจอ้างถึง
--     ยกบอดี้จาก 0085:228-313 · เปลี่ยนเฉพาะด่านตรวจ p_production_record_id
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

  -- Part F (0093): บังคับผูกกับ "บันทึกผลผลิตรายวัน" แบบ 1:1
  --   ด่าน qc_gate_issues() นับว่า "บันทึกใบไหนมีผลตรวจแล้ว" จากคอลัมน์นี้
  --   ถ้ายังปล่อยว่างได้ ด่านจะไม่มีวันผ่าน (พารามิเตอร์ยังมี default null เพื่อไม่ให้ signature เปลี่ยน)
  if p_production_record_id is null then
    raise exception 'กรุณาเลือก "บันทึกผลผลิตรายวัน" ที่ผลตรวจนี้อ้างถึง';
  end if;
  if not exists (
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
grant  execute on function public.add_inprocess_check(
  uuid, uuid, text, text, text, check_result, text, uuid, date
) to authenticated;


-- ------------------------------------------------------------
-- (4) Backfill ครั้งเดียว — ผูกผลตรวจ in-process เดิมเข้ากับบันทึกผลผลิต
--
-- แถวเก่าลงไว้ตอนที่ p_production_record_id ยังเป็นช่องไม่บังคับ ⇒ ว่างอยู่จำนวนมาก
-- ถ้าไม่ผูกให้ กติกา R3 จะไม่มีวันผ่านสำหรับงานที่ทำค้างอยู่
--
-- 🔒 ผูกเฉพาะกรณีที่ "ไม่มีทางเดาผิด" — งาน+สถานีนั้นมีบันทึกผลผลิตอยู่รายการเดียว
--    เคสกำกวม (มีหลายรายการ) ปล่อย null ไว้ แล้วให้ขึ้นในเช็กลิสต์ให้คนตามเก็บเอง
--    (แพทเทิร์นเดียวกับ backfill ที่จับคู่ 1:1 ครบ 21/21 ใบใน 0088)
-- ------------------------------------------------------------
do $backfill$
begin
  perform set_config(
    'app.audit_reason',
    'Part F (0093): ผูกผลตรวจ in-process เดิมเข้ากับบันทึกผลผลิตรายวันอัตโนมัติ (เฉพาะกรณีที่มีผู้สมัครรายการเดียว)',
    true);

  update public.inprocess_checks ic
     set production_record_id = pr.id
    from public.production_records pr
   where ic.production_record_id is null
     and pr.job_id     = ic.job_id
     and pr.station_id = ic.station_id
     and (
       select count(*) from public.production_records p2
        where p2.job_id = ic.job_id and p2.station_id = ic.station_id
     ) = 1;
end;
$backfill$;


-- ============================================================
-- 🚨 รันคำสั่งนี้ "ก่อน" paste ไฟล์นี้ — ดูว่าด่านใหม่กระทบงานที่กำลังผลิตอยู่กี่ใบ
--   (ถ้ามีเยอะ ให้บอกฝ่ายผลิต/QC ล่วงหน้าว่าต้องตามเก็บอะไรบ้าง)
--
--   select j.job_no, public.qc_gate_issues(j.id) as ยังขาด
--     from public.jobs j
--    where j.status = 'in_production'
--    order by j.job_no;
--
-- ✅ ตรวจหลัง paste
--   select proname from pg_proc where proname in ('qc_gate_issues','ready_for_qc');   -- 2 แถว
--   select prosrc like '%qc_gate_issues%' from pg_proc where proname = 'advance_job_status';  -- true
--   select prosrc like '%กรุณาเลือก%'      from pg_proc where proname = 'add_inprocess_check'; -- true
--
--   -- ผลของ backfill
--   select count(*) filter (where production_record_id is null)     as ยังไม่ผูก,
--          count(*) filter (where production_record_id is not null) as ผูกแล้ว
--     from public.inprocess_checks;
--
-- ℹ️ inprocess_route_complete() (0064) ยังอยู่ในฐานข้อมูล แต่ไม่มีใครเรียกแล้ว
--    ตั้งใจไม่ drop — กันของเก่าที่อาจอ้างถึง และไม่มีผลข้างเคียงถ้าไม่ถูกเรียก
-- ============================================================
