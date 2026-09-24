-- ============================================================
-- PD Monitor — Part G / 0095_lead_transitions_delete.sql  (ก้อน 2)
--   ย้ายสิทธิ์ "ส่งงานต่อ" ไปให้หัวหน้า + เปิดให้หัวหน้าทุกแผนกลบงานได้
--
-- 🎯 โจทย์จากทีม
--   · กำลังผลิต → QC       = "หัวหน้าฝ่ายผลิต" เท่านั้น (เดิมลูกน้องฝ่ายผลิตกดได้)
--   · QC → QA / QC ตีกลับ   = "หัวหน้า QC" เท่านั้น (ผู้ใช้ยืนยันให้ตีกลับเป็นของหัวหน้าด้วย)
--   · ปุ่ม "ลบงานนี้"       = หัวหน้าทุกแผนก ลบได้ทุกขั้น (ผู้ใช้ยืนยัน "ตามที่ขอทุกประการ")
--                           — ยังต้องกรอกรหัสผ่านยืนยัน (ฝั่งแอป deleteJob) เหมือนเดิม
--
-- 📌 ผู้บริหาร (manager) "ไม่" ได้กดแทนหัวหน้าในขั้นส่งต่อ (ผู้ใช้เลือก) · admin ผ่านตาม has_role (0013)
--    has_role('<x>_lead') = จริงเฉพาะคนที่ถือ role หัวหน้านั้นตรง ๆ หรือ admin (0078:27-29)
--
-- 🚨 ยกบอดี้ล่าสุดมา "ทั้งก้อน" (ธรรมเนียมโปรเจค)
--    advance_job_status ← 0093:146-271 · sign_job_decision ← 0008 · delete_job ← 0086:181-240
--
-- รัน "หลัง" 0094 · ไม่มี enum ใหม่ · ไม่เปลี่ยน signature · รันซ้ำได้
-- ============================================================


-- ------------------------------------------------------------
-- (1) is_any_lead — ผู้ใช้ถือ role หัวหน้าแผนก (<ฝ่าย>_lead) ตัวใดตัวหนึ่งไหม
--     เทียบชื่อ role แบบ text (ลงท้าย _lead) → role หัวหน้าตัวใหม่ในอนาคตได้สิทธิ์เองอัตโนมัติ
-- ------------------------------------------------------------
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
       and right(ur.role::text, 5) = '_lead'
  );
$$;

revoke execute on function public.is_any_lead() from public;
revoke execute on function public.is_any_lead() from anon;
grant  execute on function public.is_any_lead() to authenticated;

comment on function public.is_any_lead() is
  'ผู้ใช้ถือ role หัวหน้าแผนก (<ฝ่าย>_lead) ตัวใดตัวหนึ่งไหม — ใช้กับสิทธิ์ลบงาน (Part G 0095) · ต้องตรงกับ isAnyLead() ใน web/lib/auth/roles.ts';


-- ------------------------------------------------------------
-- (2) advance_job_status — ยกบอดี้ 0093:146-271 · เปลี่ยนเฉพาะ v_allowed ของ 3 สาขา
--     in_production→qc · qc→qa · qc→in_production  (สาขาอื่น + ด่าน + แจ้งเตือน คงเดิมทุกบรรทัด)
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
-- (3) sign_job_decision — ยกบอดี้ 0008 · ขั้น QC ต้องเป็นหัวหน้า QC
--     (advance_job_status ข้างบนเช็กซ้ำอีกชั้นอยู่แล้ว · ตรงนี้ให้ข้อความ error ชัดก่อนบันทึกลายเซ็น)
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

  -- ขยับสถานะผ่านด่านเดิม (re-check ลำดับ/สิทธิ์/เหตุผล + เขียน audit ของ jobs)
  perform public.advance_job_status(p_job_id, v_to, p_reason);

  return v_id;
end;
$$;

grant execute on function public.sign_job_decision(uuid, text, text, text) to authenticated;


-- ------------------------------------------------------------
-- (4) delete_job — ยกบอดี้ 0086:181-240 · เปลี่ยนเฉพาะด่านสิทธิ์
--     ผู้บริหาร / admin / หัวหน้าทุกแผนก ลบได้ทุกสถานะ (รอแจ้งผลิต → เข้าคลัง)
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
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not (public.has_role('manager') or public.has_role('admin') or public.is_any_lead()) then
    raise exception 'เฉพาะหัวหน้าแผนก/ผู้บริหาร/ผู้ดูแลระบบลบงานได้';
  end if;

  select job_no, order_id, batch_id into v_job_no, v_order, v_batch
    from public.jobs where id = p_job_id for update;
  if v_job_no is null then raise exception 'ไม่พบงานที่จะลบ'; end if;

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
  'ลบงาน (หัวหน้าทุกแผนก/ผู้บริหาร/แอดมิน · Part G 0095) — ตารางลูก cascade ตาม · แจ้งฝ่ายวางแผนว่างานถูกยกเลิก (ใบแจ้งไม่ผูก job_id เพื่อไม่ให้ถูก cascade ลบตาม)';


-- ============================================================
-- ✅ ตรวจหลัง paste
--   select proname from pg_proc where proname = 'is_any_lead';                                        -- 1 แถว
--   select prosrc like '%has_role(''qc_lead'')%'    from pg_proc where proname = 'advance_job_status';  -- true
--   select prosrc like '%has_role(''production'')%' from pg_proc where proname = 'advance_job_status';  -- true (สาขา "เริ่มผลิต" ยังใช้ — ไม่ใช่ปัญหา)
--   select prosrc like '%qc_gate_issues%'           from pg_proc where proname = 'advance_job_status';  -- true (ด่าน Part F ยังอยู่)
--   select prosrc like '%หัวหน้า QC%'               from pg_proc where proname = 'sign_job_decision';   -- true
--   select prosrc like '%is_any_lead%'              from pg_proc where proname = 'delete_job';          -- true
--   -- ไม่มี overload ซ้อน (ต้องได้ตัวละ 1)
--   select proname, count(*) from pg_proc
--    where proname in ('advance_job_status','sign_job_decision','delete_job') group by proname;
-- ============================================================
