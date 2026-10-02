-- ============================================================
-- PD Monitor — ข้อมูลตั้งต้นชุดใหม่สำหรับรอบทดสอบ (หลังล้างข้อมูลทั้งหมด)
--
-- ⚠️ ไม่ใช่ migration — paste ใน Supabase SQL Editor ครั้งเดียว "หลัง" ล้างข้อมูลเสร็จแล้ว
--    (ถ้ายังมีข้อมูลเดิมค้าง จะติด unique ของรหัส แล้วทั้งก้อนถูกยกเลิกเอง ไม่มีอะไรเสีย)
-- ใส่อะไรบ้าง:
--   · บริษัท 2 (UMEDA / POND — ฟอร์มปริ้นใบแจ้งผลิตผูกกับรหัส 2 ตัวนี้) · เลขงานเริ่ม 0001 ใหม่ทั้งคู่
--   · ลูกค้า 4 · สถานี 9 · เครื่องจักร 14 · ผลิตภัณฑ์ 5 พร้อมขั้นตอนการผลิต
--   · สถานะย่อย 51 รายการ (ชุดเดิมของทีม รวม "มีแผน" / "ไม่มีแผน" ที่ระบบใช้)
--   · ชื่อผลิตภัณฑ์/ลูกค้า/เลขทะเบียน ลงท้าย "(ทดสอบ)" หรือขึ้นต้น TEST — เป็นข้อมูลสมมติ ไม่ใช่ยาทะเบียนจริง
--   · เครื่องชั่ง 1 สอบเทียบใน 5 วัน (ทดสอบแจ้งเตือนวิศวกรรม) · ผสมแห้ง 2 สถานะซ่อมบำรุง (ไม่ขึ้นในฟอร์มบันทึก)
-- ============================================================

begin;

insert into public.companies (code, name, job_no_prefix, requires_note, year_start_seq, sort_order, is_active) values
  ('UMEDA', 'UMEDA CO., LTD.', '', false, 1, 10, true),
  ('POND', 'POND CHEMICAL COMPANY LIMITED', 'P', true, 1, 20, true);

insert into public.customers (name, is_active) values
  ('บริษัท เมดิฟาร์ม จำกัด (ทดสอบ)', true),
  ('โรงพยาบาลศิริเวช (ทดสอบ)', true),
  ('ร้านยาสุขภาพดี (ทดสอบ)', true),
  ('EXPORT – ASEAN (ทดสอบ)', true);

insert into public.stations (code, name, seq, is_active, is_packing) values
  ('ST-WEIGH', 'เตรียมวัตถุดิบ', 1, true, false),
  ('ST-WMIX', 'ผสมเปียก', 2, true, false),
  ('ST-DMIX', 'ผสมแห้ง', 3, true, false),
  ('ST-TAB', 'ตอกเม็ด', 4, true, false),
  ('ST-FILM', 'เคลือบฟิล์ม', 5, true, false),
  ('ST-CAP', 'เข้าแคปซูล', 6, true, false),
  ('ST-BAND', 'คาดแคปซูล', 7, true, false),
  ('ST-SORT', 'เลือกยา', 8, true, false),
  ('ST-PACK', 'บรรจุ', 9, true, true);

