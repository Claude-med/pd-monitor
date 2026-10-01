-- ============================================================
-- PD Monitor — รีวิวก่อนทดสอบรอบ 2 / 0105_review_hardening.sql
-- ปิดช่องโหว่ร้ายแรงที่เจอตอนรีวิวทั้งระบบ (1 ต.ค. 69)
--   (1) บัญชีที่ถูกระงับ/ลบ ยังเรียก RPC ได้       → helper ตัวตน/สิทธิ์ทั้ง 5 ตัวเช็ก is_active + deleted_at
--   (2) ข้ามลายเซ็น QC/QA ได้ (C2)                → advance_job_status ขยับออกจาก qc/qa ได้เฉพาะเมื่อมาจาก sign_job_decision
--   (3) ปล่อยผ่าน FG = หัวหน้า QA เท่านั้น (C6)    → advance_job_status + sign_job_decision
--   (4) ลบงานหลังเริ่มผลิต = ผู้บริหาร/admin (C7) → delete_job
--   (5) วันที่ "วันนี้" ใน DB เป็นเวลาไทย (C4)     → alter function ... set timezone (ไม่ต้องคัดลอกตัวฟังก์ชัน)
-- รัน "หลัง" 0104 · รันซ้ำได้
--
-- ⚠️ ฟังก์ชันที่ตั้ง timezone ในข้อ (5): add_production_record · edit_draft · add_fg_dispatch · notify_machine_due
--    migration ในอนาคตที่ "create or replace" ฟังก์ชันพวกนี้ ต้องใส่ `set timezone = 'Asia/Bangkok'`
--    คู่กับ `set search_path` ด้วย ไม่งั้นค่านี้จะหายไป (create or replace แทนที่ SET ทั้งชุด)
-- ============================================================

-- ------------------------------------------------------------
-- (1) helper ตัวตน/สิทธิ์ — ไม่นับโปรไฟล์ที่ถูกระงับ (is_active = false) หรือถูกลบ (deleted_at)
--
--     เดิมด่านระงับบัญชีอยู่ที่ (app)/layout.tsx อย่างเดียว:
--       · access token ที่ออกก่อนถูกแบนยังใช้ได้อีก ~1 ชม. → ยิง RPC ตรงได้ครบ
--       · โปรไฟล์ที่ระงับด้วยธงอย่างเดียว (ไม่มี ban ที่ชั้น Auth) ไม่ถูกกันเลยที่ DB
--     guard ทั้งระบบผ่าน 5 ตัวนี้ ⇒ แก้ตรงนี้ที่เดียวครอบทั้งระบบ
--     ผลกับผู้ใช้ที่ถูกระงับ: ทุก RPC ตอบ "ยังไม่ได้เข้าสู่ระบบ" / "ไม่มีสิทธิ์"
--     (ยกบอดี้จาก 0005 · 0078 · 0067 · 0095 · 0079 — เพิ่มแค่เงื่อนไข is_active / deleted_at)
-- ------------------------------------------------------------
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles
   where auth_user_id = (select auth.uid())
     and is_active
     and deleted_at is null
   limit 1;
$$;

create or replace function public.has_role(_role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.profiles p on p.id = ur.profile_id
     where p.auth_user_id = (select auth.uid())
       and p.is_active
       and p.deleted_at is null
       and (
            ur.role = _role                           -- มี role นั้นตรง ๆ
         or ur.role::text = 'admin'                   -- admin ผ่านทุก role (0013)
         or ur.role::text = _role::text || '_lead'    -- หัวหน้าฝ่าย ผ่านสิทธิ์ของฝ่ายตัวเอง (0078)
       )
  );
$$;

create or replace function public.has_exact_role(_role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.profiles p on p.id = ur.profile_id
     where p.auth_user_id = (select auth.uid())
       and p.is_active
       and p.deleted_at is null
       and ur.role = _role
  );
$$;

create or replace function public.is_any_lead()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.profiles p on p.id = ur.profile_id
     where p.auth_user_id = (select auth.uid())
       and p.is_active
       and p.deleted_at is null
       and right(ur.role::text, 5) = '_lead'
  );
$$;

create or replace function public.current_head_depts()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct public.dept_of_role(ur.role)), '{}'::text[])
    from public.user_roles ur
    join public.profiles p on p.id = ur.profile_id
   where p.auth_user_id = (select auth.uid())
     and p.is_active
     and p.deleted_at is null
     and right(ur.role::text, 5) = '_lead'
     and public.dept_of_role(ur.role) is not null;
$$;


