-- ============================================================
-- PD Monitor — Part G / 0096_qa_sample_review.sql  (ก้อน 3)
--   จุดเก็บตัวอย่าง (ตรวจ Finished product): ลูกน้อง QA บันทึก/แก้ · หัวหน้า QA อนุมัติ
--
-- 🎯 โจทย์จากทีม
--   · ลูกน้อง QA เพิ่ม/แก้ไขรายการได้ แต่ "อนุมัติผล ผ่าน/ไม่ผ่าน" + "อนุมัติการแก้ไข" = หัวหน้า QA เท่านั้น
--   · เพิ่มหรือแก้รายการ → แจ้งเตือนหัวหน้า QA ให้มาอนุมัติ
--   ข้อเสนอเพิ่มที่ผู้ใช้ตกลง:
--   · ปล่อยผ่าน FG ไม่ได้ถ้ายังมีจุดเก็บตัวอย่าง "รออนุมัติ"
--   · ลบรายการ = หัวหน้า QA เท่านั้น (กันลูกน้องลบแทนการขออนุมัติ)
--
-- 🔑 แพทเทิร์นเดียวกับผลตรวจ in-process (0064 review_inprocess_check · 0085 แจ้งเตือน)
--   · qa_samples.review_status : pending (รอหัวหน้า QA) / approved
--   · ลูกน้องบันทึกหรือแก้ → pending เสมอ (ผลที่กรอก = "ผลที่เสนอ")
--   · หัวหน้า QA บันทึกหรือแก้เอง → approved ทันที (เขาคือผู้อนุมัติ)
--   · Incident Case อัตโนมัติ (0069) ย้ายไปเกิด "ตอนผลไม่ผ่านได้รับอนุมัติ" เท่านั้น
--     — เหตุผลเดียวกับ 0069:14-16: ไม่เปิดเคสก่อนมีคำตัดสิน
--
-- 📌 has_role('qa_lead') = หัวหน้า QA ตัวจริง หรือ admin (0078:27-29) · ผู้บริหารไม่ผ่าน
--    (ผู้บริหารยังบันทึกได้ตาม can_record_qa_sample() เดิม แต่จะเป็น "รออนุมัติ" เหมือนลูกน้อง)
--
-- 🚨 ยกบอดี้ล่าสุดมา "ทั้งก้อน" (ธรรมเนียมโปรเจค)
--    add_qa_sample ← 0069 · update_qa_sample ← 0069 · delete_qa_sample ← 0066:209-252
--    advance_job_status ← 0095
--
-- รัน "หลัง" 0095 · ไม่มี enum ใหม่ · ไม่เปลี่ยน signature ของ RPC เดิม · รันซ้ำได้
-- ============================================================


-- ------------------------------------------------------------
-- (1) คอลัมน์สถานะการอนุมัติ — แถวเดิมทั้งหมดถือว่า "อนุมัติแล้ว"
--     (ใส่ default 'approved' ตอนเพิ่มคอลัมน์ = backfill แถวเก่า แล้วค่อยเปลี่ยน default เป็น pending)
-- ------------------------------------------------------------
alter table public.qa_samples
  add column if not exists review_status text not null default 'approved',
  add column if not exists reviewed_by   uuid references public.profiles(id),
  add column if not exists reviewed_at   timestamptz;

alter table public.qa_samples alter column review_status set default 'pending';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'qa_samples_review_status_check'
  ) then
    alter table public.qa_samples
      add constraint qa_samples_review_status_check
      check (review_status in ('pending', 'approved'));
  end if;
end $$;

comment on column public.qa_samples.review_status is
  'pending = รอหัวหน้า QA อนุมัติ (ผลที่กรอกเป็นแค่ผลที่เสนอ) · approved = หัวหน้า QA อนุมัติแล้ว (Part G 0096)';


