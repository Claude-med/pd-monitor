-- ============================================================
-- PD Monitor — Part C ก้อน 2 / 0053_job_sub_status_registry.sql
-- ทะเบียน "Status" ของงาน (สถานะย่อยตาม flow โรงงาน) + เดือนแผนผลิต
--
--   (1) ตาราง job_sub_statuses + trigger meta/audit + RLS + realtime
--   (2) jobs.plan_month — เดือนที่ลงแผนไว้ (คู่กับ sub_status = 'มีแผน')
--   (3) seed 51 ค่าตามลิสต์ที่ฝ่ายวางแผน/ผลิตส่งมา
--   (4) upsert_job_sub_status — เพิ่ม/แก้ (แก้ชื่อแล้ว sync jobs.sub_status ให้ด้วย)
--   (5) delete_job_sub_status — ลบจริงถ้าไม่มีงานใช้ · มีงานใช้ต้องยืนยันแล้วปิดใช้งานแทน
--
-- ℹ️ ทำไม jobs.sub_status ยังเป็น text ไม่ใช่ FK ชี้ทะเบียนนี้:
--    ทีมขอให้ "ทุกฝ่าย" ลบ/แก้รายการในทะเบียนได้เอง ถ้าเป็น FK การลบต้องมี flow
--    ย้ายงานก่อนลบแบบ delete_customer ซึ่งหนักเกินจำเป็น · เก็บเป็น snapshot text
--    แบบเดียวกับ orders.customer (0047) → ลบสถานะแล้วงานเก่ายังแสดงชื่อเดิมได้ ไม่พัง (ALCOA)
--    และไฟล์ที่อ่าน sub_status อยู่เดิม (หน้ารายละเอียดงาน · eBR) ไม่ต้องแก้โครงเลย
-- ℹ️ ทำไม plan_month เป็น date (วันที่ 1 ของเดือน) ไม่ใช่ text 'YYYY-MM':
--    ต้องกรอง/เรียง/ทำรายงานตามเดือนได้จริง (where between · order by · date_trunc)
--    text เก็บขยะได้ ('2026-8', 'ส.ค.') และต้อง cast ทุกครั้งที่ใช้
-- ⚠️ 'มีแผน' / 'ไม่มีแผน' ตั้ง is_system = true ห้ามลบ/แก้ชื่อ —
--    ฝั่งแอปมีค่าคงที่ DEFAULT_JOB_SUB_STATUS = 'ไม่มีแผน' (job-constants.ts) และ
--    'มีแผน' ผูกกับ logic ช่องเดือน ถ้าใครลบทิ้ง ระบบสร้างงานจะเขียนค่าที่ไม่มีในทะเบียนแบบเงียบ
-- ⚠️ sub_status ยัง "ห้ามใช้ตัดสินด่าน GMP" เหมือนเดิม — flow จริงคุมด้วย enum jobs.status เท่านั้น
-- รัน "หลัง" 0001–0052
-- ============================================================

-- ------------------------------------------------------------
-- (1) ตาราง job_sub_statuses
-- ------------------------------------------------------------
create table if not exists public.job_sub_statuses (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text,
  sort_order          integer not null default 0,
  requires_plan_month boolean not null default false,
  is_system           boolean not null default false,
  is_active           boolean not null default true,
  created_by          uuid references public.profiles(id),
  updated_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             integer not null default 1
);

comment on table public.job_sub_statuses is
  'ทะเบียนสถานะย่อยของงาน (Part C) — jobs.sub_status เก็บชื่อเป็น snapshot ไม่ใช่ FK · ห้ามใช้ตัดสินด่าน GMP';
comment on column public.job_sub_statuses.sort_order is
  'ลำดับที่แสดงใน dropdown — เรียงตาม flow โรงงาน ไม่ใช่ ก-ฮ (seed เว้นช่วงทีละ 10 ให้แทรกทีหลังได้)';
comment on column public.job_sub_statuses.requires_plan_month is
  'true = เลือกสถานะนี้แล้วต้องระบุเดือนแผนด้วย (ปัจจุบันคือ "มีแผน" → แสดงผลเป็น มีแผน08/26)';
comment on column public.job_sub_statuses.is_system is
  'ค่าที่ระบบผูกไว้ในโค้ด — ลบไม่ได้ แก้ชื่อไม่ได้ (มีแผน / ไม่มีแผน)';

-- ชื่อห้ามซ้ำแบบไม่สนตัวพิมพ์/ช่องว่างหัวท้าย
create unique index if not exists idx_job_sub_statuses_name_uniq
  on public.job_sub_statuses (lower(btrim(name)));