-- ------------------------------------------------------------
-- (2)+(3) advance_job_status — ยกบอดี้ 0099 · เปลี่ยน 2 จุด
--     · ออกจาก qc / qa ได้เฉพาะเมื่อ app.esign = 'on' (ตั้งโดย sign_job_decision)
--     · qa → finished_goods ต้องเป็นหัวหน้า QA
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
  -- 0105: ขั้นตัดสินคุณภาพ (ออกจาก qc / qa) ต้องมาจาก sign_job_decision เท่านั้น
  v_esign     boolean := coalesce(current_setting('app.esign', true), '') = 'on';
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

  -- 0105 (รีวิว 1 ต.ค. 69): ปิดช่อง "ข้ามลายเซ็น" — เดิมเรียกฟังก์ชันนี้ตรง ๆ (ผ่าน changeStatus)
  --   ก็ขยับ qc→qa / qa→FG ได้ โดยไม่ยืนยันรหัสผ่านและไม่มีแถวในตาราง approvals
  --   sign_job_decision ตั้ง app.esign = 'on' (เฉพาะ transaction นั้น) ก่อนเรียกฟังก์ชันนี้
  if v_from in ('qc', 'qa') and not v_esign then
    raise exception 'ขั้น % ต้องลงนามด้วยรหัสผ่าน (ใช้ปุ่มลงนาม)', upper(v_from::text);
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
    -- 0105 (ผู้ใช้เลือก 1 ต.ค. 69): ปล่อยผ่าน FG = หัวหน้า QA เท่านั้น (เหมือนฝั่ง QC) · ตีกลับยังเป็นของ QA ทุกคน
    v_allowed := public.has_role('qa_lead');
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
    -- GATE (Part H · 0099): คำขอแก้ไขจุดเก็บตัวอย่างที่ยังค้าง = ข้อมูลตัวอย่างยังไม่นิ่ง
    if v_allowed and exists (
      select 1 from public.edit_requests
       where job_id = p_job_id and target_type = 'qa_sample' and status = 'pending'
    ) then
      raise exception 'ปล่อยผ่าน FG ไม่ได้ — ยังมีคำขอแก้ไขจุดเก็บตัวอย่างรอหัวหน้า QA อนุมัติ';
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
-- (2)+(3) sign_job_decision — ยกบอดี้ 0095 · เพิ่ม 2 จุด
--     · ขั้น qa + approve (ปล่อยผ่าน FG) ต้องเป็นหัวหน้า QA · ตีกลับยังเป็นของ QA ทุกคน
--     · ตั้ง app.esign = 'on' ก่อนเรียก advance_job_status
-- ------------------------------------------------------------
create or replace function public.sign_job_decision(
  p_job_id   uuid,
  p_stage    text,
  p_decision text,
  p_reason   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_from    job_status;
  v_to      job_status;
  v_id      uuid;
begin
  -- ต้องล็อกอิน
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;

  if p_stage not in ('qc', 'qa') then
    raise exception 'ขั้นลงนามไม่ถูกต้อง';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'ผลตัดสินไม่ถูกต้อง';
  end if;

  -- ตรวจสิทธิ์ตามขั้น (หัวหน้า QC เซ็นขั้น QC — Part G 0095 · QA เซ็นขั้น QA)
  if p_stage = 'qc' and not public.has_role('qc_lead') then
    raise exception 'ต้องเป็นหัวหน้า QC จึงลงนามขั้นนี้ได้';
  end if;
  if p_stage = 'qa' and p_decision = 'approve' and not public.has_role('qa_lead') then
    raise exception 'ต้องเป็นหัวหน้า QA จึงลงนามปล่อยผ่าน FG ได้';
  end if;
  if p_stage = 'qa' and not public.has_role('qa') then
    raise exception 'ต้องเป็น QA จึงลงนามขั้นนี้ได้';
  end if;

  -- ตีกลับต้องมีเหตุผล
  if p_decision = 'reject' and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'การไม่ผ่าน (reject) ต้องระบุเหตุผล';
  end if;

  -- หาสถานะปลายทางจากขั้น + ผลตัดสิน
  if    p_stage = 'qc' and p_decision = 'approve' then v_to := 'qa';
  elsif p_stage = 'qc' and p_decision = 'reject'  then v_to := 'in_production';
  elsif p_stage = 'qa' and p_decision = 'approve' then v_to := 'finished_goods';
  else  /* qa + reject */                              v_to := 'in_production';
  end if;

  -- งานต้องอยู่ขั้นที่ลงนามจริง (ล็อกแถวกัน concurrent)
  select status into v_from from public.jobs where id = p_job_id for update;
  if v_from is null then
    raise exception 'ไม่พบงานนี้';
  end if;
  if v_from::text <> p_stage then
    raise exception 'งานนี้ไม่ได้อยู่ขั้น % (สถานะปัจจุบัน: %)', upper(p_stage), v_from;
  end if;

  -- บันทึกลายเซ็น + audit attribution
  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config(
    'app.audit_reason',
    'ลงนาม ' || upper(p_stage) || ' — ' ||
      case when p_decision = 'approve' then 'อนุมัติ' else 'ตีกลับ' end,
    true
  );

  insert into public.approvals (job_id, profile_id, stage, decision, reason, created_by)
  values (p_job_id, v_profile, p_stage, p_decision,
          nullif(btrim(coalesce(p_reason, '')), ''), v_profile)
  returning id into v_id;

  -- 0105: ยืนยันกับ advance_job_status ว่าการขยับนี้มาจากการลงนาม (มีผลเฉพาะ transaction นี้)
  perform set_config('app.esign', 'on', true);

  -- ขยับสถานะผ่านด่านเดิม (re-check ลำดับ/สิทธิ์/เหตุผล + เขียน audit ของ jobs)
  perform public.advance_job_status(p_job_id, v_to, p_reason);

  return v_id;
end;
$$;
grant execute on function public.sign_job_decision(uuid, text, text, text) to authenticated;


-- ------------------------------------------------------------
-- (4) delete_job — ยกบอดี้ 0095 · เพิ่มด่านสถานะ
-- ------------------------------------------------------------
create or replace function public.delete_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_job_no  text;
  v_order   uuid;
  v_batch   uuid;
  v_status  job_status;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not (public.has_role('manager') or public.has_role('admin') or public.is_any_lead()) then
    raise exception 'เฉพาะหัวหน้าแผนก/ผู้บริหาร/ผู้ดูแลระบบลบงานได้';
  end if;

  select job_no, order_id, batch_id, status into v_job_no, v_order, v_batch, v_status
    from public.jobs where id = p_job_id for update;
  if v_job_no is null then raise exception 'ไม่พบงานที่จะลบ'; end if;

  -- 0105 (ผู้ใช้เลือก 1 ต.ค. 69): งานที่เริ่มผลิตแล้วมีบันทึกผลผลิต/ผลตรวจ/ลายเซ็น
  --   ซึ่งถูกลบตามแบบ cascade → หัวหน้าแผนกลบได้เฉพาะก่อนเริ่มผลิต · หลังจากนั้นเฉพาะผู้บริหาร/admin
  if v_status not in ('pending_announce', 'planned')
     and not (public.has_role('manager') or public.has_role('admin')) then
    raise exception 'งานที่เริ่มผลิตแล้ว ลบได้เฉพาะผู้บริหาร';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ลบงาน ' || v_job_no, true);

  -- 0086: แจ้งฝ่ายวางแผนว่างานถูกยกเลิก (ระบบไม่มีสถานะ 'cancelled' — "ยกเลิกงาน" = ลบงาน)
  --
  -- 🚨 ต้องยิง "ก่อน" delete และต้องส่ง p_job_id = null เด็ดขาด
  --    notifications.job_id เป็น on delete cascade (0026:18) ⇒ ถ้าผูก job_id ไว้
  --    แจ้งเตือนใบนี้จะถูกลบทิ้งพร้อมงานในบรรทัดถัดไปทันที (ไม่มีใครได้เห็นเลย)
  --    job_no เก็บแยกเป็น text อยู่แล้วด้วยเหตุผลนี้พอดี (0026:19 "เก็บไว้ทำลิงก์ กันงานถูกลบ")
  --    skip_creator = true → คนที่กดลบเองไม่ต้องได้ใบแจ้งของตัวเอง
  perform public.create_notification(
    'job_plan',
    'งาน ' || v_job_no || ' ถูกยกเลิก (ลบออกจากระบบ)',
    'ข้อมูลทั้งหมดของงานนี้ถูกลบแล้ว — ดูร่องรอยได้ที่หน้าประวัติ/Audit',
    null::uuid, v_job_no, 'planner'::app_role, null::job_status, null::uuid, true);

  -- ลบงาน → ตารางลูก on delete cascade ลบตาม (trigger audit ของแต่ละตารางยังทำงาน)
  delete from public.jobs where id = p_job_id;

  -- ลบ batch ที่กำพร้า (ไม่มีงานอื่นใช้)
  if v_batch is not null
     and not exists (select 1 from public.jobs where batch_id = v_batch) then
    delete from public.batches where id = v_batch;
  end if;

  -- ลบ order ที่กำพร้า (ไม่มีงาน/แบตช์อื่นใช้)
  if v_order is not null
     and not exists (select 1 from public.jobs    where order_id = v_order)
     and not exists (select 1 from public.batches where order_id = v_order) then
    delete from public.orders where id = v_order;
  end if;
end;
$$;
grant execute on function public.delete_job(uuid) to authenticated;

comment on function public.delete_job(uuid) is
  'ลบงาน — ผู้บริหาร/admin ทุกสถานะ · หัวหน้าแผนกเฉพาะก่อนเริ่มผลิต (0105) — ตารางลูก cascade ตาม · แจ้งฝ่ายวางแผนว่างานถูกยกเลิก';


-- ------------------------------------------------------------
-- (5) "วันนี้" ในฟังก์ชันที่เทียบ current_date → ใช้เวลาไทย
--     DB ของ Supabase เป็น UTC ⇒ current_date ช่วง 00:00–07:00 ของไทยคือ "เมื่อวาน"
--     กะดึกบันทึกวันที่ของวันนี้แล้วโดนว่า "วันในอนาคต"
--     ตั้ง timezone ระดับฟังก์ชัน = มีผลเฉพาะตอนฟังก์ชันนั้นทำงาน ไม่กระทบส่วนอื่นของระบบ
--     วนตาม pg_proc ⇒ ไม่ต้องรู้ signature และครอบทุก overload
-- ------------------------------------------------------------
do $tz$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('add_production_record', 'edit_draft', 'add_fg_dispatch', 'notify_machine_due')
  loop
    execute format('alter function %s set timezone = %L', r.sig, 'Asia/Bangkok');
  end loop;
end;
$tz$;


-- ============================================================
-- ✅ ตรวจหลัง paste (รันทีละข้อ)
--
-- ข้อ 1 · helper ทั้ง 5 ตัวเช็กการระงับบัญชีแล้ว
--   select proname, prosrc like '%is_active%' and prosrc like '%deleted_at%' as ok
--     from pg_proc
--    where proname in ('current_profile_id','has_role','has_exact_role','is_any_lead','current_head_depts')
--    order by proname;
--   ✅ ต้องได้ 5 แถว ok = true ทุกแถว
--   ❌ ถ้ามีแถว false = ไฟล์นี้รันไม่ครบ → paste ใหม่ทั้งไฟล์
--
-- ข้อ 2 · ด่านลายเซ็น + หัวหน้า QA ใน advance_job_status (และด่านเดิมยังอยู่ครบ)
--   select prosrc like '%app.esign%'
--      and prosrc like '%has_role(''qa_lead'')%'
--      and prosrc like '%qc_gate_issues%'
--      and prosrc like '%ยังมีคำขอแก้ไขจุดเก็บตัวอย่าง%'
--     from pg_proc where proname = 'advance_job_status';
--   ✅ true   ❌ false = ไฟล์นี้ยังไม่ได้รัน หรือด่านเดิมหาย → แจ้ง Claude
--
-- ข้อ 3 · sign_job_decision ตั้ง app.esign + ปล่อยผ่านต้องเป็นหัวหน้า QA
--   select prosrc like '%app.esign%' and prosrc like '%หัวหน้า QA จึงลงนามปล่อยผ่าน%'
--     from pg_proc where proname = 'sign_job_decision';
--   ✅ true   ❌ false = ไฟล์นี้ยังไม่ได้รัน
--
-- ข้อ 4 · delete_job มีด่านสถานะ
--   select prosrc like '%งานที่เริ่มผลิตแล้ว ลบได้เฉพาะผู้บริหาร%' from pg_proc where proname = 'delete_job';
--   ✅ true   ❌ false = ไฟล์นี้ยังไม่ได้รัน
--
-- ข้อ 5 · ฟังก์ชันใช้เวลาไทย
--   select proname, proconfig from pg_proc
--    where proname in ('add_production_record','edit_draft','add_fg_dispatch','notify_machine_due')
--    order by proname;
--   ✅ ได้ 4 แถว ทุกแถวมี timezone=Asia/Bangkok ใน proconfig (คู่กับ search_path=public)
--   ❌ ได้น้อยกว่า 4 แถว = มีฟังก์ชันที่ยังไม่ได้ลง → แจ้ง Claude
--
-- ข้อ 6 · ไม่มี overload ซ้อน
--   select proname, count(*) from pg_proc
--    where proname in ('advance_job_status','sign_job_decision','delete_job') group by proname;
--   ✅ ตัวละ 1   ❌ ได้ 2 = มี signature เก่าค้าง → แจ้ง Claude
-- ============================================================
