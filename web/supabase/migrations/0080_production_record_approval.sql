-- ============================================================
-- PD Monitor — ระบบสิทธิ์ (Part E) / 0080_production_record_approval.sql
-- ช่อง "การอนุมัติ" ของบันทึกผลผลิต — หัวหน้าฝ่ายผลิตเป็นผู้อนุมัติ (ลายเซ็นที่สอง)
--   (1) enum production_record_status + คอลัมน์ status/approved_by/approved_at/approve_note
--   (2) can_approve_production_record()
--   (3) review_production_record()   — อนุมัติ/ไม่อนุมัติ ทีละแถว
--   (4) review_production_records()  — ติ๊กหลายแถวแล้วอนุมัติรวดเดียว
--   (5) trigger รีเซ็ตการอนุมัติเมื่อตัวเลขถูกแก้ย้อนหลัง
-- รัน "หลัง" 0079
--
-- 🎯 ที่มา: ทีมถามว่า "บันทึกผลผลิตควรเพิ่มช่องอนุมัติไหม" (Notion — Part D.4)
--    คำตอบคือควร — บันทึกผลผลิตเป็น record เดียวในสายงานที่ยังไม่มีลายเซ็นที่สอง
--    ทั้งที่ Line Clearance (0062) · in-process QC (0064) · QA sample (0066) ·
--    Incident (0067) · คำขอแก้ไข (0033) มีครบหมด
--    และตัวเลขจากตารางนี้ไหลไป แดชบอร์ด · ต้นทุนค่าแรง DL · eBR · รายงานประจำวัน
--    ⓘ 0063:21-24 เขียนแผนไว้เองแล้วว่า "ก้อน 6 ค่อยเติม ... ขั้นตอนรออนุมัติ" — นี่คือส่วนที่ค้าง
--
-- 🧩 แม่แบบ = review_inprocess_check (0064/0065) เพราะเป็นการอนุมัติ "รายแถว" เหมือนกัน
--    + ยืมกฎ "ผู้อนุมัติต้องคนละคนกับผู้ทำ" จาก check_line_clearance (0062:317)
--
-- ⚠️ ตั้งใจ "ไม่กั้น" การเดินสถานะงาน (ผู้ใช้เลือกแล้ว)
--    advance_job_status ไม่ถูกแตะ — งานยังส่ง QC ได้แม้ยังอนุมัติผลผลิตไม่ครบ
--    เหตุผล: ระบบมีด่านบังคับอยู่แล้ว 4 ชั้น (LC · in-process approved · Incident ค้าง · QA sample)
--    ถ้าเพิ่มด่านที่ 5 แล้วหัวหน้าลาป่วย งานค้างทั้งโรงงาน
--    (เคยเจอเคสเดียวกันมาแล้ว: "ต้องมีคนถือ role qa จริง ไม่งั้นเคสค้างตลอดไป" — Part C.4)
--    ⇒ ใช้ป้ายสถานะ + ตัวนับ "รออนุมัติ" แทนการบล็อก · ถ้าวันหน้าอยากเข้มขึ้นค่อยเติมด่านใน
--      advance_job_status ตรงช่วง in_production → qc
-- ============================================================

-- ------------------------------------------------------------
-- (1) สถานะการอนุมัติของแถวบันทึกผลผลิต
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'production_record_status') then
    create type production_record_status as enum ('pending', 'approved', 'rejected');
  end if;
end $$;

comment on type production_record_status is
  'สถานะอนุมัติบันทึกผลผลิต: pending = รอหัวหน้าฝ่ายผลิต · approved = อนุมัติแล้ว · rejected = ไม่อนุมัติ';

alter table public.production_records
  add column if not exists status       production_record_status not null default 'pending',
  add column if not exists approved_by  uuid references public.profiles(id),
  add column if not exists approved_at  timestamptz,
  add column if not exists approve_note text;

-- แถวเก่าทั้งหมด = ถือว่าอนุมัติแล้ว
-- (ไม่ให้ข้อมูลที่ผ่านมาแล้วกลับไป "ค้างรออนุมัติ" ย้อนหลัง — แพทเทิร์นเดียวกับ 0064:50)
update public.production_records
   set status = 'approved'
 where status = 'pending'
   and created_at < now();