insert into public.machines (code, name, station_id, room, status, next_maintenance_date, next_calibration_date, is_active) values
  ('WEIGH-01', 'เครื่องชั่ง 1', (select id from public.stations where code = 'ST-WEIGH'), 'ห้องชั่ง 1', 'available'::machine_status, current_date + 90, current_date + 5, true),
  ('WEIGH-02', 'เครื่องชั่ง 2', (select id from public.stations where code = 'ST-WEIGH'), 'ห้องชั่ง 1', 'available'::machine_status, current_date + 90, current_date + 120, true),
  ('WMIX-01', 'เครื่องผสมเปียก 1', (select id from public.stations where code = 'ST-WMIX'), 'ห้องผสม 1', 'available'::machine_status, current_date + 60, current_date + 180, true),
  ('DMIX-01', 'เครื่องผสมแห้ง 1', (select id from public.stations where code = 'ST-DMIX'), 'ห้องผสม 2', 'available'::machine_status, current_date + 60, current_date + 180, true),
  ('DMIX-02', 'เครื่องผสมแห้ง 2', (select id from public.stations where code = 'ST-DMIX'), 'ห้องผสม 2', 'maintenance'::machine_status, current_date + 3, current_date + 180, true),
  ('TAB-01', 'เครื่องตอกเม็ด 1', (select id from public.stations where code = 'ST-TAB'), 'ห้องตอก 1', 'available'::machine_status, current_date + 45, current_date + 150, true),
  ('TAB-02', 'เครื่องตอกเม็ด 2', (select id from public.stations where code = 'ST-TAB'), 'ห้องตอก 2', 'available'::machine_status, current_date + 45, current_date + 150, true),
  ('FILM-01', 'เครื่องเคลือบฟิล์ม 1', (select id from public.stations where code = 'ST-FILM'), 'ห้องเคลือบ', 'available'::machine_status, current_date + 60, current_date + 200, true),
  ('CAP-01', 'เครื่องเข้าแคปซูล 1', (select id from public.stations where code = 'ST-CAP'), 'ห้องแคปซูล', 'available'::machine_status, current_date + 60, current_date + 200, true),
  ('CAP-02', 'เครื่องเข้าแคปซูล 2', (select id from public.stations where code = 'ST-CAP'), 'ห้องแคปซูล', 'available'::machine_status, current_date + 60, current_date + 200, true),
  ('BAND-01', 'เครื่องคาดแคปซูล 1', (select id from public.stations where code = 'ST-BAND'), 'ห้องแคปซูล', 'available'::machine_status, current_date + 90, current_date + 200, true),
  ('SORT-01', 'เครื่องเลือกยา + ตรวจโลหะ 1', (select id from public.stations where code = 'ST-SORT'), 'ห้องเลือกยา', 'available'::machine_status, current_date + 90, current_date + 30, true),
  ('PACK-01', 'เครื่องบรรจุแผง 1', (select id from public.stations where code = 'ST-PACK'), 'ห้องบรรจุ 1', 'available'::machine_status, current_date + 30, current_date + 200, true),
  ('PACK-02', 'เครื่องบรรจุขวด 1', (select id from public.stations where code = 'ST-PACK'), 'ห้องบรรจุ 2', 'available'::machine_status, current_date + 30, current_date + 200, true);

insert into public.products (code, name, dosage_form, unit, reg_no, appearance, is_active) values
  ('TEST-PARA500', 'PARACETAMOL 500 MG (ทดสอบ)', 'TAB', 'TAB', 'TEST 01/69', 'ยาเม็ดกลมแบน สีขาว มีขีดแบ่งครึ่งด้านเดียว', true),
  ('TEST-IBU400', 'IBUPROFEN 400 MG (ทดสอบ)', 'F/C', 'TAB', 'TEST 02/69', 'ยาเม็ดรี เคลือบฟิล์มสีชมพู', true),
  ('TEST-CET10', 'CETIRIZINE 10 MG (ทดสอบ)', 'F/C', 'TAB', 'TEST 03/69', 'ยาเม็ดกลมนูน เคลือบฟิล์มสีขาว', true),
  ('TEST-AMOX500', 'AMOXICILLIN 500 MG (ทดสอบ)', 'CAP', 'CAP', 'TEST 04/69', 'แคปซูลแข็ง หัวสีแดง ตัวสีเหลือง', true),
  ('TEST-VITC100', 'VITAMIN C 100 MG (ทดสอบ)', 'TAB', 'TAB', 'TEST 05/69', 'ยาเม็ดกลมแบน สีส้ม', true);