-- ------------------------------------------------------------
-- (2) qa_sample_sync_incident — ผลที่ "อนุมัติแล้ว" กับ Incident Case ให้ตรงกัน
--     ใช้ร่วมกัน 3 ที่: add/update (กรณีหัวหน้า QA ทำเอง) + review_qa_sample
--     · ผลอนุมัติ = ไม่ผ่าน และยังไม่เคยมีเคสของตัวอย่างนี้ → เปิดเคส (0069:188-196)
--     · ผลอนุมัติ ≠ ไม่ผ่าน แต่มีเคสค้างเปิด → ไม่ปิดให้เอง บันทึกหมายเหตุให้ QA ตัดสินใจ (0069:280-291)
--     ไม่ grant ให้ใคร — ให้ RPC ข้างล่างเรียกเท่านั้น
-- ------------------------------------------------------------
create or replace function public.qa_sample_sync_incident(
  p_id      uuid,
  p_profile uuid,
  p_detail  text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.qa_samples%rowtype;
  v_dev uuid;
  v_dev_status text;
begin
  select * into v_row from public.qa_samples where id = p_id;
  if v_row.id is null then return; end if;

  select id, status::text into v_dev, v_dev_status
    from public.deviations where qa_sample_id = p_id;

  if v_row.result = 'fail' then
    if v_dev is null then
      perform public.open_deviation_internal(
        v_row.job_id,
        'ตรวจ Finished product ไม่ผ่าน',
        'จุดเก็บตัวอย่างเมื่อ ' || to_char(v_row.collected_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI')
          || coalesce(' · ' || nullif(btrim(coalesce(p_detail, '')), ''), ''),
        'qa_sample_fail', 'major', null, null, p_id, p_profile);
    end if;
  elsif v_dev is not null and v_dev_status not in ('closed', 'cancelled') then
    insert into public.deviation_comments (deviation_id, role_group, body, created_by)
    values (v_dev, coalesce(public.current_role_group(), 'qa'),
            'ℹ️ ผลตรวจ Finished product ของตัวอย่างที่เป็นต้นเหตุ ถูกอนุมัติเป็น "'
              || coalesce(v_row.result::text, 'ยังไม่ลงผล') || '" — โปรดพิจารณาปิดหรือยกเลิกเคสนี้',
            p_profile);
  end if;
end;
$fn$;

revoke execute on function public.qa_sample_sync_incident(uuid, uuid, text) from public;
revoke execute on function public.qa_sample_sync_incident(uuid, uuid, text) from anon;
revoke execute on function public.qa_sample_sync_incident(uuid, uuid, text) from authenticated;


-- ------------------------------------------------------------
-- (3) add_qa_sample — ยกบอดี้ 0069 · ลูกน้อง = pending + แจ้งหัวหน้า QA · หัวหน้า = approved
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
  v_lead    boolean;
  v_job_no  text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_record_qa_sample() then
    raise exception 'เฉพาะ QA/ผู้บริหารบันทึกจุดเก็บตัวอย่างได้';
  end if;

  select status, job_no into v_status, v_job_no from public.jobs where id = p_job_id;
  if v_status is null then raise exception 'ไม่พบงานที่เลือก'; end if;
  if v_status <> 'qa' then
    raise exception 'บันทึกจุดเก็บตัวอย่างได้เฉพาะงานที่อยู่สถานะ QA';
  end if;

  if p_qty is not null and p_qty < 0 then raise exception 'จำนวนตัวอย่างห้ามติดลบ'; end if;

  v_at := coalesce(p_collected_at, now());
  if v_at > now() + interval '1 day' then
    raise exception 'วันเวลาที่เก็บตัวอย่างล่วงหน้าเกินไป';
  end if;

  v_lead := public.has_role('qa_lead');   -- Part G: หัวหน้า QA บันทึกเอง = อนุมัติในตัว

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกจุดเก็บตัวอย่าง (ตรวจ Finished product)', true);

  insert into public.qa_samples
    (job_id, qty, unit, result, collected_at, collected_by, note, created_by,
     review_status, reviewed_by, reviewed_at)
  values
    (p_job_id, p_qty,
     nullif(btrim(coalesce(p_unit, '')), ''),
     p_result, v_at, v_profile,
     nullif(btrim(coalesce(p_note, '')), ''), v_profile,
     case when v_lead then 'approved' else 'pending' end,
     case when v_lead then v_profile end,
     case when v_lead then now() end)
  returning id into v_id;

  if v_lead then
    -- ผล "ไม่ผ่าน" ที่อนุมัติแล้ว = ต้องมี Incident Case (0069)
    perform public.qa_sample_sync_incident(v_id, v_profile, p_note);
  else
    -- Part G: ลูกน้องบันทึก → หัวหน้า QA ต้องรู้ว่ามีของรออนุมัติ
    perform public.create_notification(
      'approval_request',
      'จุดเก็บตัวอย่าง งาน ' || coalesce(v_job_no, '') || ' รอหัวหน้า QA อนุมัติ',
      'ผลที่เสนอ: ' || case p_result when 'pass' then 'ผ่าน' when 'fail' then 'ไม่ผ่าน' else 'ยังไม่ลงผล' end,
      p_job_id, v_job_no, 'qa_lead'::app_role, null::job_status, null::uuid, true);
  end if;

  return v_id;
end;
$fn$;

revoke execute on function public.add_qa_sample(uuid, numeric, text, check_result, timestamptz, text) from public;
revoke execute on function public.add_qa_sample(uuid, numeric, text, check_result, timestamptz, text) from anon;
grant  execute on function public.add_qa_sample(uuid, numeric, text, check_result, timestamptz, text) to authenticated;


-- ------------------------------------------------------------
-- (4) update_qa_sample — ยกบอดี้ 0069 · ลูกน้องแก้ = กลับเป็น pending + แจ้งหัวหน้า QA
--     หัวหน้า QA แก้เอง = approved + sync Incident (แทนตรรกะ fail/non-fail เดิมของ 0069)
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
  v_lead    boolean;
  v_job_no  text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_record_qa_sample() then
    raise exception 'เฉพาะ QA/ผู้บริหารแก้ไขจุดเก็บตัวอย่างได้';
  end if;

  select * into v_row from public.qa_samples where id = p_id for update;
  if v_row.id is null then raise exception 'ไม่พบรายการที่เลือก'; end if;
  if v_row.deleted_at is not null then raise exception 'รายการนี้ถูกลบไปแล้ว'; end if;

  select status, job_no into v_status, v_job_no from public.jobs where id = v_row.job_id;
  if v_status <> 'qa' then
    raise exception 'แก้ไขจุดเก็บตัวอย่างได้เฉพาะงานที่ยังอยู่สถานะ QA';
  end if;

  if p_qty is not null and p_qty < 0 then raise exception 'จำนวนตัวอย่างห้ามติดลบ'; end if;

  v_at := coalesce(p_collected_at, v_row.collected_at);
  if v_at > now() + interval '1 day' then
    raise exception 'วันเวลาที่เก็บตัวอย่างล่วงหน้าเกินไป';
  end if;

  v_lead := public.has_role('qa_lead');

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'แก้ไขจุดเก็บตัวอย่าง (ตรวจ Finished product)', true);

  update public.qa_samples
     set qty           = p_qty,
         unit          = nullif(btrim(coalesce(p_unit, '')), ''),
         result        = p_result,
         collected_at  = v_at,
         note          = nullif(btrim(coalesce(p_note, '')), ''),
         updated_by    = v_profile,
         review_status = case when v_lead then 'approved' else 'pending' end,
         reviewed_by   = case when v_lead then v_profile end,
         reviewed_at   = case when v_lead then now() end
   where id = p_id;

  if v_lead then
    perform public.qa_sample_sync_incident(p_id, v_profile, 'แก้ผลโดยหัวหน้า QA');
  else
    perform public.create_notification(
      'approval_request',
      'จุดเก็บตัวอย่าง งาน ' || coalesce(v_job_no, '') || ' ถูกแก้ไข — รอหัวหน้า QA อนุมัติ',
      'ผลที่เสนอ: ' || case p_result when 'pass' then 'ผ่าน' when 'fail' then 'ไม่ผ่าน' else 'ยังไม่ลงผล' end,
      v_row.job_id, v_job_no, 'qa_lead'::app_role, null::job_status, null::uuid, true);
  end if;
end;
$fn$;

revoke execute on function public.update_qa_sample(uuid, numeric, text, check_result, timestamptz, text) from public;
revoke execute on function public.update_qa_sample(uuid, numeric, text, check_result, timestamptz, text) from anon;
grant  execute on function public.update_qa_sample(uuid, numeric, text, check_result, timestamptz, text) to authenticated;


-- ------------------------------------------------------------
-- (5) review_qa_sample — ใหม่ · หัวหน้า QA อนุมัติผล ผ่าน / ไม่ผ่าน ของรายการที่รออนุมัติ
--     หัวหน้าเลือกผลสุดท้ายเองได้ (ไม่จำเป็นต้องตรงกับผลที่ลูกน้องเสนอ)
-- ------------------------------------------------------------
create or replace function public.review_qa_sample(
  p_id     uuid,
  p_result check_result
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
  v_job_no  text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.has_role('qa_lead') then
    raise exception 'เฉพาะหัวหน้า QA อนุมัติจุดเก็บตัวอย่างได้';
  end if;
  if p_result is null then raise exception 'กรุณาเลือกผล ผ่าน หรือ ไม่ผ่าน'; end if;

  select * into v_row from public.qa_samples where id = p_id for update;
  if v_row.id is null then raise exception 'ไม่พบรายการที่เลือก'; end if;
  if v_row.deleted_at is not null then raise exception 'รายการนี้ถูกลบไปแล้ว'; end if;
  if v_row.review_status <> 'pending' then raise exception 'รายการนี้อนุมัติไปแล้ว'; end if;

  select status, job_no into v_status, v_job_no from public.jobs where id = v_row.job_id;
  if v_status <> 'qa' then
    raise exception 'อนุมัติจุดเก็บตัวอย่างได้เฉพาะงานที่ยังอยู่สถานะ QA';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'หัวหน้า QA อนุมัติจุดเก็บตัวอย่าง: ' || case p_result when 'pass' then 'ผ่าน' else 'ไม่ผ่าน' end, true);

  update public.qa_samples
     set result        = p_result,
         review_status = 'approved',
         reviewed_by   = v_profile,
         reviewed_at   = now(),
         updated_by    = v_profile
   where id = p_id;

  perform public.qa_sample_sync_incident(p_id, v_profile, v_row.note);

  -- บอกกลับคนที่บันทึก/แก้ล่าสุด (รายบุคคล · แพทเทิร์น 0085 review_inprocess_check)
  perform public.create_notification(
    'approval_result',
    'จุดเก็บตัวอย่าง งาน ' || coalesce(v_job_no, '') || ' อนุมัติแล้ว: '
      || case p_result when 'pass' then 'ผ่าน' else 'ไม่ผ่าน' end,
    null,
    v_row.job_id, v_job_no, null::app_role, null::job_status,
    coalesce(v_row.updated_by, v_row.created_by), false);
end;
$fn$;

revoke execute on function public.review_qa_sample(uuid, check_result) from public;
revoke execute on function public.review_qa_sample(uuid, check_result) from anon;
grant  execute on function public.review_qa_sample(uuid, check_result) to authenticated;

comment on function public.review_qa_sample(uuid, check_result) is
  'หัวหน้า QA อนุมัติผลจุดเก็บตัวอย่าง (ผ่าน/ไม่ผ่าน) · ไม่ผ่าน → เปิด Incident Case อัตโนมัติ (Part G 0096)';


-- ------------------------------------------------------------
-- (6) delete_qa_sample — ยกบอดี้ 0066:209-252 · เปลี่ยนเฉพาะด่านสิทธิ์ → หัวหน้า QA
-- ------------------------------------------------------------
create or replace function public.delete_qa_sample(
  p_id     uuid,
  p_reason text
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
  v_reason  text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.has_role('qa_lead') then
    raise exception 'เฉพาะหัวหน้า QA ลบจุดเก็บตัวอย่างได้';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then raise exception 'กรุณาระบุเหตุผลที่ลบ'; end if;

  select * into v_row from public.qa_samples where id = p_id for update;
  if v_row.id is null then raise exception 'ไม่พบรายการที่เลือก'; end if;
  if v_row.deleted_at is not null then raise exception 'รายการนี้ถูกลบไปแล้ว'; end if;

  select status into v_status from public.jobs where id = v_row.job_id;
  if v_status <> 'qa' then
    raise exception 'ลบจุดเก็บตัวอย่างได้เฉพาะงานที่ยังอยู่สถานะ QA';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ลบจุดเก็บตัวอย่าง: ' || v_reason, true);

  update public.qa_samples
     set deleted_at = now(),
         deleted_by = v_profile,
         updated_by = v_profile
   where id = p_id;
end;
$fn$;

revoke execute on function public.delete_qa_sample(uuid, text) from public;
revoke execute on function public.delete_qa_sample(uuid, text) from anon;
grant  execute on function public.delete_qa_sample(uuid, text) to authenticated;

comment on function public.delete_qa_sample(uuid, text) is
  'ลบจุดเก็บตัวอย่างแบบ soft delete — หัวหน้า QA (Part G 0096) · ต้องระบุเหตุผล · งานต้องยังอยู่สถานะ QA';


-- ------------------------------------------------------------
-- (7) advance_job_status — ยกบอดี้ 0095 · เพิ่มด่านเดียวที่สาขา qa → finished_goods:
--     ยังมีจุดเก็บตัวอย่าง "รอหัวหน้า QA อนุมัติ" = ปล่อยผ่าน FG ไม่ได้
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
    -- Part G (0095): หัวหน้าฝ่ายผลิตเท่านั้น (เดิม production/production_lead) · admin ผ่านตาม has_role
    v_allowed := public.has_role('production_lead');
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
    -- Part G (0095): ทั้ง "QC ผ่าน" และ "QC ตีกลับ" เป็นของหัวหน้า QC เท่านั้น
    v_allowed := public.has_role('qc_lead');
  elsif v_from = 'qc'               and p_to = 'in_production' then
    v_allowed := public.has_role('qc_lead'); v_is_reject := true;
  elsif v_from = 'qa'               and p_to = 'finished_goods' then
    v_allowed := public.has_role('qa');
    -- GATE: ปล่อยผ่าน FG ไม่ได้ถ้ายังมี deviation เปิดค้าง (B3)
    if v_allowed and public.has_open_deviation(p_job_id) then
      raise exception 'ปล่อยผ่าน FG ไม่ได้ — ยังมี deviation เปิดค้าง ต้องปิด (closed) ก่อน';
    end if;
    -- GATE (Part G · 0096): จุดเก็บตัวอย่างที่ยังรอหัวหน้า QA อนุมัติ = ยังไม่มีคำตัดสิน
    if v_allowed and exists (
      select 1 from public.qa_samples
       where job_id = p_job_id and deleted_at is null and review_status = 'pending'
    ) then
      raise exception 'ปล่อยผ่าน FG ไม่ได้ — ยังมีจุดเก็บตัวอย่างรอหัวหน้า QA อนุมัติ';
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


-- ============================================================
-- ✅ ตรวจหลัง paste
--   -- แถวเดิมต้องเป็น approved ทั้งหมด (pending = 0)
--   select review_status, count(*) from public.qa_samples group by review_status;
--   select column_default from information_schema.columns
--    where table_name = 'qa_samples' and column_name = 'review_status';          -- 'pending'::text
--   select proname, count(*) from pg_proc
--    where proname in ('add_qa_sample','update_qa_sample','review_qa_sample','delete_qa_sample',
--                      'qa_sample_sync_incident','advance_job_status')
--    group by proname;                                                            -- ตัวละ 1
--   select prosrc like '%รอหัวหน้า QA อนุมัติ%' from pg_proc where proname = 'advance_job_status'; -- true
--   select prosrc like '%qc_lead%'               from pg_proc where proname = 'advance_job_status'; -- true (ของ 0095 ยังอยู่)
-- ============================================================