-- partial index — คิวรออนุมัติเป็นชุดเล็กเสมอ ไม่ต้อง index ทั้งตาราง
create index if not exists idx_prod_records_pending
  on public.production_records (status)
  where status = 'pending';

-- ------------------------------------------------------------
-- (2) can_approve_production_record — หัวหน้าฝ่ายผลิต / ผู้บริหาร
--
--     ⚠️ ห้าม or รวมกับสิทธิ์ "บันทึกผลผลิต" (production) —
--        พนักงานต้องบันทึกได้แต่อนุมัติของตัวเองไม่ได้
--        (has_role สืบทอด lead→base ทางเดียว จึงไม่มีทางที่ production จะผ่านข้อนี้ — 0078)
-- ------------------------------------------------------------
create or replace function public.can_approve_production_record()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('production_lead') or public.has_role('manager');
$$;

revoke execute on function public.can_approve_production_record() from public;
revoke execute on function public.can_approve_production_record() from anon;
grant  execute on function public.can_approve_production_record() to authenticated;

comment on function public.can_approve_production_record() is
  'อนุมัติ/ไม่อนุมัติบันทึกผลผลิตได้ — หัวหน้าฝ่ายผลิต/ผู้บริหาร · ต้องตรงกับ canApproveProductionRecord() ใน web/lib/data/role-access.ts';

-- ------------------------------------------------------------
-- (3) review_production_record — อนุมัติ / ไม่อนุมัติ ทีละแถว
--
--     🐞 บทเรียน 0065:9-15 — ต้อง cast ผลของ CASE "ทั้งก้อน" เป็น enum
--        ไม่งั้น Postgres รวมสองแขนที่เป็น unknown เป็น text แล้วพัง error 42804
--        (ตอน 0064 หัวหน้า QC กดอนุมัติไม่ได้เลยทั้งรอบเพราะข้อนี้)
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
end;
$fn$;

revoke execute on function public.review_production_record(uuid, text, text) from public;
revoke execute on function public.review_production_record(uuid, text, text) from anon;
grant  execute on function public.review_production_record(uuid, text, text) to authenticated;

comment on function public.review_production_record(uuid, text, text) is
  'อนุมัติ/ไม่อนุมัติบันทึกผลผลิต 1 แถว (หัวหน้าฝ่ายผลิต/ผู้บริหาร) — ต้องคนละคนกับผู้บันทึก · ไม่อนุมัติต้องมีเหตุผล';

