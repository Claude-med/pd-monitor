# รีวิวโค้ด PD Monitor ก่อนส่งทดสอบรอบ 2 + แผนแก้ข้อร้ายแรง

## Context
ผู้ใช้จะส่งแอปให้ทีม (~30 คน) ทดสอบรอบ 2 (ข้อมูลยังเป็นข้อมูลสมมติ) และขอให้รีวิวรอบด้าน ได้แก่
บั๊กกับกรณีขอบ, logic/flow, จุดที่ควรปรับให้ใช้ง่ายขึ้น และความเสี่ยงระยะยาว
ตอนนี้ `tsc --noEmit` กับ `eslint` **ผ่านสะอาด 0 error** · migration ล่าสุดคือ `0104`

**ผู้ใช้ตัดสินใจแล้ว (1 ต.ค. 69)**
1. ปล่อยผ่าน FG ได้ **เฉพาะหัวหน้า QA** (พนักงาน QA ยังตีกลับได้)
2. ลบงาน: **ก่อนเริ่มผลิต** หัวหน้าทุกแผนกลบได้เหมือนเดิม · **ตั้งแต่เริ่มผลิตไปแล้ว** ลบได้เฉพาะผู้บริหาร/admin
3. ขอบเขตรอบนี้ = **ส่งรายงาน + แก้ข้อร้ายแรงก่อนส่งทดสอบ** ส่วนที่เหลือเก็บเป็นงานแยกไว้ทำทีละก้อน

---

## ส่วนที่ 1 — รายงานผลรีวิว (สรุปส่งผู้ใช้)

### 🔴 ร้ายแรง (แก้รอบนี้)
| # | เรื่อง | หลักฐาน | ผลกระทบ |
|---|---|---|---|
| C1 | **หัวหน้าแผนกยึดบัญชีผู้บริหารได้** — `resetPassword` / `setActive` / `deleteUser` รับ `authUserId` มาจากหน้าจอ แล้วตรวจขอบเขตจาก `profileId` เท่านั้น | `app/(app)/admin/users/actions.ts:236-312` | หัวหน้าแผนกส่ง profileId ของลูกน้อง แต่ส่ง authUserId ของ CEO มาด้วย จะรีเซ็ตรหัส แบน หรือลบบัญชีล็อกอินของ CEO ได้ (ทุกคนอ่าน `profiles.auth_user_id` ได้ผ่าน RLS) |
| C2 | **ข้ามลายเซ็นอิเล็กทรอนิกส์ QC/QA ได้** — `changeStatus` เรียก `advance_job_status` ได้ทุกปลายทาง | `board/actions.ts:21` · `0099:advance_job_status` | หัวหน้า QC/QA ยิง action นี้ตรง ๆ จะเปลี่ยน qc→qa หรือ qa→FG ได้**โดยไม่กรอกรหัสผ่าน และไม่มีแถวในตาราง `approvals`** = ผิดหลัก e-signature ของ GMP |
| C3 | **บัญชีที่ถูกระงับยังเรียกฐานข้อมูลได้** — `current_profile_id()` / `has_role()` ไม่เช็ก `is_active` | `0005:81` · `0078` | ด่านระงับมีแค่ที่ layout · token ที่ยังไม่หมดอายุ (~1 ชม.) หรือโปรไฟล์ที่ไม่มี auth ยังยิง RPC ได้ครบ |
| C4 | **บันทึกกะดึกไม่ได้ช่วง 00:00–07:00** — ใช้ `toISOString().slice(0,10)` (เวลา UTC) และ `current_date` ของ DB (UTC) | `production-constants.ts:141` · `record-form.tsx:28` · `0092`/`0100` | หลังเที่ยงคืน ถ้าเลือกวันที่ของวันนี้ จะขึ้น error "วันในอนาคต" · ค่าวันที่เริ่มต้นกลายเป็นเมื่อวาน · "วันนี้" ในหน้า daily, แดชบอร์ด, เครื่องจักร และแจ้งเตือนเกินกำหนดเพี้ยนไป 1 วันเป็นเวลา 7 ชั่วโมง |
| C5 | **คิวบันทึกออฟไลน์ไม่แยกคน** — `localStorage` key เดียวทั้งเครื่อง | `lib/offline-queue.ts:37` | แท็บเล็ตที่ใช้ร่วมกัน: A บันทึกค้างแล้วออกจากระบบ · B ล็อกอินแล้วเปิดงานเดียวกัน → ระบบส่งบันทึกของ A **ในนามของ B** (ผู้บันทึกผิดคน = ผิด ALCOA) |
| C6 | **พนักงาน QA ทุกคนปล่อยผ่าน FG ได้** (ผู้ใช้เลือกให้เหลือเฉพาะหัวหน้า QA) | `0099` · `0095:sign_job_decision` · `job-constants.ts:61` | ไม่สอดคล้องกับฝั่ง QC ที่ต้องเป็นหัวหน้า |
| C7 | **หัวหน้าทุกแผนกลบงานได้ทุกสถานะ** รวมงานที่ปล่อยผ่านแล้ว · ลบแบบ cascade พาบันทึกผลผลิต ผลตรวจ และลายเซ็นหายไปด้วย | `0095:delete_job` · `roles.ts:38` | ผู้ใช้เลือกจำกัดหลังเริ่มผลิต |