insert into public.product_routes (product_id, station_id, step_no) values
  ((select id from public.products where code = 'TEST-PARA500'), (select id from public.stations where code = 'ST-WEIGH'), 1),
  ((select id from public.products where code = 'TEST-PARA500'), (select id from public.stations where code = 'ST-WMIX'), 2),
  ((select id from public.products where code = 'TEST-PARA500'), (select id from public.stations where code = 'ST-TAB'), 3),
  ((select id from public.products where code = 'TEST-PARA500'), (select id from public.stations where code = 'ST-PACK'), 4),
  ((select id from public.products where code = 'TEST-IBU400'), (select id from public.stations where code = 'ST-WEIGH'), 1),
  ((select id from public.products where code = 'TEST-IBU400'), (select id from public.stations where code = 'ST-WMIX'), 2),
  ((select id from public.products where code = 'TEST-IBU400'), (select id from public.stations where code = 'ST-TAB'), 3),
  ((select id from public.products where code = 'TEST-IBU400'), (select id from public.stations where code = 'ST-FILM'), 4),
  ((select id from public.products where code = 'TEST-IBU400'), (select id from public.stations where code = 'ST-PACK'), 5),
  ((select id from public.products where code = 'TEST-CET10'), (select id from public.stations where code = 'ST-WEIGH'), 1),
  ((select id from public.products where code = 'TEST-CET10'), (select id from public.stations where code = 'ST-DMIX'), 2),
  ((select id from public.products where code = 'TEST-CET10'), (select id from public.stations where code = 'ST-TAB'), 3),
  ((select id from public.products where code = 'TEST-CET10'), (select id from public.stations where code = 'ST-FILM'), 4),
  ((select id from public.products where code = 'TEST-CET10'), (select id from public.stations where code = 'ST-SORT'), 5),
  ((select id from public.products where code = 'TEST-CET10'), (select id from public.stations where code = 'ST-PACK'), 6),
  ((select id from public.products where code = 'TEST-AMOX500'), (select id from public.stations where code = 'ST-WEIGH'), 1),
  ((select id from public.products where code = 'TEST-AMOX500'), (select id from public.stations where code = 'ST-DMIX'), 2),
  ((select id from public.products where code = 'TEST-AMOX500'), (select id from public.stations where code = 'ST-CAP'), 3),
  ((select id from public.products where code = 'TEST-AMOX500'), (select id from public.stations where code = 'ST-BAND'), 4),
  ((select id from public.products where code = 'TEST-AMOX500'), (select id from public.stations where code = 'ST-SORT'), 5),
  ((select id from public.products where code = 'TEST-AMOX500'), (select id from public.stations where code = 'ST-PACK'), 6),
  ((select id from public.products where code = 'TEST-VITC100'), (select id from public.stations where code = 'ST-WEIGH'), 1),
  ((select id from public.products where code = 'TEST-VITC100'), (select id from public.stations where code = 'ST-DMIX'), 2),
  ((select id from public.products where code = 'TEST-VITC100'), (select id from public.stations where code = 'ST-TAB'), 3),
  ((select id from public.products where code = 'TEST-VITC100'), (select id from public.stations where code = 'ST-PACK'), 4);