create index if not exists idx_job_sub_statuses_sort
  on public.job_sub_statuses (sort_order);

drop trigger if exists trg_meta_job_sub_statuses on public.job_sub_statuses;
create trigger trg_meta_job_sub_statuses before insert or update on public.job_sub_statuses
  for each row execute function public.set_row_meta();

drop trigger if exists trg_audit_job_sub_statuses on public.job_sub_statuses;
create trigger trg_audit_job_sub_statuses after insert or update or delete on public.job_sub_statuses
  for each row execute function public.log_audit();

-- RLS: default-deny · ทุกคนที่ล็อกอินอ่านได้ · เขียนผ่าน RPC security definer เท่านั้น
alter table public.job_sub_statuses enable row level security;

drop policy if exists read_job_sub_statuses on public.job_sub_statuses;
create policy read_job_sub_statuses on public.job_sub_statuses
  for select to authenticated using (true);

do $$
begin
  alter publication supabase_realtime add table public.job_sub_statuses;
exception
  when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- (2) jobs.plan_month — เดือนที่ลงแผนผลิตไว้
-- ------------------------------------------------------------
alter table public.jobs
  add column if not exists plan_month date;

do $$
begin
  alter table public.jobs
    add constraint jobs_plan_month_first_of_month
    check (plan_month is null or extract(day from plan_month) = 1);
exception
  when duplicate_object then null;
end $$;

comment on column public.jobs.plan_month is
  'เดือนที่ลงแผนผลิต — เก็บเป็นวันที่ 1 ของเดือน (2026-08-01) แสดงคู่กับ sub_status เป็น "มีแผน08/26" · ⚠️ ห้ามใช้ตัดสินด่าน GMP';

-- ------------------------------------------------------------
-- (3) seed 51 ค่า (idempotent — รันซ้ำได้ ไม่ทับของที่ทีมแก้ไปแล้ว)
--     ลำดับจัดตาม flow จริงของโรงงาน (ผสม → ตอก → แคปซูล → พิมพ์/เคลือบ → บรรจุ → คลัง)
-- ------------------------------------------------------------
insert into public.job_sub_statuses (name, sort_order, requires_plan_month, is_system)
select x.name, x.ord * 10, x.req, x.sys
  from (values
    ('มีแผน',                                     1, true,  true),
    ('ไม่มีแผน',                                  2, false, true),
    ('ชั่งวัตถุดิบรอผสม',                          3, false, false),
    ('รอผสมเปียก',                                4, false, false),
    ('อบ',                                        5, false, false),
    ('บด',                                        6, false, false),
    ('รอผสมแห้ง',                                 7, false, false),
    ('ผสมแห้ง',                                   8, false, false),
    ('อบผสม',                                     9, false, false),
    ('บดผสม',                                    10, false, false),
    ('รอตอกเม็ด',                                11, false, false),
    ('ตอกเม็ด',                                  12, false, false),
    ('รอตอกสลัก',                                13, false, false),
    ('ตอกสลัก',                                  14, false, false),
    ('รอบดสลัก',                                 15, false, false),
    ('บดสลัก',                                   16, false, false),
    ('รอบรรจุแคปซูล',                             17, false, false),
    ('บรรจุแคปซูล+เลือกยา+ตรวจโลหะ',               18, false, false),
    ('รอคาดแคปซูล',                               19, false, false),
    ('คาดแคปซูล',                                 20, false, false),
    ('รอพิมพ์อักษร',                              21, false, false),
    ('พิมพ์อักษร',                                22, false, false),
    ('รอเคลือบฟิล์ม / น้ำตาล',                      23, false, false),
    ('เคลือบฟิล์ม / น้ำตาล',                        24, false, false),
    ('รอเลือกยา+รอตรวจโลหะ',                      25, false, false),
    ('รอเลือกยา+ตรวจโลหะ',                        26, false, false),
    ('เลือกยา+ตรวจโลหะ',                          27, false, false),
    ('เขย่ายา',                                   28, false, false),
    ('รอล้างขวด+รอบรรจุยา',                        29, false, false),
    ('ล้างขวด+บรรจุยา',                           30, false, false),
    ('รอเป่าหลอด+รอบรรจุยา',                       31, false, false),
    ('เป่าหลอด+บรรจุยา',                          32, false, false),
    ('รอตรวจความใส',                              33, false, false),
    ('ตรวจความใส',                                34, false, false),
    ('รอเบิกเคมี',                                35, false, false),
    ('ส่งเบิกเคมี',                               36, false, false),
    ('รอเตรียมเคมี',                              37, false, false),
    ('เตรียมเคมี',                                38, false, false),
    ('รอบรรจุฟอยล์/ขวด/ซอง',                       39, false, false),
    ('บรรจุฟอยล์/ขวด/ซอง',                         40, false, false),
    ('รอบรรจุหีบห่อ',                             41, false, false),
    ('บรรจุหีบห่อ',                               42, false, false),
    ('บรรจุกล่อง',                                43, false, false),
    ('รอส่ง Checklist',                           44, false, false),
    ('ส่ง Checklist',                             45, false, false),
    ('เข้าคลัง',                                  46, false, false),
    ('ยาเข้าคลัง',                                47, false, false),
    ('ยารอปลด',                                   48, false, false),
    ('ยาเข้าคลัง (ยาที่เข้าคลังไปแล้วโดย Check list พร้อม /เอกสารพร้อม รอ QC / QA พิจารณา)', 49, false, false),
    ('ยารอปลด (ยารอ QC / QA พิจารณาเพื่อปล่อยขาย)', 50, false, false),
    ('ยาปลดแล้ว (ยา QC / QA ปล่อยผ่านแล้ว)',        51, false, false)
  ) as x(name, ord, req, sys)
 where not exists (
   select 1 from public.job_sub_statuses s
    where lower(btrim(s.name)) = lower(btrim(x.name))
 );

