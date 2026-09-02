-- ============================================================
-- PD Monitor — ระบบสิทธิ์ (Part E) / 0078_role_guards_align.sql
-- ทำให้ role "หัวหน้า" ได้สิทธิ์ของลูกน้องในฝ่ายตัวเองจริง + สอน 4 role ใหม่ให้ระบบฝ่ายรู้จัก
--   (1) has_role()           — X_lead ถือว่ามีสิทธิ์ของ X ด้วย  ← แก้จุดเดียว ครอบ guard ทั้งระบบ
--   (2) current_role_group() — เพิ่ม 4 lead ใหม่ (ใช้จับคู่แผนกของ Incident Case)
--   (3) current_role_badge() — เพิ่ม 4 lead ใหม่ (ป้ายฝ่ายที่โชว์บนหมายเหตุ)
-- รัน "หลัง" 0077 (ต้อง paste 0077 ให้ผ่านก่อน — ไฟล์นี้ใช้ค่า enum ใหม่)
--
-- 🐞 บั๊กที่ไฟล์นี้ปิด (เจอตอนตรวจภาพรวม role ก่อนส่งแอปให้ผู้ใช้จริง):
--    0060 เพิ่ม production_lead / qc_lead เข้า enum แต่ "ไม่เคยกลับไปแก้ guard เก่า"
--    → หัวหน้าฝ่ายผลิตเห็นปุ่มแต่กดไม่ผ่าน 3 จุด (can_manage_machines 0039:34 ·
--      can_set_job_lot 0049:31 · can_edit_job_materials 0056:117 ไม่มี production_lead)
--    → หัวหน้า QC ลงนาม "QC ผ่าน / QC ตีกลับ" ไม่ได้เลย
--      (sign_job_decision 0008:84 เช็ก has_role('qc') ตรง ๆ)
--    ฝั่งแอป role-access.ts:73-99 เขียนไว้ตั้งแต่แรกว่าหัวหน้า "ทำได้ทุกอย่างเหมือนลูกน้อง"
--    → ไฟล์นี้คือการทำให้ DB ตรงกับที่ประกาศไว้
--
-- 💡 ทำไมแก้ที่ has_role() จุดเดียว แทนไล่แก้ guard ทีละตัว (15 ฟังก์ชัน):
--    has_role() เป็นคอขวดที่ guard เกือบทุกตัวเรียกใช้ — แพทเทิร์นเดียวกับที่ 0013 ใช้
--    ทำให้ admin ผ่านทุก role โดยไม่ต้องแก้ทีละจุด → แก้ตรงนี้ครั้งเดียวได้ครบ:
--      can_plan_jobs · can_manage_products · can_set_lot_status · can_manage_machines ·
--      can_set_machine_schedule · can_set_job_lot · can_edit_job_materials ·
--      can_set_job_material_status · can_record_qa_sample · can_review_incident ·
--      receive_fg · sign_job_decision · advance_job_status · review_edit_request
--    และ role หัวหน้าใหม่ทั้ง 4 ตัวได้สิทธิ์ฝ่ายตัวเองทันที ไม่ต้องแตะฟังก์ชันไหนอีก
--
-- 🚨 การสืบทอดเป็น "ทางเดียว: lead → base" เท่านั้น
--      has_role('production')      → true ถ้าถือ production หรือ production_lead
--      has_role('production_lead') → true เฉพาะผู้ที่ถือ production_lead จริง ๆ
--    ⇒ กฎ "สองลายเซ็น" ยังอยู่ครบ:
--      · พนักงานฝ่ายผลิตยังยืนยัน Line Clearance เองไม่ได้ (can_check_line_clearance 0062:119)
--      · QC พนักงานยังอนุมัติผลตรวจเองไม่ได้ (can_approve_inprocess 0064:78)
--      · กฎ "ผู้อนุมัติต้องคนละคนกับผู้ทำ" บังคับที่ระดับแถวใน DB อยู่แล้ว ไม่กระทบ
-- ============================================================