-- ------------------------------------------------------------
-- (4) review_production_records — ติ๊กหลายแถวแล้วกดรวดเดียว
--
--     หน้างานบันทึกวันละหลายแถว × หลายสถานี → กดทีละใบไม่ไหว
--     แถวที่ทำไม่ได้ (ตัวเองเป็นผู้บันทึก / พิจารณาไปแล้ว) จะถูก "ข้าม" ไม่ใช่ทำให้ทั้งชุดล้ม
--     แล้วคืนจำนวนกลับไปให้ UI บอกผู้ใช้ว่าข้ามไปกี่ใบเพราะอะไร
--
--     ⚠️ ใช้ exception handling ต่อแถว ไม่ใช่ก็อปเงื่อนไขมาเขียนซ้ำ —
--        กติกาจะได้อยู่ที่ review_production_record() ที่เดียวเสมอ
-- ------------------------------------------------------------
create or replace function public.review_production_records(
  p_ids      uuid[],
  p_decision text,
  p_note     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id       uuid;
  v_ok       integer := 0;
  v_skipped  integer := 0;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'ยังไม่ได้เลือกรายการ';
  end if;

  foreach v_id in array p_ids loop
    begin
      perform public.review_production_record(v_id, p_decision, p_note);
      v_ok := v_ok + 1;
    exception
      when others then
        -- ข้ามเฉพาะแถวที่ติดกติกา (เช่น เป็นผู้บันทึกเอง / พิจารณาไปแล้ว)
        -- ⚠️ ถ้าไม่มีสิทธิ์เลย แถวแรกจะโยน exception ออกไปเลยตั้งแต่แถวแรก
        --    (ตรงนี้ยังนับเป็น skipped ได้ จึงเช็กสิทธิ์ซ้ำหลังลูปด้านล่าง)
        v_skipped := v_skipped + 1;
    end;
  end loop;

  -- ไม่ผ่านสักแถว + ไม่มีสิทธิ์อนุมัติ = ต้องบอกตรง ๆ ว่าไม่มีสิทธิ์ ไม่ใช่ "ข้ามทั้งหมด"
  if v_ok = 0 and not public.can_approve_production_record() then
    raise exception 'เฉพาะหัวหน้าฝ่ายผลิต/ผู้บริหารอนุมัติบันทึกผลผลิตได้';
  end if;

  return jsonb_build_object('approved', v_ok, 'skipped', v_skipped);
end;
$fn$;

revoke execute on function public.review_production_records(uuid[], text, text) from public;
revoke execute on function public.review_production_records(uuid[], text, text) from anon;
grant  execute on function public.review_production_records(uuid[], text, text) to authenticated;

comment on function public.review_production_records(uuid[], text, text) is
  'อนุมัติ/ไม่อนุมัติบันทึกผลผลิตหลายแถวรวดเดียว — ข้ามแถวที่ทำไม่ได้แล้วคืน {approved, skipped}';

-- ------------------------------------------------------------
-- (5) รีเซ็ตการอนุมัติเมื่อ "ตัวเลขถูกแก้ย้อนหลัง"
--
--     ถ้าอนุมัติไปแล้วมีคนยื่นคำขอแก้ยอดผลิต/ของเสีย/เวลา แล้วผู้อนุมัติคำขอกดอนุมัติ
--     ค่าที่หัวหน้าเคยเซ็นรับรองจะเปลี่ยนไป → ต้องกลับไป "รออนุมัติ" ใหม่
--     (แนวคิดเดียวกับ 0065:264-283 ที่รีเซ็ตผลตรวจ in-process เมื่อผล/ค่าถูกแก้)
--
--     💡 ทำเป็น trigger ไม่ใช่แก้ review_edit_request:
--        · ครอบทุกเส้นทางที่แก้ตัวเลข ไม่ใช่เฉพาะเส้นทางคำขอแก้ไข
--        · ไม่ต้องยกบอดี้ review_edit_request (ฟังก์ชันยาว) มาเขียนซ้ำ = ไม่เสี่ยงตกเงื่อนไข
--          (บทเรียน Part C.2: ยกฟังก์ชันมาทั้งดุ้นแล้วตก branch)
--
--     ℹ️ ไม่ยิงตอน review_production_record เอง เพราะตอนนั้นตัวเลขไม่เปลี่ยน
--        (เงื่อนไขบังคับว่า status ต้องเท่าเดิม = 'approved' ด้วย)
-- ------------------------------------------------------------
create or replace function public.reset_production_record_approval()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if old.status = 'approved'
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
     )
  then
    new.status       := 'pending';
    new.approved_by  := null;
    new.approved_at  := null;
    new.approve_note := null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_reset_prod_approval on public.production_records;
create trigger trg_reset_prod_approval
  before update on public.production_records
  for each row execute function public.reset_production_record_approval();

comment on function public.reset_production_record_approval() is
  'แก้ตัวเลขของบันทึกที่อนุมัติแล้ว → เด้งกลับเป็น "รออนุมัติ" และล้างลายเซ็นผู้อนุมัติเดิม';

-- ------------------------------------------------------------
-- ตรวจผลหลัง paste
-- ------------------------------------------------------------
-- select column_name, data_type from information_schema.columns
--  where table_schema='public' and table_name='production_records'
--    and column_name in ('status','approved_by','approved_at','approve_note');
--
-- select status, count(*) from public.production_records group by status;
--   -- แถวเก่าต้องเป็น approved ทั้งหมด
--
-- select unnest(enum_range(null::production_record_status));  -- pending, approved, rejected
