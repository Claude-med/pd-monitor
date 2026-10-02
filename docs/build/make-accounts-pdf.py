"""สร้าง PDF "บัญชีผู้ทดสอบ" (ล็อกรหัสเปิดไฟล์ AES-256) จากผลของ web/scripts/create-accounts.mjs

ใช้:  python make-accounts-pdf.py
  อ่าน   docs/handoff/.private/accounts-handoff.json   (อีเมล + รหัสชั่วคราว — ไม่ขึ้น git)
  ได้    docs/handoff/.private/PD Monitor - บัญชีผู้ทดสอบ.pdf  (ล็อกรหัส)
         docs/handoff/.private/pdf-password.txt          (รหัสเปิดไฟล์ — ส่งแยกทางไลน์)
⚠️ ทุกไฟล์ใน .private มีรหัสผ่านจริง — อยู่ใน .gitignore ห้ามย้ายออกมา
"""
import json, pathlib, secrets, subprocess, sys

try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass
from pypdf import PdfReader, PdfWriter

HERE = pathlib.Path(__file__).resolve().parent
PRIV = HERE.parent / "handoff" / ".private"
accounts = json.loads((PRIV / "accounts-handoff.json").read_text(encoding="utf-8"))

ROLE_TH = {
    "admin": "ผู้ดูแลระบบ", "manager": "ผู้บริหาร",
    "planner_lead": "หัวหน้าฝ่ายวางแผน", "planner": "ฝ่ายวางแผน",
    "production_lead": "หัวหน้าฝ่ายผลิต", "production": "ฝ่ายผลิต",
    "qc_lead": "หัวหน้า QC", "qc": "QC",
    "qa_lead": "หัวหน้า QA", "qa": "QA",
    "warehouse_lead": "หัวหน้าคลังสินค้า", "warehouse": "คลังสินค้า",
    "engineering_lead": "หัวหน้าวิศวกรรม", "engineering": "วิศวกรรม",
    "cost_lead": "หัวหน้าบัญชีต้นทุน", "cost": "บัญชีต้นทุน",
}
MFA = {"admin", "manager"}

rows = "\n".join(
    f"| {i} | **{' · '.join(ROLE_TH[r] for r in a['roles'])}**{' 🔒' if MFA & set(a['roles']) else ''} | {a['full_name']} | `{a['email']}` | `{a['password']}` |"
    for i, a in enumerate(accounts, 1))

md = f"""# บัญชีผู้ทดสอบ PD Monitor

> เว็บ: **https://pd-monitor.vercel.app** · {len(accounts)} บัญชี (สิทธิ์ละ 1 บัญชี) · ⚠️ เอกสารลับ — ห้ามส่งต่อนอกทีมทดสอบ

| # | สิทธิ์ (role) | ชื่อในระบบ (สมมติ) | อีเมลเข้าระบบ | รหัสชั่วคราว |
|:---:|---|---|---|---|
{rows}

> 🔒 **1 บัญชี = 1 คน** — ตกลงกันในกลุ่มก่อนว่าใครถือบัญชีไหน · คนแรกที่ล็อกอินจะต้อง **ตั้งรหัสผ่านใหม่ของตัวเอง** (อย่างน้อย 8 ตัว)
> หลังจากนั้นรหัสชั่วคราวในเอกสารนี้ใช้ไม่ได้อีก และคนอื่นจะเข้าบัญชีนั้นไม่ได้

> 🔒 **บัญชีที่มีเครื่องหมาย 🔒 (ผู้ดูแลระบบ · ผู้บริหาร)** ต้องตั้ง **ยืนยันตัวตน 2 ชั้น** ตอนล็อกอินครั้งแรก —
> ติดตั้งแอป *Google Authenticator* หรือ *Microsoft Authenticator* ในมือถือก่อน

> 💡 **อยากได้บัญชีเพิ่ม** (เช่น พนักงานฝ่ายผลิตหลายคน) — ให้ **หัวหน้าฝ่ายนั้น** สร้างเองที่เมนู *จัดการผู้ใช้*
> (ผู้ดูแลระบบ / ผู้บริหาร สร้างได้ทุกฝ่าย) · แก้ชื่อเป็นชื่อจริงได้ · **ลืมรหัส** → หัวหน้าฝ่ายกด *รีเซ็ตรหัสผ่าน* ·
> **ผู้บริหารทำมือถือหาย** → ผู้ดูแลระบบกด *รีเซ็ต MFA*
"""
md_path = PRIV / "accounts.md"
md_path.write_text(md, encoding="utf-8")
plain = PRIV / "_plain.pdf"
subprocess.run(["node", "build-doc.mjs", str(md_path), str(plain), "--kicker", "เอกสารลับ · PD MONITOR"],
               cwd=HERE, check=True)

pw_file = PRIV / "pdf-password.txt"
pw = pw_file.read_text(encoding="utf-8").strip() if pw_file.exists() else f"PD-{secrets.randbelow(10**6):06d}"
w = PdfWriter(clone_from=PdfReader(str(plain)))
w.encrypt(user_password=pw, owner_password=secrets.token_hex(16), algorithm="AES-256")
out = PRIV / "PD Monitor - บัญชีผู้ทดสอบ.pdf"
with open(out, "wb") as f:
    w.write(f)
plain.unlink()
md_path.unlink()
pw_file.write_text(pw, encoding="utf-8")
print(f"✅ {out.name} (ล็อกรหัส AES-256) · รหัสเปิดไฟล์อยู่ใน {pw_file.name}")
