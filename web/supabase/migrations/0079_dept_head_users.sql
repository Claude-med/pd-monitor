-- ============================================================
-- PD Monitor — ระบบสิทธิ์ (Part E) / 0079_dept_head_users.sql
-- หัวหน้าแผนกดูแลบัญชีลูกน้องในฝ่ายตัวเองได้ + ปิดช่องยกระดับสิทธิ์
--   (1) profiles.must_change_password        — ธงบังคับเปลี่ยนรหัสผ่านครั้งแรก
--   (2) dept_of_role / current_head_depts / profile_depts / head_assignable_roles / head_may_manage
--   (3) admin_set_roles      — รับ 2 ระดับ (ผู้บริหาร / หัวหน้าแผนก) + 🔒 ปิดช่อง manager→admin
--   (4) admin_update_profile — รับ 2 ระดับ
--   (5) admin_set_active     — รับ 2 ระดับ
--   (6) admin_mark_password_reset — เขียน audit ตอนรีเซ็ตรหัส + ตั้งธงบังคับเปลี่ยน
--   (7) clear_must_change_password — ผู้ใช้เปลี่ยนรหัสเองสำเร็จแล้วปลดธง
--   (8) drop policy update_own_profile — ปิดช่องแก้โปรไฟล์ตัวเองตรงจากเบราว์เซอร์
-- รัน "หลัง" 0078
--
-- 🎯 ที่มา: ทีมขอให้หัวหน้าแผนกสร้างบัญชีลูกน้องเองได้ (Notion — Part D.4)
--    เดิมหน้า /admin/users เป็นของผู้บริหารอย่างเดียว
--
-- 🚨 กันไว้ 4 ชั้น — "ซ่อนปุ่มที่หน้าจอ" ไม่นับเป็นการกันสิทธิ์
--    (บทเรียน Part C.2: กั้นสิทธิ์ที่ DB ด้วยการแยก RPC ไม่ใช่ซ่อนปุ่ม)
--    หัวหน้าแผนกจะทำสิ่งเหล่านี้ไม่ได้ แม้จะยิงคำสั่งตรงข้ามหน้าจอ:
--      · แก้สิทธิ์ของบัญชีตัวเอง                    (กันยกระดับตัวเอง)
--      · แตะบัญชีของฝ่ายอื่น                        (ขอบเขต = ฝ่ายที่ตัวเองเป็นหัวหน้า)
--      · แตะบัญชีผู้บริหาร / ผู้ดูแลระบบ / หัวหน้าฝ่ายอื่น
--      · แจกสิทธิ์ระดับหัวหน้า (*_lead) / ผู้บริหาร / ผู้ดูแลระบบ ให้ใคร
--
-- 🐞 P2 ที่ไฟล์นี้ปิดด้วย: เดิม admin_set_roles เช็กแค่ has_role('manager')
--    → ผู้บริหารคนใดก็ได้ติ๊ก role 'admin' ให้ตัวเอง ทำให้ระดับ admin ไม่มีความหมายเชิงคุมสิทธิ์
--
-- ℹ️ "ลูกน้องห้ามอนุมัติใดๆ" ตามที่ทีมขอ — บังคับผ่านข้อ (3):
--    หัวหน้าแจกได้เฉพาะ role พื้นของฝ่ายตัวเอง ซึ่งไม่มีสิทธิ์อนุมัติระดับหัวหน้าอยู่แล้ว
--    (ยืนยัน Line Clearance · อนุมัติผลตรวจ in-process · อนุมัติผลผลิต = *_lead เท่านั้น)
--    ⚠️ ข้อยกเว้นที่ต้องรู้: role พื้นของบางฝ่ายมีการ "อนุมัติงานประจำวัน" ติดมากับหน้าที่
--       qa = ปล่อยผ่านล็อต · warehouse = กดพร้อมจ่ายของ · planner = ยืนยันแผนผลิต
--       ตัดออกไม่ได้โดยไม่ประดิษฐ์ role ย่อยใหม่ทั้งชุด — ผู้ใช้รับทราบและยืนยันแล้ว
-- ============================================================