### 🟠 บั๊ก/กรณีขอบอื่น (ยังไม่แก้รอบนี้ — เก็บเป็นงานถัดไป)
- **เพดาน 1,000 แถวของ Supabase** — มีหลาย query ที่ไม่ใส่ limit ข้อมูลจะหายเงียบ ๆ เมื่อเกิน 1,000 แถว:
  `getJobs()` (`jobs.ts:71` เรียงจากเก่า → **งานใหม่ล่าสุดหายจากบอร์ด**) · `fg_inventory` (`jobs.ts:73` → งานที่รับเข้าคลังแล้วโผล่กลับมาบนบอร์ด) ·
  `listFgJobs` (`fg.ts:48` → สต็อก FG เก่าหายจากหน้าคลัง) · `listCustomers` และ `listJobSubStatuses` (ใช้นับจำนวนครั้งที่ใช้)
  → ทดสอบรอบ 2 ยังไม่เจอ แต่ใช้จริงไม่กี่เดือนก็ถึงเพดาน
- **e-signature ตรวจรหัสผ่านแค่ใน Server Action** — ถ้ายิง RPC `sign_job_decision` / `delete_job` ตรงจาก devtools จะไม่ต้องใช้รหัสผ่าน (C2 ปิดเส้นทาง changeStatus แล้ว แต่ RPC ยังเหลือช่องนี้) · ระยะยาวควรใช้ reauthentication nonce
- **`must_change_password` บังคับแค่ที่ layout** — ยิง RPC ตรงยังได้ (ความเสี่ยงต่ำ)
- รหัสผ่านที่ admin ตั้งให้ขั้นต่ำ 6 ตัว แต่ที่ผู้ใช้ตั้งเองขั้นต่ำ 8 ตัว (`admin/users/actions.ts:118` เทียบกับ `change-password/actions.ts:34`) — ไม่สม่ำเสมอ
- รับเข้าคลัง FG ด้วยจำนวน **0** ได้ (`receive_fg` เช็กแค่ `< 0`) → งานหายจากบอร์ดทั้งที่ยังไม่มีของ
- แก้ผลตรวจ in-process ที่ยังไม่อนุมัติจาก "ผ่าน" เป็น "ไม่ผ่าน" ผ่าน `edit_draft` **ไม่เปิด Incident อัตโนมัติ** ต่างจากตอนบันทึกใหม่
- คิวออฟไลน์: ถ้า session หมดอายุ action จะตอบ "ไม่มีสิทธิ์" แล้วถูกมองเป็น error ถาวร → **รายการถูกทิ้งจากคิว** · คิวจะลองส่งใหม่เฉพาะตอนเปิดหน้างานนั้น
- `EMPTY.record_date` คำนวณครั้งเดียวตอนโหลดโมดูล ถ้าเปิดแท็บค้างข้ามวัน วันที่เริ่มต้นจะค้างเป็นวันเก่า (แก้ไปพร้อม C4)
- `.gitignore` มี `.env*` แต่ `.env.example` ถูก commit ไปก่อนแล้ว — ไม่มีปัญหาตอนนี้ แต่ถ้าสร้างไฟล์ example ใหม่จะไม่ถูก track