insert into public.job_sub_statuses (name, description, sort_order, requires_plan_month, is_system, is_active) values
  ('มีแผน', null, 10, true, true, true),
  ('ไม่มีแผน', null, 20, false, true, true),
  ('ชั่งวัตถุดิบรอผสม', null, 30, false, false, true),
  ('รอผสมเปียก', null, 40, false, false, true),
  ('อบ', null, 50, false, false, true),
  ('บด', null, 60, false, false, true),
  ('รอผสมแห้ง', null, 70, false, false, true),
  ('ผสมแห้ง', null, 80, false, false, true),
  ('อบผสม', null, 90, false, false, true),
  ('บดผสม', null, 100, false, false, true),
  ('รอตอกเม็ด', null, 110, false, false, true),
  ('ตอกเม็ด', null, 120, false, false, true),
  ('รอตอกสลัก', null, 130, false, false, true),
  ('ตอกสลัก', null, 140, false, false, true),
  ('รอบดสลัก', null, 150, false, false, true),
  ('บดสลัก', null, 160, false, false, true),
  ('รอบรรจุแคปซูล', null, 170, false, false, true),
  ('บรรจุแคปซูล+เลือกยา+ตรวจโลหะ', null, 180, false, false, true),
  ('รอคาดแคปซูล', null, 190, false, false, true),
  ('คาดแคปซูล', null, 200, false, false, true),
  ('รอพิมพ์อักษร', null, 210, false, false, true),
  ('พิมพ์อักษร', null, 220, false, false, true),
  ('รอเคลือบฟิล์ม / น้ำตาล', null, 230, false, false, true),
  ('เคลือบฟิล์ม / น้ำตาล', null, 240, false, false, true),
  ('รอเลือกยา+รอตรวจโลหะ', null, 250, false, false, true),
  ('รอเลือกยา+ตรวจโลหะ', null, 260, false, false, true),
  ('เลือกยา+ตรวจโลหะ', null, 270, false, false, true),
  ('เขย่ายา', null, 280, false, false, true),
  ('รอล้างขวด+รอบรรจุยา', null, 290, false, false, true),
  ('ล้างขวด+บรรจุยา', null, 300, false, false, true),
  ('รอเป่าหลอด+รอบรรจุยา', null, 310, false, false, true),
  ('เป่าหลอด+บรรจุยา', null, 320, false, false, true),
  ('รอตรวจความใส', null, 330, false, false, true),
  ('ตรวจความใส', null, 340, false, false, true),
  ('รอเบิกเคมี', null, 350, false, false, true),
  ('ส่งเบิกเคมี', null, 360, false, false, true),
  ('รอเตรียมเคมี', null, 370, false, false, true),
  ('เตรียมเคมี', null, 380, false, false, true),
  ('รอบรรจุฟอยล์/ขวด/ซอง', null, 390, false, false, true),
  ('บรรจุฟอยล์/ขวด/ซอง', null, 400, false, false, true),
  ('รอบรรจุหีบห่อ', null, 410, false, false, true),
  ('บรรจุหีบห่อ', null, 420, false, false, true),
  ('บรรจุกล่อง', null, 430, false, false, true),
  ('รอส่ง Checklist', null, 440, false, false, true),
  ('ส่ง Checklist', null, 450, false, false, true),
  ('เข้าคลัง', null, 460, false, false, true),
  ('ยาเข้าคลัง', null, 470, false, false, true),
  ('ยารอปลด', null, 480, false, false, true),
  ('ยาเข้าคลัง (ยาที่เข้าคลังไปแล้วโดย Check list พร้อม /เอกสารพร้อม รอ QC / QA พิจารณา)', null, 490, false, false, true),
  ('ยารอปลด (ยารอ QC / QA พิจารณาเพื่อปล่อยขาย)', null, 500, false, false, true),
  ('ยาปลดแล้ว (ยา QC / QA ปล่อยผ่านแล้ว)', null, 510, false, false, true);

-- ตรวจก่อน commit
select (select count(*) from public.companies)        as บริษัท,
       (select count(*) from public.customers)        as ลูกค้า,
       (select count(*) from public.stations)         as สถานี,
       (select count(*) from public.machines)         as เครื่องจักร,
       (select count(*) from public.products)         as ผลิตภัณฑ์,
       (select count(*) from public.product_routes)   as ขั้นตอน,
       (select count(*) from public.job_sub_statuses) as สถานะย่อย,
       (select count(*) from public.job_no_counters)  as ตัวนับเลขงาน;

commit;

-- ============================================================
-- ✅ ผลที่ต้องได้: บริษัท 2 · ลูกค้า 4 · สถานี 9 · เครื่องจักร 14 · ผลิตภัณฑ์ 5 ·
--    ขั้นตอน 25 · สถานะย่อย 51 · ตัวนับเลขงาน 0 (งานแรกของแต่ละบริษัทจะได้เลข 0001)
-- ❌ ขึ้น error "duplicate key" = ยังไม่ได้ล้างข้อมูลเดิม → ทั้งก้อนถูกยกเลิกแล้ว ไม่มีอะไรเปลี่ยน แจ้ง Claude
-- ❌ error อื่น → คัดลอกข้อความ error ส่งให้ Claude
-- ============================================================