-- ------------------------------------------------------------
-- (1) ธงบังคับเปลี่ยนรหัสผ่านครั้งแรก
--
--     ทำไมจำเป็น: หัวหน้าเป็นคนตั้ง "รหัสผ่านเริ่มต้น" ให้ลูกน้อง → หัวหน้ารู้รหัส
--     → ล็อกอินแทนลูกน้องได้ → ทำลายกฎ "สองลายเซ็นต้องคนละคน" ซึ่งเป็นหัวใจ GMP ของระบบนี้
--       (check_line_clearance 0062:317 · review_inprocess_check 0064:230)
--     ตั้งธงตอนสร้างบัญชีและตอนรีเซ็ตรหัส → เจ้าตัวต้องตั้งรหัสใหม่เองก่อนใช้งาน
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

comment on column public.profiles.must_change_password is
  'true = ต้องตั้งรหัสผ่านใหม่ก่อนใช้งาน (ตั้งตอนสร้างบัญชี/รีเซ็ตรหัส) — layout เด้งไป /change-password';

-- ------------------------------------------------------------
-- (2) helper แผนที่ role ↔ แผนก
-- ------------------------------------------------------------

-- ฝ่ายของ role หนึ่ง ๆ — ตัดคำต่อท้าย '_lead' ออก · role ที่ไม่สังกัดฝ่ายคืน null
--   production / production_lead → 'production'   ·   qa / qa_lead → 'qa'   ฯลฯ
--   manager / admin / cost       → null (ไม่มีฝ่ายให้ดูแล และไม่มีใครเป็นหัวหน้าของกลุ่มนี้)
create or replace function public.dept_of_role(_role app_role)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when _role::text in ('manager', 'admin', 'cost') then null
    when right(_role::text, 5) = '_lead' then left(_role::text, length(_role::text) - 5)
    else _role::text
  end;
$$;

comment on function public.dept_of_role(app_role) is
  'ฝ่ายของ role (ตัด _lead ออก) — manager/admin/cost คืน null · ต้องตรงกับ deptOfRole() ใน web/lib/data/dept-constants.ts';

-- ฝ่ายที่ "ผู้ใช้ปัจจุบัน" เป็นหัวหน้า (ถือหลาย *_lead พร้อมกันได้)
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
     and right(ur.role::text, 5) = '_lead'
     and public.dept_of_role(ur.role) is not null;
$$;

revoke execute on function public.current_head_depts() from public;
revoke execute on function public.current_head_depts() from anon;
grant  execute on function public.current_head_depts() to authenticated;

-- ฝ่ายที่โปรไฟล์หนึ่ง ๆ สังกัด (จาก role ที่ถืออยู่)
create or replace function public.profile_depts(p_profile_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct public.dept_of_role(ur.role)), '{}'::text[])
    from public.user_roles ur
   where ur.profile_id = p_profile_id
     and public.dept_of_role(ur.role) is not null;
$$;

revoke execute on function public.profile_depts(uuid) from public;
revoke execute on function public.profile_depts(uuid) from anon;
grant  execute on function public.profile_depts(uuid) to authenticated;

-- role ที่หัวหน้าแผนก "แจกให้ลูกน้องได้" = role พื้นของฝ่ายที่ตัวเองเป็นหัวหน้าเท่านั้น
--   🔒 ไม่รวม *_lead (ห้ามตั้งหัวหน้าคนใหม่) · ไม่รวม manager / admin / cost (dept_of_role คืน null)
create or replace function public.head_assignable_roles()
returns app_role[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(r), '{}'::app_role[])
    from unnest(enum_range(null::app_role)) as r
   where right(r::text, 5) <> '_lead'
     and public.dept_of_role(r) = any (public.current_head_depts());
$$;

revoke execute on function public.head_assignable_roles() from public;
revoke execute on function public.head_assignable_roles() from anon;
grant  execute on function public.head_assignable_roles() to authenticated;

comment on function public.head_assignable_roles() is
  'role ที่หัวหน้าแผนกกำหนดให้ลูกน้องได้ — role พื้นของฝ่ายตัวเองเท่านั้น (ไม่มี *_lead / manager / admin)';