### 🟡 Logic/Flow ที่ควรให้ทีมยืนยันระหว่างทดสอบ
- งานที่ถูกตีกลับจาก QC/QA กลับไป `in_production` โดยบันทึกเดิมไม่ถูก reset → ตรวจว่าด่าน QC gate ประเมินใหม่ถูกต้อง
- `/trace` ไม่มีด่านตรวจ role ในหน้า (เมนูซ่อนไว้แต่เข้าลิงก์ตรงได้) — ข้อมูลอ่านได้ทุกคนอยู่แล้วตาม RLS ไม่ถือเป็นช่องโหว่ แต่ไม่สม่ำเสมอกับหน้าอื่น
- RLS เปิดให้ทุก role **อ่านได้ทุกตาราง** (รวมต้นทุนค่าแรงและ audit บางส่วน) — ยืนยันว่ารับได้สำหรับโรงงาน

### 🟢 ปรับนิดหน่อยให้ใช้ง่ายขึ้น
- **ตัวกรองบนบอร์ด (ค้นหา/สถานะ/บริษัท) ไม่อยู่ใน URL** → เข้าหน้างานแล้วกดกลับ ตัวกรองหายทุกครั้ง (`board-view.tsx:102`)
- **หน้ารายละเอียดงานโหลดช้า** — ยิง query ต่อกันทีละตัว ~15 ครั้ง (`board/[jobNo]/page.tsx:129-288`) → รวมเป็น `Promise.all`
- **layout โหลด 4–6 query ทุกครั้งที่เปลี่ยนหน้า** (`getMyApprovals` นับแค่จำนวน) → ทำ RPC นับแบบเบา ๆ
- **ตรวจ region ของ Vercel Functions** — ถ้ายังเป็นค่า default (US East) แต่ Supabase อยู่สิงคโปร์ ทุก query จะช้าขึ้น ~200ms → ตั้งเป็น `sin1`
- `RealtimeRefresh` สั่ง `router.refresh()` ทั้งหน้าทุกครั้งที่ตารางเปลี่ยน → ช่วงที่ทั้งโรงงานบันทึกพร้อมกัน server จะโดน refresh ถี่ (ถือว่ารับได้ที่ 30 คน)
- ข้อความรหัสผ่านผิดเวลาโดน rate limit ของ Supabase ยังขึ้นว่า "รหัสผ่านไม่ถูกต้อง" → ควรแยกข้อความ "ลองใหม่ภายหลัง"

### 🔵 ระวังเมื่อใช้งานจริง/ระยะยาว
1. **การลง migration ด้วยการ paste มือ** (104 ไฟล์) — เสี่ยงที่ DB จริงไม่ตรงกับ repo ควรมีสคริปต์ตรวจ "migration ล่าสุดที่ลงแล้ว" หรือย้ายไปใช้ Supabase CLI
2. **ไม่มี automated test** นอกจาก `rls_impersonation_test.sql` — ด่าน GMP (สองลายเซ็น, QC gate, ปล่อย FG) ควรมี SQL test ที่รันซ้ำได้
3. **Backup / PITR** — ตรวจแพ็กเกจ Supabase ว่ามี Point-in-Time Recovery ไหม (ข้อมูล batch record เป็นเอกสาร GMP)
4. **ล้างข้อมูลสมมติก่อนเปิดใช้จริง** — มี `supabase/scripts/cleanup_test_jobs_*.sql` อยู่แล้ว · ต้องรีเซ็ต counter เลขงาน และลบบัญชีทดสอบด้วย
5. **Audit log โตไม่มีที่สิ้นสุด** (append-only) — วางแผน index และการ archive ข้อมูลรายปี
6. **ลบงานแบบ hard delete** — ระยะยาวควรเปลี่ยนเป็นสถานะ "ยกเลิก" (soft delete) ตามหลัก ALCOA
7. **ความปลอดภัย**: เปิด leaked-password protection และ MFA สำหรับ manager/admin ใน Supabase Auth · ใส่ security headers ใน `next.config.ts`
8. **ฟังก์ชันที่ตั้ง `set timezone`** (จาก C4) — migration ในอนาคตที่ `create or replace` ฟังก์ชันพวกนี้ต้องใส่ `set timezone = 'Asia/Bangkok'` ซ้ำด้วย ไม่งั้นค่าจะหาย

