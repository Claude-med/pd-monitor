-- ============================================================
-- PD Monitor — D8 ส่วน 2 / tests/rls_impersonation_test.sql
-- เทส RLS ด้วย impersonation (recommendations.md B4)
--
-- ⚠️ ทำไมต้องเทสแบบนี้: RLS ที่ตั้งผิด "ไม่ throw error" — มันแค่คืนแถวว่าง (0 แถว) เงียบ ๆ
--    ดังนั้นต้องเทส "ที่ผลลัพธ์จริง" โดยสวมรอย (impersonate) เป็นผู้ใช้แต่ละ role
--    แล้วเช็กว่า อ่านเห็น/ไม่เห็น และ เขียนได้/ถูกปฏิเสธ ตรงตามที่ออกแบบไว้
--
-- ✅ ปลอดภัย 100%: ทั้งสคริปต์รันใน transaction เดียว แล้ว ROLLBACK ปลายทาง
--    → ไม่มีการแก้ข้อมูลจริงค้างไว้ · รันซ้ำได้ไม่จำกัด
--
-- 📋 วิธีใช้: paste ทั้งไฟล์ลง Supabase SQL Editor แล้วรัน → ดูตารางผลลัพธ์
--    แถวไหน result = ❌ คือ RLS ไม่เป็นไปตามที่ออกแบบ ต้องไปตรวจ policy
--
-- หมายเหตุสถาปัตยกรรม: แอปจริง "เขียน" ผ่าน RPC (security definer) / server action (service key)
--    → policy write_* บนตารางเป็นชั้นกันพลาด (defense-in-depth) ไม่ใช่ทางเขียนหลัก
--    สคริปต์นี้จึงเทส "ตรรกะของ policy" ผ่าน has_role() เป็นหลัก (แม่นยำ ไม่ขึ้นกับ grant)
--    + ลองเขียนตรงจริงเสริม (แยกแยะ "RLS บล็อก" ออกจาก "ไม่มี grant ตาราง")
--
-- ต้องรันหลังลง 0001–0009 + seed + สร้างบัญชี Auth ผูก profiles ครบแล้ว
-- ============================================================

begin;  -- << ทุกอย่างอยู่ในนี้ และจะถูก ROLLBACK ตอนจบ (ไม่แตะข้อมูลจริง)

-- ------------------------------------------------------------
-- 0) เตรียม: เก็บ auth uid + profile id ของแต่ละ role (จาก DB จริง ไม่ hardcode)
-- ------------------------------------------------------------
create temp table _tu (role text primary key, uid uuid, pid uuid) on commit drop;
insert into _tu(role, uid, pid)
select distinct on (ur.role) ur.role::text, p.auth_user_id, p.id
  from public.user_roles ur
  join public.profiles p on p.id = ur.profile_id
 where p.auth_user_id is not null
 order by ur.role, p.id;

create temp table _r (
  n serial, scenario text, expected text, actual text, pass boolean
) on commit drop;

-- helper (pure) ดึง uid/pid ของ role
create function pg_temp.uid(p_role text) returns uuid
  language sql stable as $$ select uid from _tu where role = p_role $$;
create function pg_temp.pid(p_role text) returns uuid
  language sql stable as $$ select pid from _tu where role = p_role $$;