-- ------------------------------------------------------------
-- (1) has_role — เพิ่มการสืบทอด "หัวหน้าฝ่าย → สิทธิ์ของฝ่ายนั้น"
--
--     เทียบแบบ text ว่า role ที่ผู้ใช้ถือ = ชื่อ role ที่ถาม + '_lead' หรือไม่
--     (production→production_lead · qc→qc_lead · qa→qa_lead ·
--      warehouse→warehouse_lead · planner→planner_lead · engineering→engineering_lead)
--
--     ทำไมใช้การต่อสตริงแทนตาราง mapping:
--       · ชื่อ role หัวหน้าในระบบนี้ตั้งเป็น "<ฝ่าย>_lead" ทุกตัวตั้งแต่ 0060 แล้ว
--       · role หัวหน้าที่เพิ่มในอนาคตจะได้สิทธิ์เองทันที ไม่ต้องกลับมาแก้ไฟล์นี้ซ้ำ
--         (= ไม่เกิดบั๊กแบบเดียวกับที่ไฟล์นี้กำลังปิดอยู่)
--       · เทียบเป็น text จึงไม่ error แม้ชื่อที่คำนวณได้ไม่มีอยู่จริงใน enum
--         (has_role('manager') → มองหา 'manager_lead' ซึ่งไม่มี = ไม่ match เฉย ๆ)
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
       and (
            ur.role = _role                           -- มี role นั้นตรง ๆ
         or ur.role::text = 'admin'                   -- admin ผ่านทุก role (0013)
         or ur.role::text = _role::text || '_lead'    -- หัวหน้าฝ่าย ผ่านสิทธิ์ของฝ่ายตัวเอง (0078)
       )
  );
$$;

comment on function public.has_role(app_role) is
  'ผู้ใช้มีสิทธิ์ role นี้ไหม — admin ผ่านทุก role (0013) · หัวหน้าฝ่าย (<ฝ่าย>_lead) ผ่านสิทธิ์ของฝ่ายตัวเอง (0078) · ต้องตรงกับ hasRole() ใน web/lib/auth/roles.ts · ห้ามใช้แทน has_exact_role() ที่ใช้ระบุ "ฝ่าย" ของผู้ใช้';

-- ------------------------------------------------------------
-- (2) current_role_group — "ฝ่ายของผู้ใช้" ที่ใช้จับคู่ deviation_departments
--     เพิ่ม 4 lead ใหม่ให้ map ลงฝ่ายฐานของตัวเอง (แพทเทิร์นเดียวกับ qc_lead/production_lead ใน 0067)
--
--     🚨 ห้ามสลับลำดับของเดิม (คำเตือน 0072:11-14) — ถ้าเลื่อน manager ขึ้นก่อน
--        คน QC ที่มี role admin ด้วยจะกลายเป็น 'manager' แล้วส่งผลแก้ไขแทนแผนก QC ไม่ได้
--        ที่ทำในไฟล์นี้คือ "แทรกบรรทัด <ฝ่าย>_lead ไว้ติดกับ <ฝ่าย> เดิม" ซึ่งให้ผลลัพธ์เดิมทุกเคส
--        (ทั้งคู่คืนค่าฝ่ายเดียวกัน) ไม่มีของเก่าตัวไหนขยับลำดับ
--
--     ℹ️ ใช้ has_exact_role() — admin ไม่ผ่านอัตโนมัติ และการสืบทอด lead→base ในข้อ (1)
--        ไม่มีผลที่นี่ · ตั้งใจแล้ว: ฟังก์ชันนี้ตอบ "คนนี้อยู่ฝ่ายไหน" ไม่ใช่ "ทำอะไรได้บ้าง"
-- ------------------------------------------------------------
create or replace function public.current_role_group()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_profile_id() is null       then null
    when public.has_exact_role('qa_lead')          then 'qa'
    when public.has_exact_role('qa')               then 'qa'
    when public.has_exact_role('qc_lead')          then 'qc'
    when public.has_exact_role('qc')               then 'qc'
    when public.has_exact_role('production_lead')  then 'production'
    when public.has_exact_role('production')       then 'production'
    when public.has_exact_role('engineering_lead') then 'engineering'
    when public.has_exact_role('engineering')      then 'engineering'
    when public.has_exact_role('warehouse_lead')   then 'warehouse'
    when public.has_exact_role('warehouse')        then 'warehouse'
    when public.has_exact_role('planner_lead')     then 'planner'
    when public.has_exact_role('planner')          then 'planner'
    when public.has_exact_role('cost')             then 'cost'
    when public.has_exact_role('manager')          then 'manager'
    when public.has_exact_role('admin')            then 'manager'
    else 'other'
  end;