---

## ส่วนที่ 2 — แผนแก้รอบนี้ (C1–C7)

### Migration ใหม่ `web/supabase/migrations/0105_review_hardening.sql` (ไฟล์เดียว รันซ้ำได้)
1. **C3 — ระงับบัญชีมีผลที่ DB**: `create or replace` ทั้ง 5 ฟังก์ชัน `current_profile_id` · `has_role` · `has_exact_role` · `is_any_lead` · `current_head_depts`
   โดยเพิ่มเงื่อนไข `p.is_active and p.deleted_at is null` (ยกตัวฟังก์ชันจาก 0005/0078/0067/0095/0079 มา **แก้แค่ WHERE**)
2. **C2 + C6 — e-signature บังคับที่ DB**: ยกตัว `advance_job_status` จาก 0099 มาแก้ 2 จุด
   - สาขา `qc→qa` · `qc→in_production` · `qa→finished_goods` · `qa→in_production` เพิ่มเงื่อนไข
     `current_setting('app.esign', true) = 'on'` ถ้าไม่ตรงให้ `raise 'ขั้นนี้ต้องลงนามด้วยรหัสผ่าน'`
   - `qa→finished_goods` เปลี่ยนเป็น `has_role('qa_lead')`

   แล้วยกตัว `sign_job_decision` จาก 0095 มา: `set_config('app.esign','on',true)` ก่อนเรียก advance ·
   ขั้น qa + approve ต้องเป็น `has_role('qa_lead')` (reject ยังใช้ `has_role('qa')`)
3. **C7 — จำกัดการลบงาน**: ยกตัว `delete_job` จาก 0095 · หลังอ่านสถานะ ถ้าสถานะ**ไม่ใช่** `pending_announce`/`planned`
   และผู้ใช้ไม่ใช่ manager/admin ให้ `raise 'งานที่เริ่มผลิตแล้ว ลบได้เฉพาะผู้บริหาร'`
4. **C4 — วันที่ใน DB เป็นเวลาไทย**: ใช้บล็อก `do $$` วนตาม `pg_proc` แล้วสั่ง `alter function <sig> set timezone = 'Asia/Bangkok'`
   กับ `add_production_record` · `edit_draft` · `add_fg_dispatch` · `notify_machine_due` (ไม่ต้องคัดลอกตัวฟังก์ชัน)
5. ท้ายไฟล์ใส่ **คำสั่งตรวจหลัง paste** ตามรูปแบบ memory (ตรวจอะไร · คำสั่ง · ✅ ผลที่ต้องได้ · ❌ ถ้าไม่ตรง)
   ⚠️ ตัวฟังก์ชันที่ยกมาต้องคัดจากไฟล์ล่าสุดของแต่ละตัวเท่านั้น (ตรวจด้วย `grep -l "function public.<name>(" | tail -1`)

### ฝั่งแอป
- **C1** `app/(app)/admin/users/actions.ts`: ตัดพารามิเตอร์ `authUserId` ออกจาก `resetPassword` / `setActive` / `deleteUser`
  แล้วเพิ่ม helper `authUserIdOf(profileId)` ที่อ่าน `profiles.auth_user_id` ฝั่ง server
  ⚠️ `deleteUser` ต้องอ่านค่านี้**ก่อน**เรียก `admin_delete_user` (RPC ปลดการผูกบัญชีออก)
  และแก้ฝั่งที่เรียกใน `users-admin.tsx:713,746` กับ `delete-user-button.tsx:38`
- **C4** `lib/format.ts`: เพิ่ม `todayTH()` ที่ใช้ `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" })` คืนค่า `YYYY-MM-DD`
  แล้วใช้แทน `toISOString().slice(0,10)` ทั้ง 6 จุด: `production-constants.ts:141` · `record-form.tsx:28` · `daily/page.tsx:11` ·
  `machines/page.tsx:21` · `(app)/page.tsx:273` · `notifications.ts:29`
  และเปลี่ยน `EMPTY` ใน record-form เป็นฟังก์ชัน `emptyValues()` เพื่อให้ได้วันที่ปัจจุบันทุกครั้ง
