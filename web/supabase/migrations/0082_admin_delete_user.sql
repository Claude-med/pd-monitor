-- ============================================================
-- PD Monitor — 0082_admin_delete_user.sql  (ลบบัญชีผู้ใช้จากหน้าจัดการผู้ใช้)
--   (1) profiles.deleted_at / deleted_by — ธง "บัญชีถูกลบแล้ว"
--   (2) admin_delete_user() — ผู้บริหาร/admin ลบได้ทุกบัญชี · หัวหน้าแผนกลบได้เฉพาะลูกน้องในฝ่ายตัวเอง
-- รัน "หลัง" 0079 (ใช้ head_may_manage) · ไม่มี enum ใหม่ → paste รอบเดียวจบ
--
-- 🔑 ทำไมต้องมี 2 โหมด (ลบจริง / ซ่อน):
--    profiles.id ถูกอ้างเป็น FK จาก 41 คอลัมน์ / 28 ตาราง และเกือบทั้งหมดเป็น NO ACTION
--    ตัวที่บล็อกหนักสุดคือ audit_log.changed_by (0002:18) และ approvals.profile_id ที่เป็น not null
--    (= ลายเซ็นอิเล็กทรอนิกส์) ⇒ บัญชีที่เคยทำงานในระบบแล้ว "ลบแถวทิ้งไม่ได้" ตามข้อกำหนด GMP
--    → บัญชีสะอาด (สร้างผิด ยังไม่เคยทำอะไร) ลบแถวทิ้งจริง
--    → บัญชีที่มีประวัติ ลบบัญชีล็อกอิน + ล้าง role + ปลดอีเมล + ตั้ง deleted_at (หายจากรายชื่อ)
--      ชื่อในประวัติเก่ายังอ่านได้ครบ เพราะแถว profiles ยังอยู่
-- ============================================================

-- ------------------------------------------------------------
-- (1) คอลัมน์ธง "ลบแล้ว"
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);

comment on column public.profiles.deleted_at is
  'เวลาที่บัญชีถูกลบ — null = ใช้งานอยู่ · ไม่ null = ซ่อนจากรายชื่อผู้ใช้ (แถวยังอยู่เพื่อให้ประวัติเก่าอ่านชื่อได้ตาม GMP)';

-- รายชื่อผู้ใช้ปกติอ่านเฉพาะที่ยังไม่ถูกลบ → partial index พอ ไม่ต้อง index ทั้งตาราง
create index if not exists idx_profiles_not_deleted
  on public.profiles (id)
  where deleted_at is null;