-- ผู้ใช้ปัจจุบัน (ในฐานะหัวหน้าแผนก) ดูแลโปรไฟล์นี้ได้ไหม
create or replace function public.head_may_manage(p_profile_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_head       text[];
  v_target     text[];
  v_privileged boolean;
begin
  v_head := public.current_head_depts();
  if array_length(v_head, 1) is null then
    return false;                                   -- ไม่ได้เป็นหัวหน้าฝ่ายไหนเลย
  end if;
  if p_profile_id is null or p_profile_id = public.current_profile_id() then
    return false;                                   -- 🔒 แก้บัญชีตัวเองไม่ได้ (กันยกระดับตัวเอง)
  end if;

  -- 🔒 ห้ามแตะบัญชีผู้บริหาร / ผู้ดูแลระบบ / หัวหน้าฝ่ายใด ๆ (รวมหัวหน้าฝ่ายเดียวกัน)
  select exists (
    select 1 from public.user_roles ur
     where ur.profile_id = p_profile_id
       and (ur.role::text in ('manager', 'admin') or right(ur.role::text, 5) = '_lead')
  ) into v_privileged;
  if v_privileged then
    return false;
  end if;

  v_target := public.profile_depts(p_profile_id);

  -- บัญชีที่ยังไม่มีสิทธิ์เลย → หัวหน้ารับเข้าฝ่ายตัวเองได้
  --   จำเป็นสำหรับขั้นตอนสร้างบัญชี (โปรไฟล์เกิดจาก trigger ก่อน แล้วค่อยกำหนด role)
  --   ขอบเขตความเสี่ยงจำกัด: แจกได้เฉพาะ role พื้นของฝ่ายตัวเอง + audit_log บันทึกครบ
  if array_length(v_target, 1) is null then
    return true;
  end if;

  -- ทุกฝ่ายที่เป้าหมายสังกัด ต้องอยู่ในฝ่ายที่ผู้ใช้เป็นหัวหน้า
  return not exists (
    select 1 from unnest(v_target) as d where not (d = any (v_head))
  );
end;
$$;

revoke execute on function public.head_may_manage(uuid) from public;
revoke execute on function public.head_may_manage(uuid) from anon;
grant  execute on function public.head_may_manage(uuid) to authenticated;

comment on function public.head_may_manage(uuid) is
  'หัวหน้าแผนกดูแลโปรไฟล์นี้ได้ไหม — ต้องเป็นลูกน้องในฝ่ายตัวเอง · ไม่ใช่ตัวเอง · ไม่ใช่ผู้บริหาร/admin/หัวหน้า';

-- ------------------------------------------------------------
-- (3) admin_set_roles — รับ 2 ระดับ + ปิดช่อง manager ยกระดับเป็น admin
--     บอดี้ยกมาจาก 0013:42-84 แก้เฉพาะบล็อกตรวจสิทธิ์ (ส่วน delete/insert เดิมครบ)
-- ------------------------------------------------------------
create or replace function public.admin_set_roles(
  p_profile_id uuid,
  p_roles      app_role[]
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor      uuid;
  v_is_manager boolean;
begin
  v_actor := public.current_profile_id();
  if v_actor is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if p_profile_id is null
     or not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'ไม่พบผู้ใช้ที่เลือก';
  end if;

  v_is_manager := public.has_role('manager');

  if v_is_manager then
    -- 🔒 P2: ให้สิทธิ์ 'admin' ได้เฉพาะผู้ที่เป็น admin อยู่จริง
    --    (has_exact_role ไม่นับการสืบทอดจาก manager/lead — ดู 0067:109)
    if ('admin' = any (coalesce(p_roles, '{}'::app_role[])::text[]))
       and not public.has_exact_role('admin') then
      raise exception 'ให้สิทธิ์ผู้ดูแลระบบ (admin) ได้เฉพาะผู้ที่เป็นผู้ดูแลระบบอยู่แล้ว';
    end if;

    -- กัน lockout (เดิม 0013:66-70): บัญชีตัวเองต้องเหลือ manager หรือ admin อย่างน้อยหนึ่ง
    if p_profile_id = v_actor
       and not (coalesce(p_roles, '{}'::app_role[])::text[] && array['manager', 'admin']) then
      raise exception 'ต้องคงสิทธิ์ผู้บริหารหรือผู้ดูแลระบบของบัญชีตัวเองไว้ (กันล็อกตัวเองออก)';
    end if;

  elsif public.head_may_manage(p_profile_id) then
    -- หัวหน้าแผนก: แจกได้เฉพาะ role พื้นของฝ่ายตัวเอง
    if exists (
      select 1 from unnest(coalesce(p_roles, '{}'::app_role[])) as r
       where not (r = any (public.head_assignable_roles()))
    ) then
      raise exception 'หัวหน้าแผนกกำหนดได้เฉพาะสิทธิ์ของพนักงานในฝ่ายตัวเอง — ให้สิทธิ์ระดับหัวหน้า/ผู้บริหาร/ผู้ดูแลระบบไม่ได้';
    end if;

  else
    raise exception 'ไม่มีสิทธิ์จัดการสิทธิ์ของผู้ใช้รายนี้';
  end if;

  perform set_config('app.current_profile_id', v_actor::text, true);
  perform set_config('app.audit_reason',
    case when v_is_manager then 'แก้สิทธิ์ผู้ใช้ (ผู้บริหาร)' else 'แก้สิทธิ์ผู้ใช้ (หัวหน้าแผนก)' end,
    true);

  delete from public.user_roles where profile_id = p_profile_id;

  if p_roles is not null and array_length(p_roles, 1) is not null then
    insert into public.user_roles (profile_id, role)
    select p_profile_id, r
      from unnest(p_roles) as r
    on conflict (profile_id, role) do nothing;
  end if;
end;
$fn$;

grant execute on function public.admin_set_roles(uuid, app_role[]) to authenticated;

-- ------------------------------------------------------------
-- (4) admin_update_profile — รับ 2 ระดับ (บอดี้เดิม 0012:67-104)
-- ------------------------------------------------------------
create or replace function public.admin_update_profile(
  p_profile_id uuid,
  p_full_name  text,
  p_department text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor      uuid;
  v_is_manager boolean;
begin
  v_actor := public.current_profile_id();
  if v_actor is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'ไม่พบผู้ใช้ที่เลือก';
  end if;

  v_is_manager := public.has_role('manager');
  if not v_is_manager and not public.head_may_manage(p_profile_id) then
    raise exception 'ไม่มีสิทธิ์แก้ข้อมูลของผู้ใช้รายนี้';
  end if;

  p_full_name := btrim(coalesce(p_full_name, ''));
  if p_full_name = '' then
    raise exception 'กรุณาระบุชื่อ-สกุล';
  end if;

  perform set_config('app.current_profile_id', v_actor::text, true);
  perform set_config('app.audit_reason',
    case when v_is_manager then 'แก้ข้อมูลผู้ใช้ (ผู้บริหาร)' else 'แก้ข้อมูลผู้ใช้ (หัวหน้าแผนก)' end,
    true);

  update public.profiles
     set full_name  = p_full_name,
         department = nullif(btrim(coalesce(p_department, '')), '')
   where id = p_profile_id;
end;
$fn$;

grant execute on function public.admin_update_profile(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- (5) admin_set_active — รับ 2 ระดับ (บอดี้เดิม 0012:114-152)
--     "ระงับบัญชีตัวเองไม่ได้" ยังอยู่ · head_may_manage กันเคสตัวเองซ้ำอีกชั้น
-- ------------------------------------------------------------
create or replace function public.admin_set_active(
  p_profile_id uuid,
  p_is_active  boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor      uuid;
  v_is_manager boolean;
begin
  v_actor := public.current_profile_id();
  if v_actor is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if p_profile_id is null
     or not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'ไม่พบผู้ใช้ที่เลือก';
  end if;
  if p_profile_id = v_actor and p_is_active is false then
    raise exception 'ระงับบัญชีตัวเองไม่ได้';
  end if;

  v_is_manager := public.has_role('manager');
  if not v_is_manager and not public.head_may_manage(p_profile_id) then
    raise exception 'ไม่มีสิทธิ์จัดการสถานะบัญชีของผู้ใช้รายนี้';
  end if;

  perform set_config('app.current_profile_id', v_actor::text, true);
  perform set_config(
    'app.audit_reason',
    (case when p_is_active then 'เปิดใช้งานบัญชี' else 'ระงับบัญชี' end)
    || (case when v_is_manager then ' (ผู้บริหาร)' else ' (หัวหน้าแผนก)' end),
    true
  );

  update public.profiles
     set is_active = p_is_active
   where id = p_profile_id;
end;
$fn$;

grant execute on function public.admin_set_active(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- (6) admin_mark_password_reset — บันทึกร่องรอยการรีเซ็ตรหัสผ่าน + บังคับเปลี่ยนครั้งถัดไป
--
--     🐞 P7 ที่ปิด: การรีเซ็ตรหัสผ่านเดิมคุยกับ Supabase Auth Admin API ตรง ๆ
--        ไม่แตะตารางที่มี trigger เลย → ไม่มีร่องรอยใน audit_log ว่าใครรีเซ็ตรหัสของใครเมื่อไหร่
--        ฟังก์ชันนี้เขียนแถวลง profiles (มี trg_audit_profiles) จึงได้ audit ครบ
--
--     ℹ️ การเปลี่ยนรหัสจริงยังทำที่ server action ด้วย service key (SQL ทำแทนไม่ได้)
--        ฟังก์ชันนี้จึงเป็น "ตัวบันทึก + ตั้งธง" ที่เรียกคู่กันเสมอ
-- ------------------------------------------------------------
create or replace function public.admin_mark_password_reset(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor      uuid;
  v_is_manager boolean;
begin
  v_actor := public.current_profile_id();
  if v_actor is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if p_profile_id is null
     or not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'ไม่พบผู้ใช้ที่เลือก';
  end if;

  v_is_manager := public.has_role('manager');
  if not v_is_manager and not public.head_may_manage(p_profile_id) then
    raise exception 'ไม่มีสิทธิ์รีเซ็ตรหัสผ่านของผู้ใช้รายนี้';
  end if;

  perform set_config('app.current_profile_id', v_actor::text, true);
  perform set_config('app.audit_reason',
    case when v_is_manager then 'รีเซ็ตรหัสผ่าน (ผู้บริหาร)' else 'รีเซ็ตรหัสผ่าน (หัวหน้าแผนก)' end,
    true);

  update public.profiles
     set must_change_password = true
   where id = p_profile_id;
end;
$fn$;

revoke execute on function public.admin_mark_password_reset(uuid) from public;
revoke execute on function public.admin_mark_password_reset(uuid) from anon;
grant  execute on function public.admin_mark_password_reset(uuid) to authenticated;

-- ------------------------------------------------------------
-- (7) clear_must_change_password — เจ้าตัวตั้งรหัสใหม่สำเร็จแล้วปลดธง
--     ปลดได้เฉพาะบัญชีตัวเองเท่านั้น (ไม่รับพารามิเตอร์ = ไม่มีทางปลดให้คนอื่น)
-- ------------------------------------------------------------
create or replace function public.clear_must_change_password()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor uuid;
begin
  v_actor := public.current_profile_id();
  if v_actor is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;

  perform set_config('app.current_profile_id', v_actor::text, true);
  perform set_config('app.audit_reason', 'ผู้ใช้ตั้งรหัสผ่านใหม่ด้วยตัวเอง', true);

  update public.profiles
     set must_change_password = false
   where id = v_actor;
end;
$fn$;

revoke execute on function public.clear_must_change_password() from public;
revoke execute on function public.clear_must_change_password() from anon;
grant  execute on function public.clear_must_change_password() to authenticated;

-- ------------------------------------------------------------
-- (8) 🔴 ปิดช่อง: policy update_own_profile ให้ผู้ใช้แก้แถวโปรไฟล์ตัวเองตรงจากเบราว์เซอร์ได้
--
--     ที่มา: 0004:119-123 (และ 0005:114-118 ซ้ำ) — for update using (auth_user_id = auth.uid())
--     ผลจริง: ผู้ใช้ยิง PATCH /rest/v1/profiles?id=eq.<ตัวเอง> แล้ว
--       · ตั้ง must_change_password = false  → ข้ามการบังคับเปลี่ยนรหัสผ่านในข้อ (1)
--       · ตั้ง is_active = true              → ปลดธงระงับบัญชีของตัวเอง
--       · แก้ full_name / department         → แก้ชื่อที่ไปปรากฏบนลายเซ็น/เอกสาร eBR โดยไม่ผ่าน RPC
--     ทั้งหมดนี้ข้าม app.audit_reason → audit_log ได้แถวที่ไม่มีเหตุผลกำกับ
--
--     ✅ ปลอดภัยที่จะลบ: ไล่ .update(/.upsert( บน profiles ทั้ง web/app และ web/lib แล้ว
--        ไม่มีโค้ดไหนเขียนตารางนี้ตรง ๆ เลย — ทุกเส้นทางผ่าน RPC admin_* / clear_must_change_password
-- ------------------------------------------------------------
drop policy if exists update_own_profile on public.profiles;

-- ------------------------------------------------------------
-- ตรวจผลหลัง paste
-- ------------------------------------------------------------
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='profiles' and column_name='must_change_password';
--
-- select tablename, policyname, cmd from pg_policies
--  where schemaname='public' and tablename='profiles';   -- ต้องเหลือแต่ read_authenticated (SELECT)
--
-- impersonate ผู้ใช้ที่ถือ production_lead แล้วรัน:
-- select public.current_head_depts()      as ควรได้_production,
--        public.head_assignable_roles()   as ควรได้_production_อย่างเดียว;
