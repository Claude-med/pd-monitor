-- ============================================================
-- PD Monitor — D8 ส่วน 2 / tests/rls_impersonation_test.sql
-- เทส RLS ด้วย impersonation (recommendations.md B4)
--
-- ⚠️ ทำไมต้องเทสแบบนี้: RLS ที่ตั้งผิด "ไม่ขึ้น error" — มันแค่คืน "0 แถวเงียบ ๆ"
--    → ต้องเทส "ที่ผลลัพธ์จริง" โดยสวมรอย (impersonate) เป็นผู้ใช้แต่ละ role
--
-- ✅ ปลอดภัย: ทุก insert/update ทดสอบจะถูก "ย้อนกลับ" (raise undo ในบล็อกย่อย)
--    → ไม่มีข้อมูลทดสอบค้างใน DB · ไม่ใช้ temp table · รันซ้ำได้
--    (ออกแบบให้ทนกับ Supabase SQL Editor ที่ commit ทีละ statement)
--
-- 📋 วิธีใช้: paste ทั้งไฟล์แล้วกด Run → ดูตารางผลลัพธ์ (คอลัมน์ result)
--    ทุกแถวควรเป็น ✅ · ถ้าเจอ ❌ = RLS ไม่ตรงดีไซน์ → ไปตรวจ policy ตารางนั้น
--
-- ต้องรันหลังลง 0001–0009 + seed + ผูกบัญชี Auth กับ profiles ครบแล้ว (อิง uid จริง)
--
-- หมายเหตุสถาปัตยกรรม: แอปจริง "เขียน" ผ่าน RPC (security definer) / server action (service key)
--   → policy write_* เป็นชั้นกันพลาด (defense-in-depth) สคริปต์จึงแยกแยะ
--     "ถูก RLS บล็อก" ออกจาก "ไม่มีสิทธิ์ตาราง (grant)" เพื่อไม่ให้ผลหลอกตา
-- ============================================================

create or replace function pg_temp.rls_test()
returns table(n int, scenario text, expected text, actual text, result text)
language plpgsql
as $fn$
declare
  v_uid_prod uuid; v_uid_qc uuid; v_uid_qa uuid; v_uid_wh uuid; v_uid_mgr uuid;
  v_pid_mgr  uuid;
  a_scn  text[]    := '{}';
  a_exp  text[]    := '{}';
  a_act  text[]    := '{}';
  a_pass boolean[] := '{}';
  v_roles text[] := array['production','qc','qa','warehouse','manager'];
  r text; v_uid uuid; v_cnt int; v_should boolean; v_b boolean;
  -- write/update specs
  w_role  text[]; w_scn text[]; w_sql text[]; w_allow boolean[];
  i int; v_rows int; v_cat text; v_msg text; v_actual text; v_exp text; v_pass boolean;