- **C5** `lib/offline-queue.ts`: เพิ่ม `profileId` ใน `PendingRecord` · เปลี่ยน key เป็น `pd_pending_records_v3:<profileId>` ·
  ส่ง `profileId` เข้าไปใน `pendingForJob` / `upsertPending` / `removePending` ·
  `record-form.tsx` รับ prop `profileId` จาก `board/[jobNo]/page.tsx` (เอามาจาก `profile.id`)
- **C6** `lib/data/job-constants.ts:61` เปลี่ยน role เป็น `["qa_lead"]` (แถวตีกลับคง `["qa"]`) ·
  `quality/quick-actions.tsx` เพิ่ม prop `canApprove` เพื่อซ่อนปุ่มอนุมัติเมื่อผู้ใช้ไม่ใช่หัวหน้า QA (ตีกลับยังกดได้) ·
  `quality/page.tsx` ส่งค่านี้เข้าไป · แก้ข้อความใน `role-access.ts:146` (หน้าสิทธิ์) ให้ตรงกับของจริง
- **C7** `lib/auth/roles.ts`: เปลี่ยนเป็น `canDeleteJob(roles, status)` — ถ้าสถานะเลย `planned` แล้ว ให้ผ่านเฉพาะ manager/admin ·
  แก้ที่เรียกใน `board/[jobNo]/page.tsx:476` และข้อความใน `role-access.ts` ("ลบงานได้ทุกขั้น")

### ลำดับ commit
1. แอป C1 + C5 (ไม่ขึ้นกับ DB) → commit/push
2. `0105` + แอป C2/C4/C6/C7 → commit/push → **ผู้ใช้ paste 0105** ลง Supabase SQL Editor
   (โค้ดขึ้นเว็บก่อน SQL ลง: ช่วงที่ยังไม่ paste จะมีแค่ปุ่ม UI ที่ซ่อนไปก่อน DB ยังยอมรับคำสั่งเดิม ไม่มีอะไรพัง)
3. ปิดงานด้วย skill `handoff`

## Verification
- `npx tsc --noEmit --incremental false` และ `npx eslint .` ต้องได้ 0 error
- คำสั่งตรวจ SQL ท้าย 0105 (ผลที่ต้องได้ระบุไว้ทุกข้อ) เช่น `prosrc like '%app.esign%'` ใน advance_job_status = true ·
  `proconfig` ของ `add_production_record` มี `timezone=Asia/Bangkok`
- ทดสอบมือบน `pd-monitor.vercel.app` (หรือ `npm run dev`):
  1. หัวหน้าแผนก: กดรีเซ็ตรหัส ระงับ และลบลูกน้อง → ยังทำงานปกติ (C1)
  2. ระงับบัญชี A แล้วใช้ session เดิมกดบันทึก → ขึ้น "ยังไม่ได้เข้าสู่ระบบ" (C3)
  3. พนักงาน QA: ไม่เห็นปุ่ม "ปล่อยผ่าน → FG" แต่ยังเห็น "ตีกลับ" · หัวหน้า QA ลงนามผ่าน → งานไป FG และมีแถวใน `approvals` (C2/C6)
  4. หัวหน้าคลัง: ลบงานที่ "มีแผนแล้ว" ได้ · งานที่ "กำลังผลิต" ไม่เห็นปุ่มลบ (C7)
  5. ทดสอบ timezone: เรียก `todayTH()` โดยจำลองเวลา 02:00 ไทย ต้องได้วันที่ของวันนั้น · SQL `select (now() at time zone 'Asia/Bangkok')::date` เทียบกับผลจาก RPC (C4)
  6. บันทึกค้างในคิวด้วยบัญชี A (ปิดเน็ตใน devtools) → ออกจากระบบ → B ล็อกอินแล้วเปิดงานเดียวกัน → **ต้องไม่เห็นรายการของ A** (C5)