-- ------------------------------------------------------------
-- (4) upsert_job_sub_status — เพิ่ม/แก้รายการในทะเบียน
--     สิทธิ์ = ทุกฝ่ายที่ล็อกอิน (ทีมยืนยัน) — ทะเบียนนี้คือคำที่หน้างานใช้เรียกกันเอง
--     แก้ชื่อแล้วต้อง sync jobs.sub_status ด้วย ไม่งั้นงานเก่าค้างชื่อที่หายไปจาก dropdown
-- ------------------------------------------------------------
create or replace function public.upsert_job_sub_status(
  p_id                  uuid,
  p_name                text,
  p_description         text    default null,
  p_requires_plan_month boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile  uuid;
  v_name     text;
  v_desc     text;
  v_old_name text;
  v_system   boolean;
  v_id       uuid;
  v_synced   integer := 0;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  v_name := btrim(coalesce(p_name, ''));
  v_desc := nullif(btrim(coalesce(p_description, '')), '');
  if v_name = '' then raise exception 'กรุณาระบุชื่อสถานะ'; end if;

  if exists (
    select 1 from public.job_sub_statuses
     where lower(btrim(name)) = lower(v_name)
       and (p_id is null or id <> p_id)
  ) then
    raise exception 'มีสถานะ "%" อยู่แล้วในทะเบียน', v_name;
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);

  if p_id is null then
    perform set_config('app.audit_reason', 'เพิ่มสถานะงาน ' || v_name, true);
    insert into public.job_sub_statuses
      (name, description, sort_order, requires_plan_month, created_by)
    select v_name, v_desc,
           coalesce(max(sort_order), 0) + 10,   -- ต่อท้ายลิสต์เสมอ
           coalesce(p_requires_plan_month, false), v_profile
      from public.job_sub_statuses
    returning id into v_id;
  else
    select name, is_system into v_old_name, v_system
      from public.job_sub_statuses where id = p_id;
    if v_old_name is null then raise exception 'ไม่พบสถานะที่เลือก'; end if;

    -- ค่าระบบ: แก้คำอธิบายได้ แต่ชื่อ/เงื่อนไขเดือนแผนห้ามแตะ (โค้ดฝั่งแอปผูกไว้)
    if v_system and lower(btrim(v_old_name)) <> lower(v_name) then
      raise exception 'สถานะ "%" เป็นค่าที่ระบบใช้อยู่ แก้ชื่อไม่ได้', v_old_name;
    end if;

    perform set_config('app.audit_reason',
      'แก้สถานะงาน ' || v_old_name || ' → ' || v_name, true);
    update public.job_sub_statuses
       set name                = case when v_system then v_old_name else v_name end,
           description         = v_desc,
           requires_plan_month = case when v_system then requires_plan_month
                                      else coalesce(p_requires_plan_month, false) end,
           updated_by          = v_profile
     where id = p_id
    returning id into v_id;

    -- sync snapshot: งานที่ใช้ชื่อเดิมอยู่ต้องเปลี่ยนตาม (แพทเทิร์นเดียวกับ upsert_customer 0047)
    if not v_system and lower(btrim(v_old_name)) <> lower(v_name) then
      perform set_config('app.audit_reason',
        'เปลี่ยนชื่อสถานะในทะเบียน ' || v_old_name || ' → ' || v_name, true);
      update public.jobs
         set sub_status = v_name
       where lower(btrim(coalesce(sub_status, ''))) = lower(btrim(v_old_name));
      get diagnostics v_synced = row_count;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'synced_jobs', v_synced,
    'message', case when v_synced > 0
                    then 'บันทึกแล้ว · อัปเดตงานที่ใช้สถานะนี้ ' || v_synced || ' ใบ'
                    else 'บันทึกแล้ว' end
  );