-- ------------------------------------------------------------
-- (2) admin_delete_user — ลบบัญชี 1 ราย
--
--     ยาม 6 ชั้น (ยกโครงจาก admin_set_active · 0079:313-355):
--       1. ต้องล็อกอิน
--       2. ต้องมีโปรไฟล์นั้นจริง และยังไม่ถูกลบ
--       3. ลบบัญชีตัวเองไม่ได้
--       4. ผู้บริหาร/admin ลบได้ทุกบัญชี · คนอื่นต้องผ่าน head_may_manage()
--          (head_may_manage กัน "ตัวเอง / manager / admin / *_lead / คนนอกฝ่าย" ให้อยู่แล้ว)
--       5. บัญชีที่ถือ role admin — ลบได้เฉพาะผู้ที่เป็น admin จริง (แพตเทิร์นเดียวกับ P2 · 0079:216-221)
--       6. กัน lockout — ห้ามลบจนไม่เหลือผู้บริหาร/ผู้ดูแลระบบที่ใช้งานได้เลยสักคน
-- ------------------------------------------------------------
create or replace function public.admin_delete_user(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor      uuid;
  v_is_manager boolean;
  v_name       text;
  v_deleted    timestamptz;
  v_action     text;
begin
  v_actor := public.current_profile_id();
  if v_actor is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;

  select full_name, deleted_at into v_name, v_deleted
    from public.profiles where id = p_profile_id;
  if v_name is null then
    raise exception 'ไม่พบผู้ใช้ที่เลือก';
  end if;
  if v_deleted is not null then
    raise exception 'บัญชีนี้ถูกลบไปแล้ว';
  end if;

  if p_profile_id = v_actor then
    raise exception 'ลบบัญชีตัวเองไม่ได้';
  end if;

  v_is_manager := public.has_role('manager');
  if not v_is_manager and not public.head_may_manage(p_profile_id) then
    raise exception 'ไม่มีสิทธิ์ลบบัญชีของผู้ใช้รายนี้ — หัวหน้าแผนกลบได้เฉพาะพนักงานในฝ่ายตัวเอง';
  end if;

  -- 🔒 บัญชีผู้ดูแลระบบ ลบได้เฉพาะผู้ดูแลระบบด้วยกัน (has_exact_role ไม่นับการสืบทอด — 0067:109)
  if exists (select 1 from public.user_roles
              where profile_id = p_profile_id and role::text = 'admin')
     and not public.has_exact_role('admin') then
    raise exception 'ลบบัญชีผู้ดูแลระบบ (admin) ได้เฉพาะผู้ดูแลระบบเท่านั้น';
  end if;

  -- 🔒 กัน lockout — ต้องเหลือคนที่เข้าหน้าจัดการผู้ใช้ได้อย่างน้อย 1 คนเสมอ
  if not exists (
    select 1
      from public.user_roles ur
      join public.profiles p on p.id = ur.profile_id
     where ur.role::text in ('manager', 'admin')
       and p.id <> p_profile_id
       and p.is_active
       and p.deleted_at is null
  ) then
    raise exception 'ลบไม่ได้ — จะไม่เหลือบัญชีผู้บริหาร/ผู้ดูแลระบบที่ใช้งานได้เลย';
  end if;

  -- ---------- audit: trigger trg_audit_profiles (0002:83) เก็บทั้งแถวเดิมให้เอง ----------
  perform set_config('app.current_profile_id', v_actor::text, true);
  perform set_config('app.audit_reason',
    'ลบบัญชีผู้ใช้ ' || v_name
    || (case when v_is_manager then ' (ผู้บริหาร)' else ' (หัวหน้าแผนก)' end), true);

  -- ---------- ลบจริงก่อน ถ้าติด FK ค่อยตกไปโหมดซ่อน ----------
  -- ⚠️ ตั้งใจใช้ exception แทนการไล่นับ FK เอง 41 คอลัมน์:
  --    กติกาอยู่ที่ constraint จริงในฐานข้อมูล จึงไม่ต้องตามแก้ทุกครั้งที่เพิ่มตารางใหม่
  --    (บทเรียน 0080:227-228 — ยกเงื่อนไขมาเขียนซ้ำแล้วตกกรณี)
  begin
    -- user_roles / notification_reads หายตามเอง (on delete cascade)
    delete from public.profiles where id = p_profile_id;
    v_action := 'deleted';

  exception when foreign_key_violation then
    -- บัญชีนี้มีลายเซ็น/บันทึก/ประวัติผูกอยู่ → เก็บแถวไว้ให้ประวัติเก่ายังอ่านชื่อได้
    delete from public.user_roles where profile_id = p_profile_id;

    update public.profiles
       set is_active            = false,
           auth_user_id         = null,
           -- 🔑 ปลดอีเมลด้วย ไม่งั้น handle_new_user (0004:58-61) จะผูกบัญชีใหม่ที่ใช้อีเมลเดิม
           --    เข้ากับโปรไฟล์ที่ลบแล้วใบนี้ = ปลุกบัญชีเก่ากลับมาพร้อมธง deleted_at ค้าง
           email                = null,
           must_change_password = false,
           deleted_at           = now(),
           deleted_by           = v_actor
     where id = p_profile_id;
    v_action := 'archived';
  end;

  return jsonb_build_object('action', v_action, 'name', v_name);
end;
$fn$;

revoke execute on function public.admin_delete_user(uuid) from public;
revoke execute on function public.admin_delete_user(uuid) from anon;
grant  execute on function public.admin_delete_user(uuid) to authenticated;

comment on function public.admin_delete_user(uuid) is
  'ลบบัญชีผู้ใช้ 1 ราย — ผู้บริหาร/admin ลบได้ทุกบัญชี · หัวหน้าแผนกเฉพาะลูกน้องในฝ่ายตัวเอง · บัญชีที่มีประวัติจะถูกซ่อน (deleted_at) แทนการลบแถวตาม GMP';

-- ============================================================
-- ✅ ตรวจหลัง paste (รันแยกใน SQL Editor)
--
--   -- 1) คอลัมน์ใหม่ต้องมีครบ 2 ตัว
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'profiles'
--      and column_name in ('deleted_at', 'deleted_by');
--
--   -- 2) ฟังก์ชันต้องมีจริง
--   select proname from pg_proc where proname = 'admin_delete_user';
--
--   -- 3) ยังไม่มีใครถูกลบ (ควรได้ 0)
--   select count(*) from public.profiles where deleted_at is not null;
-- ============================================================
