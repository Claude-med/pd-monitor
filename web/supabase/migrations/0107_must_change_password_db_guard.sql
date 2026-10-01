-- ============================================================
-- PD Monitor — รีวิวก่อนทดสอบรอบ 2 (ก้อน 3) / 0107_must_change_password_db_guard.sql
-- บัญชีที่ "ยังต้องตั้งรหัสผ่านใหม่" ใช้งานฐานข้อมูลไม่ได้ จนกว่าจะตั้งรหัสของตัวเอง
--
-- 🚨 ที่มา: ธง must_change_password (0079) บังคับแค่ที่ (app)/layout.tsx
--    คนที่ตั้งรหัสเริ่มต้นให้ (ผู้บริหาร/หัวหน้าแผนก) รู้รหัสนั้น → ล็อกอินแทนเจ้าของบัญชี
--    แล้วยิง RPC ตรงจาก devtools ได้ (เช่น ลงนาม/อนุมัติในนามคนอื่น)
--    = ทำลายกฎ "สองลายเซ็นต้องคนละคน" ซึ่งเป็นเหตุผลที่มีธงนี้ตั้งแต่แรก
--
-- 🔧 แก้: helper ตัวตน/สิทธิ์ทั้ง 5 ตัว (ชุดเดียวกับ 0105) เพิ่มเงื่อนไข "not must_change_password"
--    ⇒ ทุก RPC มองบัญชีนี้เหมือนยังไม่ได้ล็อกอิน
--    clear_must_change_password() เดิมพึ่ง current_profile_id() → ถ้าไม่แก้ด้วย ผู้ใช้จะปลดธงตัวเองไม่ได้
--    จึงเขียนใหม่ให้หาโปรไฟล์จาก auth.uid() ตรง ๆ
--
-- ℹ️ ผลกับผู้ใช้จริง: ไม่เปลี่ยน — layout เด้งบัญชีนี้ไปหน้าตั้งรหัสอยู่แล้ว
--    หน้าตั้งรหัสใช้แค่ updateUser (ชั้น Auth) + clear_must_change_password ซึ่งยังทำงานได้
-- รัน "หลัง" 0106 · รันซ้ำได้
-- ============================================================

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
     and not must_change_password                 -- 0107
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
       and not p.must_change_password             -- 0107
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
       and not p.must_change_password             -- 0107
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
       and not p.must_change_password             -- 0107
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
     and not p.must_change_password               -- 0107
     and right(ur.role::text, 5) = '_lead'
     and public.dept_of_role(ur.role) is not null;
$$;


-- ------------------------------------------------------------
-- clear_must_change_password — ยกบอดี้ 0079 · เปลี่ยนวิธีหาตัวผู้ใช้
--   เดิม current_profile_id() → หลังไฟล์นี้คืน null สำหรับบัญชีที่ยังติดธง = ปลดธงตัวเองไม่ได้
--   ตอนนี้หาโปรไฟล์จาก auth.uid() ตรง ๆ (ยังกันบัญชีที่ถูกระงับ/ลบเหมือนเดิม)
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
  select id into v_actor
    from public.profiles
   where auth_user_id = (select auth.uid())
     and is_active
     and deleted_at is null
   limit 1;
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


-- ============================================================
-- ✅ ตรวจหลัง paste (รันทีละข้อ)
--
-- ข้อ 1 · helper ทั้ง 5 ตัวเช็กธงบังคับเปลี่ยนรหัส (และด่านระงับบัญชีของ 0105 ยังอยู่)
--   select proname,
--          prosrc like '%must_change_password%' and prosrc like '%is_active%' as ok
--     from pg_proc
--    where proname in ('current_profile_id','has_role','has_exact_role','is_any_lead','current_head_depts')
--    order by proname;
--   ✅ 5 แถว ok = true ทุกแถว   ❌ มีแถว false = ไฟล์รันไม่ครบ → paste ใหม่ทั้งไฟล์
--
-- ข้อ 2 · ผู้ใช้ยังปลดธงตัวเองได้ (ไม่พึ่ง current_profile_id แล้ว)
--   select prosrc not like '%current_profile_id%' and prosrc like '%auth.uid()%'
--     from pg_proc where proname = 'clear_must_change_password';
--   ✅ true   ❌ false = ไฟล์ยังไม่ได้รัน → ผู้ใช้ใหม่จะติดอยู่หน้าตั้งรหัส แจ้ง Claude ทันที
--
-- ข้อ 3 · (ดูเฉย ๆ) ตอนนี้มีกี่บัญชีที่ยังต้องตั้งรหัสใหม่ — บัญชีพวกนี้จะใช้งานได้หลังตั้งรหัสเอง
--   select full_name, email from public.profiles
--    where must_change_password and deleted_at is null order by full_name;
--   ℹ️ ได้กี่แถวก็ได้ (0 แถว = ทุกคนตั้งรหัสเองแล้ว)
-- ============================================================
