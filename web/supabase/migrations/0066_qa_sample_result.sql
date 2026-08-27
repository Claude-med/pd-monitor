-- ============================================================
-- PD Monitor — Part C.4 / 0066_qa_sample_result.sql  (ก้อน 3)
--   "จุดเก็บตัวอย่าง (QA Sample)" → "จุดเก็บตัวอย่าง (ตรวจ Finished product)"
--   (1) เพิ่มช่อง "ผลตรวจ" ผ่าน/ไม่ผ่าน (reuse enum check_result จาก 0024)
--   (2) ให้ QA กรอก "วันที่/เวลาที่เก็บ" เองได้ (เดิม collected_at = now() เสมอ ตั้งไม่ได้)
--   (3) QA แก้ไข / ลบ ข้อมูลได้ (เดิมมีแต่ add_qa_sample ตัวเดียว แก้/ลบไม่ได้เลย)
--
-- ⚠️ ช่อง "จุด/รอบเก็บตัวอย่าง" (sample_point) ถูกถอดออกจากฟอร์มตามที่ทีมสั่ง
--    แต่ "ไม่ drop คอลัมน์" — แถวเก่ามีข้อความจริงอยู่ (ALCOA: ไม่ทิ้งสิ่งที่เคยบันทึก)
--    แค่ปลด not null + กำกับ comment ว่าเลิกใช้ · UI แสดงเป็นบรรทัดเล็กของแถวเก่า
--
-- ⚠️ ลบเป็น soft delete (deleted_at/deleted_by) ไม่ใช่ลบจริง เพราะ
--      (ก) ก้อน 6 จะให้ตัวอย่างที่ "ไม่ผ่าน" ผูกกับ Incident Case — ลบจริงแล้วเคสกำพร้า
--      (ข) qa_samples เป็น transaction record ตามแนว GxP · โปรเจคนี้ลบจริงเฉพาะ master data
--          (เทียบ 0050_product_hard_delete.sql)
--
-- ⚠️ คงด่านเดิมของ 0027 ครบ: "บันทึกได้เฉพาะงานที่อยู่สถานะ QA"
--    และครอบถึงการ "แก้/ลบ" ด้วย ตามที่ทีมยืนยัน
--
-- ℹ️ add_qa_sample เปลี่ยน signature → ต้อง drop ตัวเดิมก่อน ไม่งั้นเหลือ 2 overload
--    แล้ว PostgREST เลือกไม่ถูก (PGRST203)
-- ℹ️ auto-open Incident Case เมื่อผล = "ไม่ผ่าน" ยังไม่ทำในก้อนนี้ (ไปก้อน 6 หลังโครง Incident เสร็จ)
-- รัน "หลัง" 0001–0065
-- ============================================================

-- ------------------------------------------------------------
-- (1) คอลัมน์
-- ------------------------------------------------------------
alter table public.qa_samples
  add column if not exists result     check_result,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);

-- แถวเก่ายังมี sample_point จริง — ปลดบังคับกรอกแทนการลบทิ้ง
alter table public.qa_samples alter column sample_point drop not null;

comment on column public.qa_samples.sample_point is
  'เลิกใช้ตั้งแต่ Part C.4 (0066) — คงไว้เพื่อประวัติแถวเก่า · ฟอร์มใหม่ใช้ collected_at + result แทน';
comment on column public.qa_samples.result is
  'ผลตรวจ Finished product — null = แถวเก่าที่ยังไม่ได้ลงผล';
comment on column public.qa_samples.deleted_at is
  'soft delete — แถวที่มีค่าจะไม่แสดงในแอป แต่ยังอยู่ใน DB + audit_log';

-- index ของ "แถวที่ยังไม่ถูกลบ" (หน้าจอกับ eBR อ่านเฉพาะแถวนี้)
create index if not exists idx_qa_samples_live
  on public.qa_samples(job_id) where deleted_at is null;

-- ------------------------------------------------------------
-- (2) helper สิทธิ์ — ต้องตรงกับ canRecordQaSample() ใน lib/data/qa-sample-constants.ts
-- ------------------------------------------------------------
create or replace function public.can_record_qa_sample()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('qa') or public.has_role('manager');
$$;

revoke execute on function public.can_record_qa_sample() from public;
revoke execute on function public.can_record_qa_sample() from anon;
grant  execute on function public.can_record_qa_sample() to authenticated;

