-- ============================================================
-- PD Monitor — Part 3 ก้อน 3 / 0049_job_lot_entry.sql
-- ฝ่ายผลิตกรอก LOT No. (Batch NO.) ให้งาน — ปิดช่องว่างที่ 0048 เปิดไว้
--
--   ก้อน 2 ตัดช่องเลขล็อตออกจากหน้าสร้างงาน (ฝ่ายวางแผนไม่รู้เลขล็อต)
--   แต่ยังไม่มีที่ให้ฝ่ายผลิตกรอก → งานที่สร้างใหม่ batch_id = null ค้างตลอด
--   ทำให้ eBR / ไล่ย้อนล็อต (genealogy) / FG ไม่มีเลขล็อตอ้างอิงเลย
--
--   (1) can_set_job_lot()  — สิทธิ์กรอกเลขล็อต = ฝ่ายผลิต/ผู้บริหาร
--   (2) set_job_lot()      — ผูกเลขล็อต+วันผลิต/หมดอายุ · ล็อกเมื่อเข้า in_production
--   (3) เปิด realtime ให้ batches — ของเดิม 0009 ใส่ไว้แค่ jobs/production_records/approvals
--   (4) advance_job_status — เพิ่มด่าน "ไม่มีเลขล็อต = เริ่มผลิตไม่ได้"
--
-- ℹ️ Batch NO. = LOT No. ตัวเดียวกัน (ผู้ใช้ยืนยัน) — เก็บที่ batches.lot_no เหมือนเดิม
-- ℹ️ ไม่มีตารางใหม่ — batches มี meta trigger (0001) + audit trigger (0002) + RLS (0003) ครบแล้ว
-- รัน "หลัง" 0001–0048
-- ============================================================

-- ------------------------------------------------------------
-- (1) can_set_job_lot — ใครกรอกเลขล็อตให้งานได้
--     ฝ่ายผลิตเป็นคนรู้เลขล็อตจริงหน้างาน · ผู้บริหารกรอกแทนได้
--     (admin ผ่านเองจาก has_role — 0013:33)
-- ------------------------------------------------------------
create or replace function public.can_set_job_lot()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('production') or public.has_role('manager');
$$;

grant execute on function public.can_set_job_lot() to authenticated;

comment on function public.can_set_job_lot() is
  'สิทธิ์กรอก LOT No. ให้งานผลิต = ฝ่ายผลิต/ผู้บริหาร — ต้องตรงกับ canSetJobLot() ใน web/lib/data/role-access.ts';