-- สวมรอยเป็น role (ตั้ง JWT sub + สลับ SQL role = authenticated เพื่อให้ RLS มีผล)
create function pg_temp.login(p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.uid(p_role), 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- helper เทส "เขียน (insert)" — แยกแยะ RLS / ไม่มี grant / สำเร็จ
create function pg_temp.t_write(p_role text, p_scenario text, p_allow boolean, p_sql text)
returns void language plpgsql as $$
declare v_msg text; v_cat text; v_actual text; v_pass boolean;
begin
  perform pg_temp.login(p_role);
  begin
    execute p_sql; v_cat := 'OK';
  exception when others then
    v_msg := sqlerrm;
    v_cat := case
      when v_msg ilike '%row-level security%' then 'RLS'
      when v_msg ilike '%permission denied%'  then 'GRANT'
      else 'OTHER' end;
  end;
  execute 'reset role';
  v_actual := case v_cat
    when 'OK'    then 'เขียนได้'
    when 'RLS'   then 'ปฏิเสธโดย RLS'
    when 'GRANT' then 'ปฏิเสธ (ไม่มีสิทธิ์ตาราง — ปกติ: แอปเขียนผ่าน service key)'
    else 'ผิดพลาด: '||coalesce(v_msg,'') end;
  if p_allow then v_pass := v_cat in ('OK','GRANT');   -- ต้องไม่ถูก RLS บล็อก
  else            v_pass := v_cat <> 'OK';              -- ต้องเขียนไม่สำเร็จ
  end if;
  insert into _r(scenario, expected, actual, pass) values (
    p_scenario,
    case when p_allow then 'เขียนได้ (RLS ไม่บล็อก)' else 'ถูกปฏิเสธ' end,
    v_actual, v_pass
  );
end $$;

-- helper เทส "แก้ไข (update)" — deny แบบเงียบ = 0 แถว (ไม่ throw) → วัด row_count
create function pg_temp.t_update(p_role text, p_scenario text, p_allow boolean, p_sql text)
returns void language plpgsql as $$
declare v_rows int := 0; v_msg text; v_cat text; v_actual text; v_pass boolean;
begin
  perform pg_temp.login(p_role);
  begin
    execute p_sql; get diagnostics v_rows = row_count; v_cat := 'OK';
  exception when others then
    v_msg := sqlerrm;
    v_cat := case
      when v_msg ilike '%row-level security%' then 'RLS'
      when v_msg ilike '%permission denied%'  then 'GRANT'
      else 'OTHER' end;
  end;
  execute 'reset role';
  v_actual := case v_cat
    when 'OK'    then v_rows::text||' แถว'
    when 'RLS'   then 'ปฏิเสธโดย RLS'
    when 'GRANT' then 'ปฏิเสธ (ไม่มีสิทธิ์ตาราง)'
    else 'ผิดพลาด: '||coalesce(v_msg,'') end;
  if p_allow then v_pass := (v_cat = 'OK' and v_rows > 0) or v_cat = 'GRANT';
  else            v_pass := not (v_cat = 'OK' and v_rows > 0);   -- 0 แถว หรือ ถูกปฏิเสธ = ผ่าน
  end if;
  insert into _r(scenario, expected, actual, pass) values (
    p_scenario,
    case when p_allow then 'แก้ได้ (>0 แถว)' else 'ปฏิเสธ (0 แถว/เงียบ)' end,
    v_actual, v_pass
  );
end $$;

-- ------------------------------------------------------------
-- 1) ตั้งต้น: role ไหนผูกบัญชี auth แล้วบ้าง (เทสที่อิง has_role ต้องมี uid)
-- ------------------------------------------------------------
do $$
declare r text;
begin
  foreach r in array array['production','qc','qa','warehouse','manager'] loop
    insert into _r(scenario, expected, actual, pass) values (
      format('ตั้งต้น: role %s ผูกบัญชี auth?', r), 'ผูกแล้ว',
      case when pg_temp.uid(r) is null then 'ยังไม่ผูก ⚠️' else 'ผูกแล้ว' end,
      pg_temp.uid(r) is not null
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- 2) ตรรกะ write policy ผ่าน has_role() (แม่นยำ ไม่ขึ้นกับ grant)
--    write_jobs: production/qc/qa/manager · write_products|orders: manager เท่านั้น
--    write_batches|production_records: production/manager
-- ------------------------------------------------------------
do $$
declare v boolean;
begin
  -- production: เป็น production จริง, ไม่ใช่ manager
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.uid('production'), 'role','authenticated')::text, true);
  select public.has_role('production') into v;
  insert into _r(scenario,expected,actual,pass) values
    ('has_role: production คือ production', 'true', v::text, v = true);
  select public.has_role('manager') into v;
  insert into _r(scenario,expected,actual,pass) values
    ('has_role: production ไม่ใช่ manager (ห้ามแก้ products/orders)', 'false', v::text, v = false);

  -- warehouse: ไม่ใช่ production (ห้ามแก้ jobs/batches/records) และไม่ใช่ manager
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.uid('warehouse'), 'role','authenticated')::text, true);
  select public.has_role('production') into v;
  insert into _r(scenario,expected,actual,pass) values
    ('has_role: warehouse ไม่ใช่ production', 'false', v::text, v = false);
  select public.has_role('manager') into v;
  insert into _r(scenario,expected,actual,pass) values
    ('has_role: warehouse ไม่ใช่ manager', 'false', v::text, v = false);

  -- manager: เป็น manager
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.uid('manager'), 'role','authenticated')::text, true);
  select public.has_role('manager') into v;
  insert into _r(scenario,expected,actual,pass) values
    ('has_role: manager คือ manager', 'true', v::text, v = true);
end $$;