begin
  -- ---------- โหลด uid/pid (ทำในฐานะ owner ก่อนสวมรอย) ----------
  select p.auth_user_id into v_uid_prod from public.profiles p join public.user_roles ur on ur.profile_id=p.id where ur.role='production' and p.auth_user_id is not null limit 1;
  select p.auth_user_id into v_uid_qc   from public.profiles p join public.user_roles ur on ur.profile_id=p.id where ur.role='qc'         and p.auth_user_id is not null limit 1;
  select p.auth_user_id into v_uid_qa   from public.profiles p join public.user_roles ur on ur.profile_id=p.id where ur.role='qa'         and p.auth_user_id is not null limit 1;
  select p.auth_user_id into v_uid_wh   from public.profiles p join public.user_roles ur on ur.profile_id=p.id where ur.role='warehouse'  and p.auth_user_id is not null limit 1;
  select p.auth_user_id into v_uid_mgr  from public.profiles p join public.user_roles ur on ur.profile_id=p.id where ur.role='manager'    and p.auth_user_id is not null limit 1;
  select p.id           into v_pid_mgr  from public.profiles p join public.user_roles ur on ur.profile_id=p.id where ur.role='manager' limit 1;

  -- ========== 1) role ไหนผูกบัญชี auth แล้วบ้าง ==========
  foreach r in array v_roles loop
    v_uid := case r when 'production' then v_uid_prod when 'qc' then v_uid_qc when 'qa' then v_uid_qa when 'warehouse' then v_uid_wh else v_uid_mgr end;
    a_scn := a_scn || format('ตั้งต้น: role %s ผูกบัญชี auth?', r);
    a_exp := a_exp || 'ผูกแล้ว';
    a_act := a_act || case when v_uid is null then 'ยังไม่ผูก ⚠️' else 'ผูกแล้ว' end;
    a_pass := a_pass || (v_uid is not null);
  end loop;

  -- ========== 2) ตรรกะ write policy ผ่าน has_role() (แม่น ไม่ขึ้นกับ grant) ==========
  -- production = production จริง, ไม่ใช่ manager
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_prod, 'role','authenticated')::text, false);
  select public.has_role('production') into v_b;
  a_scn := a_scn || 'has_role: production คือ production'; a_exp := a_exp || 'true';  a_act := a_act || v_b::text; a_pass := a_pass || (v_b = true);
  select public.has_role('manager') into v_b;
  a_scn := a_scn || 'has_role: production ไม่ใช่ manager (ห้ามแก้ products/orders)'; a_exp := a_exp || 'false'; a_act := a_act || v_b::text; a_pass := a_pass || (v_b = false);
  -- warehouse ไม่ใช่ production และไม่ใช่ manager
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_wh, 'role','authenticated')::text, false);
  select public.has_role('production') into v_b;
  a_scn := a_scn || 'has_role: warehouse ไม่ใช่ production (ห้ามแก้ jobs/batches)'; a_exp := a_exp || 'false'; a_act := a_act || v_b::text; a_pass := a_pass || (v_b = false);
  select public.has_role('manager') into v_b;
  a_scn := a_scn || 'has_role: warehouse ไม่ใช่ manager'; a_exp := a_exp || 'false'; a_act := a_act || v_b::text; a_pass := a_pass || (v_b = false);
  -- manager = manager
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_mgr, 'role','authenticated')::text, false);
  select public.has_role('manager') into v_b;
  a_scn := a_scn || 'has_role: manager คือ manager'; a_exp := a_exp || 'true'; a_act := a_act || v_b::text; a_pass := a_pass || (v_b = true);

  -- ========== 3) อ่าน jobs — ทุก role เห็น · anon ไม่เห็น ==========
  foreach r in array v_roles loop
    v_uid := case r when 'production' then v_uid_prod when 'qc' then v_uid_qc when 'qa' then v_uid_qa when 'warehouse' then v_uid_wh else v_uid_mgr end;
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, false);
    execute 'set role authenticated';
    select count(*) into v_cnt from public.jobs;
    execute 'reset role';
    a_scn := a_scn || format('อ่าน jobs เป็น %s', r); a_exp := a_exp || 'เห็น (>0)'; a_act := a_act || v_cnt::text; a_pass := a_pass || (v_cnt > 0);
  end loop;
  -- anon (ยังไม่ login)
  perform set_config('request.jwt.claims', '', false);
  execute 'set role anon';
  select count(*) into v_cnt from public.jobs;
  execute 'reset role';
  a_scn := a_scn || 'อ่าน jobs เป็น anon (ยังไม่ login)'; a_exp := a_exp || 'ไม่เห็น (0)'; a_act := a_act || v_cnt::text; a_pass := a_pass || (v_cnt = 0);
  perform set_config('request.jwt.claims', '', false);
  execute 'set role anon';
  select count(*) into v_cnt from public.products;
  execute 'reset role';
  a_scn := a_scn || 'อ่าน products เป็น anon'; a_exp := a_exp || 'ไม่เห็น (0)'; a_act := a_act || v_cnt::text; a_pass := a_pass || (v_cnt = 0);

  -- ========== 4) อ่าน audit_log — เห็นเฉพาะ manager/qa (เคส "ว่างเงียบ" คลาสสิก) ==========
  foreach r in array v_roles loop
    v_uid := case r when 'production' then v_uid_prod when 'qc' then v_uid_qc when 'qa' then v_uid_qa when 'warehouse' then v_uid_wh else v_uid_mgr end;
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, false);
    execute 'set role authenticated';
    select count(*) into v_cnt from public.audit_log;
    execute 'reset role';
    v_should := r in ('manager','qa');
    a_scn := a_scn || format('อ่าน audit_log เป็น %s', r);
    a_exp := a_exp || case when v_should then 'เห็น (>0)' else 'ไม่เห็น (0)' end;
    a_act := a_act || v_cnt::text;
    a_pass := a_pass || case when v_should then v_cnt > 0 else v_cnt = 0 end;
  end loop;

  -- ========== 5–7) เขียน/แก้ตาม write_* + audit append-only ==========
  -- (ทุกการเขียนที่สำเร็จจะถูก raise '__UNDO__' เพื่อย้อนกลับ ไม่ค้างใน DB)
  w_role  := array['manager','qc','production','warehouse','production','qc','production','warehouse','production','production','manager'];
  w_allow := array[ true,    false, true,        false,      true,        false, true,        false,      true,        false,       false ]::boolean[];
  w_scn   := array[
    'manager เพิ่ม products',
    'qc เพิ่ม products (ห้าม)',
    'production เพิ่ม batches',
    'warehouse เพิ่ม batches (ห้าม)',
    'production เพิ่ม production_records',
    'qc เพิ่ม production_records (ห้าม)',
    'production แก้ jobs',
    'warehouse แก้ jobs (ห้าม → เงียบ)',
    'production แก้ profile ตัวเอง',
    'production แก้ profile คนอื่น (ห้าม → เงียบ)',
    'manager แก้ audit_log (ห้ามทุกกรณี)'
  ];
  w_sql := array[
    $q$insert into public.products(code,name,dosage_form,standard_time_hours) values ('TEST-RLS-PM','ทดสอบ','เม็ด',1)$q$,
    $q$insert into public.products(code,name,dosage_form,standard_time_hours) values ('TEST-RLS-PQ','ทดสอบ','เม็ด',1)$q$,
    $q$insert into public.batches(lot_no) values ('TEST-RLS-BP')$q$,
    $q$insert into public.batches(lot_no) values ('TEST-RLS-BW')$q$,
    $q$insert into public.production_records(job_id,station,input_qty,output_qty) values ('d0000001-0000-0000-0000-000000000001','prep',10,10)$q$,
    $q$insert into public.production_records(job_id,station,input_qty,output_qty) values ('d0000001-0000-0000-0000-000000000001','prep',10,10)$q$,
    $q$update public.jobs set problem_note='rls-test' where job_no='JOB-003'$q$,
    $q$update public.jobs set problem_note='rls-test' where job_no='JOB-003'$q$,
    format($q$update public.profiles set department='rls-self' where auth_user_id=%L$q$, v_uid_prod),
    format($q$update public.profiles set department='rls-other' where id=%L$q$, v_pid_mgr),
    $q$update public.audit_log set reason='hack' where id=(select min(id) from public.audit_log)$q$
  ];

  for i in 1..array_length(w_sql,1) loop
    r := w_role[i];
    v_uid := case r when 'production' then v_uid_prod when 'qc' then v_uid_qc when 'qa' then v_uid_qa when 'warehouse' then v_uid_wh else v_uid_mgr end;
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, false);
    execute 'set role authenticated';
    v_rows := 0; v_cat := 'OK'; v_msg := null;
    begin
      execute w_sql[i];
      get diagnostics v_rows = row_count;
      raise exception '__UNDO__';        -- บังคับย้อนกลับการเขียนที่สำเร็จ
    exception when others then
      if sqlerrm = '__UNDO__' then
        v_cat := 'OK';
      elsif sqlerrm ilike '%row-level security%' then
        v_cat := 'RLS';
      elsif sqlerrm ilike '%permission denied%' then
        v_cat := 'GRANT';
      else
        v_cat := 'OTHER'; v_msg := sqlerrm;
      end if;
    end;
    execute 'reset role';

    v_actual := case v_cat
      when 'OK'    then v_rows::text || ' แถว (เขียนได้)'
      when 'RLS'   then 'ปฏิเสธโดย RLS'
      when 'GRANT' then 'ปฏิเสธ (ไม่มีสิทธิ์ตาราง — แอปเขียนผ่าน service key)'
      else 'ผิดพลาด: ' || coalesce(v_msg,'') end;

    if w_allow[i] then
      v_exp  := 'เขียน/แก้ได้';
      v_pass := (v_cat = 'OK' and v_rows > 0) or v_cat = 'GRANT';
    else
      v_exp  := 'ถูกปฏิเสธ';
      v_pass := not (v_cat = 'OK' and v_rows > 0);
    end if;

    a_scn := a_scn || w_scn[i]; a_exp := a_exp || v_exp; a_act := a_act || v_actual; a_pass := a_pass || v_pass;
  end loop;

  -- เผื่อหลุด: คืน role + claims ให้ปกติ
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);

  -- สรุปผ่าน NOTICE
  raise notice '======== สรุปเทส RLS: ผ่าน %/% ========',
    (select count(*) from unnest(a_pass) x where x), array_length(a_pass,1);

  -- ส่งออกเป็นตาราง
  return query
    select (row_number() over ())::int, s, e, ac,
           case when p then '✅' else '❌ ตรวจ' end
      from unnest(a_scn, a_exp, a_act, a_pass) as t(s, e, ac, p);

exception when others then
  -- กันค้าง: ถ้ามี error ไม่คาดคิด คืน role ก่อนโยนต่อ
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
  raise;
end $fn$;

-- รันเทส
select n as "ลำดับ",
       scenario as "สถานการณ์",
       expected as "คาดหวัง",
       actual   as "ผลจริง",
       result   as "result"
  from pg_temp.rls_test()
 order by n;