$$;

revoke execute on function public.current_role_group() from public;
revoke execute on function public.current_role_group() from anon;
grant  execute on function public.current_role_group() to authenticated;

comment on function public.current_role_group() is
  'ฝ่ายของผู้ใช้ที่ใช้จับคู่ deviation_departments — หัวหน้าฝ่าย map ลงฝ่ายฐานของตัวเอง (0078) · ต้องตรงกับ roleGroupOf() ใน web/lib/data/deviation-constants.ts เป๊ะ · ห้ามใช้แทน current_role_badge()';

-- ------------------------------------------------------------
-- (3) current_role_badge — ป้ายฝ่ายที่แสดงบนหมายเหตุ/ประวัติของ Incident Case
--     ต่างจาก (2) ตรงที่ ผู้บริหาร/admin มาก่อน (ทีมขอ — 0072:19-21)
--     เพิ่ม 4 lead ใหม่แบบเดียวกัน · ลำดับของเดิมไม่ขยับ
-- ------------------------------------------------------------
create or replace function public.current_role_badge()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_profile_id() is null       then null
    when public.has_exact_role('admin')            then 'manager'
    when public.has_exact_role('manager')          then 'manager'
    when public.has_exact_role('qa_lead')          then 'qa'
    when public.has_exact_role('qa')               then 'qa'
    when public.has_exact_role('qc_lead')          then 'qc'
    when public.has_exact_role('qc')               then 'qc'
    when public.has_exact_role('production_lead')  then 'production'
    when public.has_exact_role('production')       then 'production'
    when public.has_exact_role('engineering_lead') then 'engineering'
    when public.has_exact_role('engineering')      then 'engineering'
    when public.has_exact_role('warehouse_lead')   then 'warehouse'
    when public.has_exact_role('warehouse')        then 'warehouse'
    when public.has_exact_role('planner_lead')     then 'planner'
    when public.has_exact_role('planner')          then 'planner'
    when public.has_exact_role('cost')             then 'cost'
    else 'other'
  end;
$$;

revoke execute on function public.current_role_badge() from public;
revoke execute on function public.current_role_badge() from anon;
grant  execute on function public.current_role_badge() to authenticated;

comment on function public.current_role_badge() is
  'ป้ายฝ่ายที่โชว์บนหมายเหตุ Incident Case — นับ role สูงสุด (ผู้บริหาร/admin มาก่อน) · หัวหน้าฝ่าย map ลงฝ่ายฐานของตัวเอง (0078) · ห้ามใช้แทน current_role_group()';

-- ------------------------------------------------------------
-- ตรวจผลหลัง paste
-- ------------------------------------------------------------
-- select unnest(enum_range(null::app_role));   -- ต้องเห็น 15 ค่า
--
-- impersonate ผู้ใช้ที่ถือ production_lead ใน Supabase Studio แล้วรัน:
-- select public.has_role('production')      as ควรได้_true,
--        public.has_role('production_lead') as ควรได้_true,
--        public.has_role('qc')              as ควรได้_false,
--        public.current_role_group()        as ควรได้_production;