-- ------------------------------------------------------------
-- (2) set_job_lot — ผูกเลขล็อตให้งาน (สร้าง batch ให้ถ้ายังไม่มี)
--
--     ⚠️ ด่าน GMP: กรอก/แก้ได้เฉพาะก่อนเริ่มผลิตเท่านั้น
--        เข้า in_production แล้ว = เอกสารการผลิตอ้างเลขล็อตนี้ไปแล้ว
--        ต้องแก้ผ่านคำขอแก้ไขย้อนหลัง (edit request) เท่านั้น
--     ℹ️ p_mfg_date / p_exp_date รับตั้งแต่แรกแม้ยังไม่ได้ใช้ทุกจอ —
--        กันการเปลี่ยน signature รอบหน้า (ต้อง drop function ซ้ำ = gotcha เดิม)
-- ------------------------------------------------------------
create or replace function public.set_job_lot(
  p_job_id   uuid,
  p_lot_no   text,
  p_mfg_date date default null,
  p_exp_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_job     record;
  v_lot     text;
  v_batch   uuid;
  v_label   text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.can_set_job_lot() then
    raise exception 'เฉพาะฝ่ายผลิต/ผู้บริหารกรอกเลขล็อตได้';
  end if;

  select j.id, j.job_no, j.status, j.batch_id, o.id as order_id, o.product_id
    into v_job
    from public.jobs j
    join public.orders o on o.id = j.order_id
   where j.id = p_job_id;

  if v_job.id is null then
    raise exception 'ไม่พบงานผลิตที่ระบุ';
  end if;

  -- ---------- ด่าน GMP: ล็อกเมื่อเริ่มผลิตแล้ว ----------
  if v_job.status not in ('pending_announce', 'planned') then
    v_label := case v_job.status::text
                 when 'in_production'  then 'กำลังผลิต'
                 when 'qc'             then 'QC'
                 when 'qa'             then 'QA'
                 when 'finished_goods' then 'FG (เข้าคลัง)'
                 else v_job.status::text
               end;
    raise exception
      'งาน % อยู่ในสถานะ "%" แล้ว — แก้เลขล็อตไม่ได้ ต้องยื่นคำขอแก้ไขย้อนหลัง',
      v_job.job_no, v_label;
  end if;

  -- ---------- validate ----------
  v_lot := nullif(btrim(coalesce(p_lot_no, '')), '');
  if v_lot is null then
    raise exception 'กรุณากรอกเลขล็อต (LOT No.)';
  end if;

  -- batches.lot_no เป็น unique ทั้งตาราง (0001:131) — ดักเองเพื่อคืนข้อความไทย
  if exists (
    select 1 from public.batches
     where lot_no = v_lot
       and (v_job.batch_id is null or id <> v_job.batch_id)
  ) then
    raise exception 'เลขล็อต % ถูกใช้กับงานอื่นแล้ว', v_lot;
  end if;

  -- ตรงกับ check constraint batches_expiry_after_mfg (0001:141) — ดักก่อนให้ได้ข้อความไทย
  if p_mfg_date is not null and p_exp_date is not null and p_exp_date <= p_mfg_date then
    raise exception 'วันหมดอายุต้องหลังวันผลิต';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'ผูกเลขล็อต ' || v_lot || ' ให้งาน ' || v_job.job_no, true);

  if v_job.batch_id is null then
    insert into public.batches
      (lot_no, order_id, product_id, manufacture_date, expiry_date, created_by)
    values
      (v_lot, v_job.order_id, v_job.product_id, p_mfg_date, p_exp_date, v_profile)
    returning id into v_batch;

    update public.jobs
       set batch_id = v_batch, updated_by = v_profile
     where id = v_job.id;
  else
    v_batch := v_job.batch_id;
    update public.batches
       set lot_no           = v_lot,
           manufacture_date = p_mfg_date,
           expiry_date      = p_exp_date,
           updated_by       = v_profile
     where id = v_batch;
  end if;

  return v_batch;
end;
$$;

grant execute on function public.set_job_lot(uuid, text, date, date) to authenticated;

comment on function public.set_job_lot(uuid, text, date, date) is
  'ฝ่ายผลิตกรอก LOT No. (Batch NO.) + วันผลิต/วันหมดอายุ ให้งาน — ทำได้เฉพาะก่อนเข้าสถานะ "กำลังผลิต"';