-- ------------------------------------------------------------
-- 3) อ่าน jobs — ทุก role ที่ login ควร "เห็น" · anon (ไม่ login) ควร "ไม่เห็น"
-- ------------------------------------------------------------
do $$
declare r text; v int;
begin
  foreach r in array array['production','qc','qa','warehouse','manager'] loop
    perform pg_temp.login(r);
    select count(*) into v from public.jobs;
    execute 'reset role';
    insert into _r(scenario, expected, actual, pass)
      values (format('อ่าน jobs เป็น %s', r), 'เห็น (>0)', v::text, v > 0);
  end loop;

  -- anon = ยังไม่ login (ไม่มี policy to anon → ต้องได้ 0 แถว)
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  select count(*) into v from public.jobs;
  execute 'reset role';
  insert into _r(scenario, expected, actual, pass)
    values ('อ่าน jobs เป็น anon (ยังไม่ login)', 'ไม่เห็น (0)', v::text, v = 0);

  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  select count(*) into v from public.products;
  execute 'reset role';
  insert into _r(scenario, expected, actual, pass)
    values ('อ่าน products เป็น anon', 'ไม่เห็น (0)', v::text, v = 0);
end $$;

-- ------------------------------------------------------------
-- 4) อ่าน audit_log — เห็นเฉพาะ manager/qa (อ่อนไหว) · ที่เหลือ "0 แถวเงียบ ๆ"
--    ← นี่คือเคส "RLS คืนค่าว่างเงียบ" ตัวอย่างคลาสสิกของ B4
-- ------------------------------------------------------------
do $$
declare r text; v int; should boolean;
begin
  foreach r in array array['production','qc','qa','warehouse','manager'] loop
    perform pg_temp.login(r);
    select count(*) into v from public.audit_log;
    execute 'reset role';
    should := r in ('manager','qa');
    insert into _r(scenario, expected, actual, pass) values (
      format('อ่าน audit_log เป็น %s', r),
      case when should then 'เห็น (>0)' else 'ไม่เห็น (0)' end,
      v::text, case when should then v > 0 else v = 0 end
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- 5) เขียนตรง (insert) เสริม — เทียบกับ policy write_*
-- ------------------------------------------------------------
select pg_temp.t_write('manager', 'manager เพิ่ม products', true,
  $$insert into public.products(code,name,dosage_form,standard_time_hours)
    values ('TEST-RLS-PM','ทดสอบ RLS','เม็ด',1)$$);
select pg_temp.t_write('qc', 'qc เพิ่ม products (ห้าม)', false,
  $$insert into public.products(code,name,dosage_form,standard_time_hours)
    values ('TEST-RLS-PQ','ทดสอบ RLS','เม็ด',1)$$);
select pg_temp.t_write('production', 'production เพิ่ม batches', true,
  $$insert into public.batches(lot_no) values ('TEST-RLS-BP')$$);
select pg_temp.t_write('warehouse', 'warehouse เพิ่ม batches (ห้าม)', false,
  $$insert into public.batches(lot_no) values ('TEST-RLS-BW')$$);

-- ------------------------------------------------------------
-- 6) แก้ไข (update) — วัด row_count (deny = 0 แถวเงียบ ๆ)
-- ------------------------------------------------------------
select pg_temp.t_update('production', 'production แก้ jobs', true,
  $$update public.jobs set problem_note='rls-test' where job_no='JOB-003'$$);
select pg_temp.t_update('warehouse', 'warehouse แก้ jobs (ห้าม → เงียบ)', false,
  $$update public.jobs set problem_note='rls-test' where job_no='JOB-003'$$);
select pg_temp.t_update('production', 'production แก้ profile ตัวเอง', true,
  format($$update public.profiles set department='rls-self' where auth_user_id=%L$$, pg_temp.uid('production')));
select pg_temp.t_update('production', 'production แก้ profile คนอื่น (ห้าม → เงียบ)', false,
  format($$update public.profiles set department='rls-other' where id=%L$$, pg_temp.pid('manager')));

-- ------------------------------------------------------------
-- 7) audit_log = append-only — ห้าม UPDATE แม้แต่ manager (revoke + trigger)
-- ------------------------------------------------------------
select pg_temp.t_update('manager', 'manager แก้ audit_log (ห้ามทุกกรณี)', false,
  $$update public.audit_log set reason='hack' where id = (select min(id) from public.audit_log)$$);

-- ============================================================
-- สรุปผล
-- ============================================================
do $$
declare v_total int; v_pass int;
begin
  select count(*), count(*) filter (where pass) into v_total, v_pass from _r;
  raise notice '======== สรุปเทส RLS: ผ่าน %/% ========', v_pass, v_total;
  if v_pass < v_total then
    raise notice '⚠️ มีเคสไม่ผ่าน — ดูแถว result = ❌ ในตารางผลลัพธ์';
  else
    raise notice '✅ RLS เป็นไปตามที่ออกแบบทุกเคส';
  end if;
end $$;

select n,
       scenario as "สถานการณ์",
       expected as "คาดหวัง",
       actual   as "ผลจริง",
       case when pass then '✅' else '❌ ตรวจ' end as "result"
  from _r
 order by n;

rollback;  -- << คืนสภาพทุกอย่าง ไม่มีข้อมูลทดสอบค้างใน DB