end;
$$;

revoke execute on function public.upsert_job_sub_status(uuid, text, text, boolean) from public;
grant execute on function public.upsert_job_sub_status(uuid, text, text, boolean) to authenticated;

comment on function public.upsert_job_sub_status(uuid, text, text, boolean) is
  'เพิ่ม/แก้ทะเบียนสถานะงาน (ทุกฝ่ายที่ล็อกอิน) — แก้ชื่อแล้ว sync jobs.sub_status ให้อัตโนมัติ · ค่า is_system แก้ชื่อไม่ได้';

-- ------------------------------------------------------------
-- (5) delete_job_sub_status
--     ไม่มีงานใช้         → ลบจริง                            {action:'deleted'}
--     มีงานใช้ + ไม่ force → บอกจำนวนงานให้ผู้ใช้ยืนยันก่อน     {action:'blocked', jobs}
--     มีงานใช้ + force    → ปิดใช้งาน (งานเก่ายังโชว์ชื่อได้)    {action:'deactivated', jobs}
-- ------------------------------------------------------------
create or replace function public.delete_job_sub_status(
  p_id    uuid,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_name    text;
  v_system  boolean;
  v_jobs    integer;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  select name, is_system into v_name, v_system
    from public.job_sub_statuses where id = p_id;
  if v_name is null then raise exception 'ไม่พบสถานะที่เลือก'; end if;
  if v_system then
    raise exception 'สถานะ "%" เป็นค่าที่ระบบใช้อยู่ ลบไม่ได้', v_name;
  end if;

  select count(*) into v_jobs
    from public.jobs
   where lower(btrim(coalesce(sub_status, ''))) = lower(btrim(v_name));

  perform set_config('app.current_profile_id', v_profile::text, true);

  if v_jobs = 0 then
    perform set_config('app.audit_reason', 'ลบสถานะงาน ' || v_name, true);
    delete from public.job_sub_statuses where id = p_id;
    return jsonb_build_object('action', 'deleted', 'jobs', 0,
      'message', 'ลบสถานะ "' || v_name || '" แล้ว');
  end if;

  if not coalesce(p_force, false) then
    return jsonb_build_object('action', 'blocked', 'jobs', v_jobs,
      'message', 'มีงาน ' || v_jobs || ' ใบใช้สถานะนี้อยู่ — ถ้ายืนยัน จะปิดใช้งานให้แทน (งานเดิมยังแสดงชื่อนี้ได้ แต่จะเลือกใหม่ไม่ได้)');
  end if;

  perform set_config('app.audit_reason', 'ปิดใช้งานสถานะงาน ' || v_name, true);
  update public.job_sub_statuses
     set is_active = false, updated_by = v_profile
   where id = p_id;

  return jsonb_build_object('action', 'deactivated', 'jobs', v_jobs,
    'message', 'ปิดใช้งานสถานะ "' || v_name || '" แล้ว (งาน ' || v_jobs || ' ใบที่ใช้อยู่ยังแสดงชื่อเดิมได้)');
end;
$$;

revoke execute on function public.delete_job_sub_status(uuid, boolean) from public;
grant execute on function public.delete_job_sub_status(uuid, boolean) to authenticated;

comment on function public.delete_job_sub_status(uuid, boolean) is
  'ลบ/ปิดใช้งานสถานะในทะเบียน (ทุกฝ่ายที่ล็อกอิน) — มีงานใช้อยู่ต้องยืนยันแล้วจะปิดใช้งานแทนการลบ';

-- ------------------------------------------------------------
-- ตรวจหลังรัน (ออปชัน)
-- ------------------------------------------------------------
-- select count(*) from public.job_sub_statuses;                                   -- 51
-- select name, sort_order, requires_plan_month from public.job_sub_statuses where is_system;
-- select 1 from information_schema.columns where table_name='jobs' and column_name='plan_month';
-- select oid::regprocedure from pg_proc where proname like '%job_sub_status%';     -- ตัวละ 1 แถว
