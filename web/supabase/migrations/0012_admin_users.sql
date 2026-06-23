-- ============================================================
-- PD Monitor — D10 / 0012_admin_users.sql
-- หน้า Admin จัดการผู้ใช้ (A0) — กำหนด role / แก้โปรไฟล์ / ระงับบัญชี
--   * การสร้างบัญชี + รีเซ็ตรหัสผ่าน = ทำผ่าน Supabase Auth Admin API ฝั่ง server
--     (lib/supabase/admin.ts) — ไม่ใช่ SQL
--   * "เขียน role / แก้โปรไฟล์ / ระงับ" = ผ่านฟังก์ชัน security definer ด้านล่าง
--     เพื่อบังคับสิทธิ์ manager ที่ server + ตั้ง audit GUC ให้ trigger log_audit เก็บ "ใครทำ"
-- รัน "หลัง" 0001–0011
-- ============================================================

-- ------------------------------------------------------------
-- 1) admin_set_roles — กำหนด role ของผู้ใช้ (แทนที่ชุดเดิมทั้งหมด)
--    manager เท่านั้น · กัน manager ถอด role 'manager' ของตัวเอง (lockout)
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
    raise exception 'เฉพาะผู้บริหารจัดการสิทธิ์ผู้ใช้ได้';
  end if;
  if p_profile_id is null then
    raise exception 'ไม่พบผู้ใช้ที่เลือก';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'ไม่พบผู้ใช้ที่เลือก';
  end if;

  -- กัน lockout: ห้ามถอดสิทธิ์ผู้บริหารออกจากบัญชีตัวเอง
  if p_profile_id = v_actor
     and not ('manager' = any (coalesce(p_roles, '{}'::app_role[]))) then
    raise exception 'ถอดสิทธิ์ผู้บริหารของบัญชีตัวเองไม่ได้ (กันล็อกตัวเองออก)';
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

-- ------------------------------------------------------------
-- 2) admin_update_profile — แก้ชื่อ/แผนกของผู้ใช้ (manager)
--    ไม่ให้แก้ email ที่นี่ (email ผูกกับ auth.users — แก้แล้วจะหลุดการเชื่อม)
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
as $$
declare
  v_actor uuid;
begin
  v_actor := public.current_profile_id();
  if v_actor is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.has_role('manager') then
    raise exception 'เฉพาะผู้บริหารแก้ข้อมูลผู้ใช้ได้';
  end if;

  p_full_name := btrim(coalesce(p_full_name, ''));
  if p_full_name = '' then
    raise exception 'กรุณาระบุชื่อ-สกุล';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'ไม่พบผู้ใช้ที่เลือก';
  end if;

  perform set_config('app.current_profile_id', v_actor::text, true);
  perform set_config('app.audit_reason', 'แก้ข้อมูลผู้ใช้ (admin)', true);

  update public.profiles
     set full_name  = p_full_name,
         department = nullif(btrim(coalesce(p_department, '')), '')
   where id = p_profile_id;
end;
$$;

grant execute on function public.admin_update_profile(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 3) admin_set_active — เปิด/ปิดการใช้งานบัญชี (ธงในแอป)
--    manager · กันปิดบัญชีตัวเอง
--    หมายเหตุ: การ "บล็อกล็อกอินจริง" ทำที่ฝั่ง server ด้วย auth.admin (ban/unban)
--              ฟังก์ชันนี้ดูแลธง is_active ในตาราง (แสดงผล + audit)
-- ------------------------------------------------------------
create or replace function public.admin_set_active(
  p_profile_id uuid,
  p_is_active  boolean
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
    raise exception 'เฉพาะผู้บริหารจัดการสถานะบัญชีได้';
  end if;
  if p_profile_id is null
     or not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'ไม่พบผู้ใช้ที่เลือก';
  end if;
  if p_profile_id = v_actor and p_is_active is false then
    raise exception 'ระงับบัญชีตัวเองไม่ได้';
  end if;

  perform set_config('app.current_profile_id', v_actor::text, true);
  perform set_config(
    'app.audit_reason',
    case when p_is_active then 'เปิดใช้งานบัญชี (admin)' else 'ระงับบัญชี (admin)' end,
    true
  );

  update public.profiles
     set is_active = p_is_active
   where id = p_profile_id;
end;
$$;

grant execute on function public.admin_set_active(uuid, boolean) to authenticated;
