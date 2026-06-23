-- ============================================================
-- PD Monitor — D10 / 0013_admin_role.sql
-- เพิ่ม role 'admin' = ทำได้ทุกอย่าง (ครอบทุกฝ่าย)
--   วิธี: ทำให้ has_role() ถือว่า "ใครมี role admin = มีทุก role"
--         → ครอบ guard ของ RPC ทุกตัว + RLS policy ทุกข้อ โดยไม่ต้องแก้ทีละจุด
-- รัน "หลัง" 0001–0012
--
-- หมายเหตุ: ใช้การเทียบแบบ text ('admin') ในตัวฟังก์ชัน → ปลอดภัยแม้รันไฟล์นี้
--           รวดเดียว (ไม่ติดข้อจำกัด "ใช้ค่า enum ใหม่ในทรานแซกชันเดียวกับที่เพิ่ง ADD")
-- ============================================================

-- ------------------------------------------------------------
-- 1) เพิ่มค่า 'admin' เข้า enum app_role
-- ------------------------------------------------------------
alter type app_role add value if not exists 'admin';

-- ------------------------------------------------------------
-- 2) has_role(): admin ผ่านทุก role
--    (เดิม: ผู้ใช้มี role ที่ถามตรงๆ ไหม → เพิ่มเงื่อนไข "หรือเป็น admin")
-- ------------------------------------------------------------
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
       and (ur.role = _role or ur.role::text = 'admin')
  );
$$;

-- ------------------------------------------------------------
-- 3) admin_set_roles(): ปรับกัน lockout ให้รองรับ admin
--    บัญชีตัวเองต้องคงสิทธิ์ 'manager' หรือ 'admin' อย่างน้อยหนึ่ง
--    (สองสิทธินี้คือกลุ่มที่เข้าหน้าจัดการผู้ใช้ได้)
-- ------------------------------------------------------------
create or replace function public.admin_set_roles(
  p_profile_id uuid,
  p_roles      app_role[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := public.current_profile_id();
  if v_actor is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.has_role('manager') then
    raise exception 'เฉพาะผู้บริหาร/ผู้ดูแลระบบจัดการสิทธิ์ผู้ใช้ได้';
  end if;
  if p_profile_id is null
     or not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'ไม่พบผู้ใช้ที่เลือก';
  end if;

  -- กัน lockout: บัญชีตัวเองต้องเหลือ manager หรือ admin อย่างน้อยหนึ่ง
  if p_profile_id = v_actor
     and not (coalesce(p_roles, '{}'::app_role[])::text[] && array['manager', 'admin']) then
    raise exception 'ต้องคงสิทธิ์ผู้บริหารหรือผู้ดูแลระบบของบัญชีตัวเองไว้ (กันล็อกตัวเองออก)';
  end if;

  perform set_config('app.current_profile_id', v_actor::text, true);
  perform set_config('app.audit_reason', 'แก้สิทธิ์ผู้ใช้ (admin)', true);

  delete from public.user_roles where profile_id = p_profile_id;

  if p_roles is not null and array_length(p_roles, 1) is not null then
    insert into public.user_roles (profile_id, role)
    select p_profile_id, r
      from unnest(p_roles) as r
    on conflict (profile_id, role) do nothing;
  end if;
end;
$$;

grant execute on function public.admin_set_roles(uuid, app_role[]) to authenticated;