comment on function public.can_record_qa_sample() is
  'บันทึก/แก้/ลบจุดเก็บตัวอย่าง (ตรวจ Finished product) ได้ — QA/ผู้บริหาร (admin ผ่านผ่าน has_role)';

-- ------------------------------------------------------------
-- (3) add_qa_sample — signature ใหม่ (ตัด p_sample_point · เพิ่ม p_result + p_collected_at)
--     🚨 ต้อง drop ตัวเดิมก่อน กัน overload ซ้อน
-- ------------------------------------------------------------
drop function if exists public.add_qa_sample(uuid, text, numeric, text, text);

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

  -- gate สถานะเดิมจาก 0027 — เก็บตัวอย่างตรวจ Finished product ได้เฉพาะงานที่อยู่ขั้น QA
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

  -- TODO (ก้อน 6 · 0069): p_result = 'fail' → เปิด Incident Case อัตโนมัติ + ผูก qa_sample_id
  return v_id;
end;
$fn$;

revoke execute on function public.add_qa_sample(uuid, numeric, text, check_result, timestamptz, text) from public;
revoke execute on function public.add_qa_sample(uuid, numeric, text, check_result, timestamptz, text) from anon;
grant  execute on function public.add_qa_sample(uuid, numeric, text, check_result, timestamptz, text) to authenticated;

comment on function public.add_qa_sample(uuid, numeric, text, check_result, timestamptz, text) is
  'บันทึกจุดเก็บตัวอย่าง (ตรวจ Finished product) — QA/ผู้บริหาร · งานต้องอยู่สถานะ QA · กรอกวันเวลาเองได้';

-- ------------------------------------------------------------
-- (4) update_qa_sample — แก้ไขย้อนหลัง (QA เท่านั้น)
--     ใช้ p_fields ไม่ได้เพราะฟอร์มส่งทุกช่องอยู่แล้ว — แต่ต้องแยก "ส่ง null เพื่อล้างค่า"
--     ออกจาก "ไม่ได้ส่ง" ไม่ได้ จึงตกลงว่าฟอร์มส่งครบทุกช่องเสมอ (ค่าว่าง = ล้าง)
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

  -- TODO (ก้อน 6 · 0069): ผลเปลี่ยนเป็น 'fail' → เปิด Incident Case อัตโนมัติ
end;
$fn$;

revoke execute on function public.update_qa_sample(uuid, numeric, text, check_result, timestamptz, text) from public;
revoke execute on function public.update_qa_sample(uuid, numeric, text, check_result, timestamptz, text) from anon;
grant  execute on function public.update_qa_sample(uuid, numeric, text, check_result, timestamptz, text) to authenticated;

comment on function public.update_qa_sample(uuid, numeric, text, check_result, timestamptz, text) is
  'แก้ไขจุดเก็บตัวอย่าง (ตรวจ Finished product) — QA/ผู้บริหาร · งานต้องยังอยู่สถานะ QA';

-- ------------------------------------------------------------
-- (5) delete_qa_sample — soft delete + บังคับเหตุผล (ลง audit_log.reason)
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
  if not public.can_record_qa_sample() then
    raise exception 'เฉพาะ QA/ผู้บริหารลบจุดเก็บตัวอย่างได้';
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
  'ลบจุดเก็บตัวอย่างแบบ soft delete — QA/ผู้บริหาร · ต้องระบุเหตุผล · งานต้องยังอยู่สถานะ QA';

-- ============================================================
-- ตรวจหลังรัน (คัดลอกไปรันแยกได้)
-- ------------------------------------------------------------
-- -- คอลัมน์ใหม่ครบ 3 (ต้องได้ 3 แถว)
-- select column_name from information_schema.columns
--  where table_name = 'qa_samples' and column_name in ('result','deleted_at','deleted_by');
--
-- -- sample_point ต้องไม่บังคับกรอกแล้ว (ต้องได้ 'YES')
-- select is_nullable from information_schema.columns
--  where table_name = 'qa_samples' and column_name = 'sample_point';
--
-- -- ไม่มี overload ซ้อน (add_qa_sample ต้องได้ 1 · ไม่ใช่ 2)
-- select proname, count(*) from pg_proc
--  where proname in ('add_qa_sample','update_qa_sample','delete_qa_sample','can_record_qa_sample')
--  group by proname;
--
-- -- anon เรียกไม่ได้ทุกตัว (ต้องได้ false ทุกแถว)
-- select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('add_qa_sample','update_qa_sample','delete_qa_sample','can_record_qa_sample');
-- ============================================================
