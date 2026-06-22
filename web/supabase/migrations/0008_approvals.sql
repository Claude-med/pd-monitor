-- ============================================================
-- PD Monitor — D6 / 0008_approvals.sql
-- E-signature (lite): ลายเซ็นอนุมัติ/ตีกลับของ QC/QA + ตาราง approvals
-- (อ่านคู่ docs/recommendations.md A3 — e-signature lite)
-- รัน "หลัง" 0001-0007
-- ============================================================
--
-- แนวคิด:
--   - การตัดสิน QC/QA (ผ่าน/ไม่ผ่าน) ต้อง "ลงนาม" = ยืนยันรหัสผ่านซ้ำที่หน้าจอ (ทำฝั่งแอป)
--     แล้วบันทึกเป็น record ถาวรในตาราง approvals (ใคร/ขั้นไหน/ผลตัดสิน/เหตุผล/เวลา)
--   - ฟังก์ชันนี้บันทึกลายเซ็น "และ" ขยับสถานะงานในธุรกรรมเดียว (atomic — เซ็นแล้วสถานะต้องขยับ)
--     โดยเรียก advance_job_status() ตัวเดิมเป็นด่านบังคับลำดับ/สิทธิ์ (ไม่ทำ logic ซ้ำ)

-- ------------------------------------------------------------
-- ตาราง approvals — ลายเซ็นการตัดสินคุณภาพ (append เป็นประวัติ)
-- ------------------------------------------------------------
create table if not exists public.approvals (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id),  -- ผู้ลงนาม
  stage       text not null check (stage in ('qc', 'qa')),
  decision    text not null check (decision in ('approve', 'reject')),
  reason      text,                                           -- จำเป็นเมื่อ reject
  signed_at   timestamptz not null default now(),
  created_by  uuid references public.profiles(id),
  updated_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1
);

create index if not exists idx_approvals_job   on public.approvals(job_id);
create index if not exists idx_approvals_signer on public.approvals(profile_id);

-- meta trigger (updated_at + version + กันแก้ created_*) ตัวเดียวกับตารางอื่น
drop trigger if exists trg_meta_approvals on public.approvals;
create trigger trg_meta_approvals before insert or update on public.approvals
  for each row execute function public.set_row_meta();

-- audit trigger (บันทึกทุก insert/update/delete)
drop trigger if exists trg_audit_approvals on public.approvals;
create trigger trg_audit_approvals after insert or update or delete on public.approvals
  for each row execute function public.log_audit();

-- RLS: เปิด + authenticated อ่านได้ (เขียนผ่านฟังก์ชัน security definer เท่านั้น)
alter table public.approvals enable row level security;
drop policy if exists read_authenticated on public.approvals;
create policy read_authenticated on public.approvals
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- ฟังก์ชัน sign_job_decision — ลงนาม + ขยับสถานะ (atomic)
-- ------------------------------------------------------------
create or replace function public.sign_job_decision(
  p_job_id   uuid,
  p_stage    text,
  p_decision text,
  p_reason   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_from    job_status;
  v_to      job_status;
  v_id      uuid;
begin
  -- ต้องล็อกอิน
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;

  if p_stage not in ('qc', 'qa') then
    raise exception 'ขั้นลงนามไม่ถูกต้อง';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'ผลตัดสินไม่ถูกต้อง';
  end if;

  -- ตรวจสิทธิ์ตามขั้น (QC เซ็นขั้น QC, QA เซ็นขั้น QA)
  if p_stage = 'qc' and not public.has_role('qc') then
    raise exception 'ต้องเป็น QC จึงลงนามขั้นนี้ได้';
  end if;
  if p_stage = 'qa' and not public.has_role('qa') then
    raise exception 'ต้องเป็น QA จึงลงนามขั้นนี้ได้';
  end if;

  -- ตีกลับต้องมีเหตุผล
  if p_decision = 'reject' and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'การไม่ผ่าน (reject) ต้องระบุเหตุผล';
  end if;

  -- หาสถานะปลายทางจากขั้น + ผลตัดสิน
  if    p_stage = 'qc' and p_decision = 'approve' then v_to := 'qa';
  elsif p_stage = 'qc' and p_decision = 'reject'  then v_to := 'in_production';
  elsif p_stage = 'qa' and p_decision = 'approve' then v_to := 'finished_goods';
  else  /* qa + reject */                              v_to := 'in_production';
  end if;

  -- งานต้องอยู่ขั้นที่ลงนามจริง (ล็อกแถวกัน concurrent)
  select status into v_from from public.jobs where id = p_job_id for update;
  if v_from is null then
    raise exception 'ไม่พบงานนี้';
  end if;
  if v_from::text <> p_stage then
    raise exception 'งานนี้ไม่ได้อยู่ขั้น % (สถานะปัจจุบัน: %)', upper(p_stage), v_from;
  end if;

  -- บันทึกลายเซ็น + audit attribution
  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config(
    'app.audit_reason',
    'ลงนาม ' || upper(p_stage) || ' — ' ||
      case when p_decision = 'approve' then 'อนุมัติ' else 'ตีกลับ' end,
    true
  );

  insert into public.approvals (job_id, profile_id, stage, decision, reason, created_by)
  values (p_job_id, v_profile, p_stage, p_decision,
          nullif(btrim(coalesce(p_reason, '')), ''), v_profile)
  returning id into v_id;

  -- ขยับสถานะผ่านด่านเดิม (re-check ลำดับ/สิทธิ์/เหตุผล + เขียน audit ของ jobs)
  perform public.advance_job_status(p_job_id, v_to, p_reason);

  return v_id;
end;
$$;

grant execute on function public.sign_job_decision(uuid, text, text, text) to authenticated;
