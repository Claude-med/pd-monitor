-- ============================================================
-- PD Monitor — 0030_deviation_notes_resolution.sql  (ก้อน 4: D1 + D2)
--   (D1) deviation_comments = หมายเหตุแยกตามฝ่าย (append-only ต่อฝ่าย)
--        แต่ละฝ่าย (production/qc/qa/manager) เพิ่มหมายเหตุของตัวเองได้ ไม่แก้ทับกัน
--   (D2) ปุ่ม "ส่งกลับให้ QA ตรวจสอบ" — ฝ่ายผลิตแจ้งว่าแก้ไขเรียบร้อย → แจ้ง QA/ผู้บริหาร
-- คง open_deviation / update_deviation / GATE เดิมทุกอย่าง
-- รัน "หลัง" 0026, 0029 (ใช้ create_notification 7-arg)
-- ============================================================

-- ------------------------------------------------------------
-- (D1) deviation_comments — หมายเหตุ append-only ต่อ deviation
-- ------------------------------------------------------------
create table if not exists public.deviation_comments (
  id           uuid primary key default gen_random_uuid(),
  deviation_id uuid not null references public.deviations(id) on delete cascade,
  role_group   text not null,                        -- production / qc / qa / manager
  body         text not null,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

create index if not exists idx_deviation_comments_dev
  on public.deviation_comments(deviation_id, created_at);

-- RLS: อ่านได้ทุก authenticated · เขียนผ่าน RPC เท่านั้น (ไม่มี policy insert/update/delete = แก้ไม่ได้)
alter table public.deviation_comments enable row level security;
drop policy if exists read_deviation_comments on public.deviation_comments;
create policy read_deviation_comments on public.deviation_comments
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- (D2) เพิ่มฟิลด์สถานะ "แก้ไขเรียบร้อย รอ QA ตรวจสอบ" บน deviations
-- ------------------------------------------------------------
alter table public.deviations
  add column if not exists resolution_note         text,
  add column if not exists resolution_submitted_by uuid references public.profiles(id),
  add column if not exists resolution_submitted_at  timestamptz;

-- ------------------------------------------------------------
-- helper: ระบุ "ฝ่าย" ของผู้ใช้ปัจจุบัน (สำหรับ tag หมายเหตุ)
-- ------------------------------------------------------------
create or replace function public.current_role_group()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.has_role('production') then 'production'
    when public.has_role('qc')         then 'qc'
    when public.has_role('qa')         then 'qa'
    when public.has_role('manager')    then 'manager'
    else null
  end;
$$;

-- ------------------------------------------------------------
-- (D1) add_deviation_comment — เพิ่มหมายเหตุของฝ่ายตน (append-only)
-- ------------------------------------------------------------
create or replace function public.add_deviation_comment(
  p_deviation_id uuid,
  p_body         text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_role    text;
  v_body    text;
  v_id      uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  v_role := public.current_role_group();
  if v_role is null then raise exception 'สิทธิ์ของคุณเพิ่มหมายเหตุ deviation ไม่ได้'; end if;

  v_body := nullif(btrim(coalesce(p_body, '')), '');
  if v_body is null then raise exception 'กรุณาพิมพ์หมายเหตุ'; end if;
  if not exists (select 1 from public.deviations where id = p_deviation_id) then
    raise exception 'ไม่พบ deviation';
  end if;

  insert into public.deviation_comments (deviation_id, role_group, body, created_by)
  values (p_deviation_id, v_role, v_body, v_profile)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.add_deviation_comment(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- (D2) submit_deviation_resolution — แจ้งว่าแก้ไขเรียบร้อย → ส่งให้ QA ตรวจสอบ
--   ใครแก้ได้: production/qc/qa/manager · ทำได้เฉพาะ deviation ที่ยังไม่ปิด
--   ผล: บันทึกหมายเหตุการแก้ + ตั้ง status='investigating' + แจ้ง QA/ผู้บริหาร
-- ------------------------------------------------------------
create or replace function public.submit_deviation_resolution(
  p_id   uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_role    text;
  v_dev     record;
  v_job_no  text;
  v_note    text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  v_role := public.current_role_group();
  if v_role is null then raise exception 'สิทธิ์ของคุณส่ง deviation ให้ QA ไม่ได้'; end if;

  select * into v_dev from public.deviations where id = p_id for update;
  if v_dev.id is null then raise exception 'ไม่พบ deviation'; end if;
  if v_dev.status = 'closed' then raise exception 'deviation นี้ปิดแล้ว'; end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  select job_no into v_job_no from public.jobs where id = v_dev.job_id;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ส่ง deviation ให้ QA ตรวจสอบ', true);

  update public.deviations
     set status                  = 'investigating',
         resolution_note         = coalesce(v_note, resolution_note),
         resolution_submitted_by = v_profile,
         resolution_submitted_at = now(),
         updated_by              = v_profile
   where id = p_id;

  -- บันทึกเป็นหมายเหตุของฝ่ายผู้แจ้งด้วย (ให้เห็นใน timeline)
  insert into public.deviation_comments (deviation_id, role_group, body, created_by)
  values (p_id, v_role,
          '✅ แจ้งแก้ไขเรียบร้อย — ส่งให้ QA ตรวจสอบ'
            || case when v_note is not null then ': ' || v_note else '' end,
          v_profile);

  -- แจ้ง QA + ผู้บริหาร (relevant_status = null → แสดงจนกว่าจะอ่าน)
  perform public.create_notification(
    'deviation',
    'Deviation งาน ' || coalesce(v_job_no, '') || ' แก้ไขแล้ว — รอ QA ตรวจสอบ',
    coalesce(v_note, v_dev.title), v_dev.job_id, v_job_no, 'qa', null);
  perform public.create_notification(
    'deviation',
    'Deviation งาน ' || coalesce(v_job_no, '') || ' แก้ไขแล้ว — รอ QA ตรวจสอบ',
    coalesce(v_note, v_dev.title), v_dev.job_id, v_job_no, 'manager', null);
end;
$$;

grant execute on function public.submit_deviation_resolution(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- realtime
-- ------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.deviation_comments;
exception when duplicate_object then null; end $$;