-- ------------------------------------------------------------
-- (3) realtime ของ batches
--     สร้าง batch ใหม่ = jobs.batch_id เปลี่ยนด้วย → jobs broadcast ให้อยู่แล้ว
--     แต่ "แก้เลขล็อตของ batch เดิม" ไม่แตะ jobs เลย → จอคนอื่นค้างเลขเก่า
-- ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.batches;
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- (4) advance_job_status — ด่านใหม่: planned → in_production ต้องมีเลขล็อตก่อน
--
--     ⚠️ body = ของ 0039:341-451 ทั้งดุ้น (GATE line clearance + in-process + deviation
--        + แจ้งเตือนครบ) แก้เฉพาะ "เพิ่ม 4 บรรทัด" ในสาขา planned → in_production
--        (create or replace ทับทั้งฟังก์ชัน — ลอกมาไม่ครบ = ของเดิมหายเงียบ)
--
--     เหตุผล GMP: เอกสารการผลิต (eBR) · ใบเบิก · ผลตรวจ QC ทั้งหมดอ้างเลขล็อต
--     ถ้าเริ่มผลิตโดยยังไม่มีเลขล็อต → บันทึกที่เกิดระหว่างนั้นไม่มีตัวอ้างอิง
--     และ 0049 ล็อกช่องเลขล็อตทันทีที่เข้า in_production → จะกลายเป็นงานที่แก้ไม่ได้เลย
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
as $$
declare
  v_profile   uuid;
  v_from      job_status;
  v_job_no    text;
  v_batch     uuid;
  v_is_reject boolean := false;
  v_allowed   boolean := false;
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
    v_allowed := public.has_role('production') or public.has_role('manager');
    -- GATE (0049): ต้องกรอกเลขล็อตก่อน — เริ่มผลิตแล้วช่องเลขล็อตจะล็อกทันที
    if v_allowed and v_batch is null then
      raise exception 'เริ่มผลิตไม่ได้ — ต้องกรอก LOT No. (Batch NO.) ของงานนี้ก่อน';
    end if;
    -- GATE: ต้องผ่าน Line Clearance ก่อนเริ่มผลิต (A3)
    if v_allowed and not public.line_clearance_passed(p_job_id) then
      raise exception 'เริ่มผลิตไม่ได้ — ต้องทำ Line Clearance ให้ผ่านก่อน (เคลียร์ของเก่า/ทำความสะอาด/ตั้งเครื่อง + ผู้ตรวจรับเซ็น)';
    end if;
  elsif v_from = 'in_production'     and p_to = 'qc' then
    v_allowed := public.has_role('production');
    -- GATE: ต้องตรวจ in-process QC (ผ่าน) ตามสูตรก่อนส่ง QC (E2 · ผ่อนเป็น ≥1 สถานีใน 0034)
    if v_allowed and not public.inprocess_route_complete(p_job_id) then
      raise exception 'ส่ง QC ไม่ได้ — ต้องมีผลตรวจ in-process QC (ผ่าน) อย่างน้อย 1 สถานีในสูตรก่อน';
    end if;
  elsif v_from = 'qc'               and p_to = 'qa' then
    v_allowed := public.has_role('qc');
  elsif v_from = 'qc'               and p_to = 'in_production' then
    v_allowed := public.has_role('qc'); v_is_reject := true;
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
    -- B4: แจ้งฝ่ายผลิตเมื่องานถูกตีกลับ (relevant = in_production → ซ่อนเมื่อส่งต่อไปแล้ว)
    perform public.create_notification(
      'reject',
      'งาน ' || v_job_no || ' ถูกตีกลับ',
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'ไม่ระบุเหตุผล'),
      p_job_id, v_job_no, 'production', 'in_production');
  else
    -- C1a: แจ้ง role ปลายทางว่า "งานมาถึงหน้าที่คุณแล้ว"
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
$$;

grant execute on function public.advance_job_status(uuid, job_status, text) to authenticated;

-- ============================================================
-- ตรวจหลังรัน (ออปชัน)
--   select oid::regprocedure from pg_proc where proname in ('set_job_lot','can_set_job_lot');
--   -- งานที่ยังไม่มีเลขล็อต (ควรเป็นงานใหม่จาก 0048 ทั้งหมด)
--   select job_no, status from public.jobs where batch_id is null order by job_no;
--   -- ทดลอง (ต้องล็อกอินเป็นฝ่ายผลิต): select public.set_job_lot('<job uuid>', 'TEST-LOT-01');
--   -- ด่านใหม่ต้องอยู่ในฟังก์ชันจริง (ต้องเจอ 1 แถว)
--   select 1 from pg_proc where proname = 'advance_job_status'
--     and prosrc like '%ต้องกรอก LOT No.%';
-- ============================================================
