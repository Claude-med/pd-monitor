"""ปรับจำนวนบรรทัดของช่อง "บันทึกของแผนก" ให้เต็มพื้นที่ที่เหลือของแต่ละแผ่นอ้างอิง (§4 สรุปรายฝ่าย)

หัวข้อ 4 ออกแบบให้ 1 ฝ่าย = 1 หน้า ฉีกไปแปะข้างเครื่องได้ · แต่ละฝ่ายเนื้อหายาวไม่เท่ากัน
สคริปต์นี้จึงวัดที่ว่างจริงของแต่ละหน้า แล้วเติมบรรทัดสำหรับเขียนมือให้พอดี

วิธีทำงาน:  build → วัดพื้นที่ที่ใช้ของแต่ละแผ่น → คำนวณจำนวนบรรทัดใหม่
           → เขียนกลับลง user-guide.md เป็น <!--sheet-notes:N--> → build ซ้ำ

รันใหม่ทุกครั้งที่แก้เนื้อหาหัวข้อ 4:   python tune-sheets.py
"""

import re
import pathlib
import subprocess
import numpy as np
import pypdfium2 as pdfium

HERE = pathlib.Path(__file__).resolve().parent
UG = HERE.parent / "user-guide.md"
PDF = HERE / ".cache" / "manual-out.pdf"

LINE_MM = 7.5      # ความสูงของเส้นเขียน 1 บรรทัด
BODY_MM = 250.0    # ความสูงพื้นที่เนื้อหาต่อหน้า (A4 หักขอบบน/ล่าง)
TARGET = 0.90      # อยากให้แต่ละแผ่นเต็มประมาณกี่ส่วน


def build():
    r = subprocess.run(["node", "build-pdf.mjs"], cwd=HERE, capture_output=True, encoding="utf-8", errors="replace")
    if not PDF.exists():
        raise SystemExit("build ไม่สำเร็จ:\n" + (r.stdout or "") + (r.stderr or ""))


def sheet_pages():
    """หน้าที่เป็นแผ่นอ้างอิงรายฝ่าย = ในเนื้อหา (หลังเลขหน้า) มีหัวข้อ 4.x อยู่ต้น ๆ"""
    doc = pdfium.PdfDocument(PDF)
    found = []
    for i in range(len(doc)):
        t = doc[i].get_textpage().get_text_range()
        m = re.search(r"\d+\s*/\s*\d+", t)          # ข้ามหัวกระดาษ + เลขหน้า
        body = t[m.end():] if m else t
        if not re.search(r"(?<![\d.])4\.[1-8](?![\d])", body[:300]):
            continue
        a = np.asarray(doc[i].render(scale=0.35).to_pil().convert("L"))
        h = a.shape[0]
        area = a[int(h * 0.06):int(h * 0.94)]
        ink = np.where((area < 245).sum(axis=1) > 2)[0]
        used = (ink[-1] - ink[0]) / area.shape[0] if len(ink) else 0.0
        found.append((i + 1, used))
    return found


build()
pages = sheet_pages()
markers = list(re.finditer(r"<!--sheet-notes(?::(\d+))?-->", UG.read_text(encoding="utf-8")))

if not pages:
    raise SystemExit("ไม่เจอแผ่นอ้างอิงรายฝ่ายใน PDF — ข้าม")
if len(markers) != len(pages):
    raise SystemExit(f"⚠️ มาร์กเกอร์ {len(markers)} อัน แต่เจอแผ่น {len(pages)} หน้า — ตรวจ user-guide.md ก่อน")

s = UG.read_text(encoding="utf-8")
counts, out, last = [], [], 0
for (pg, used), m in zip(pages, markers):
    cur = int(m.group(1) or 5)
    add = int(max(0.0, (TARGET - used) * BODY_MM) // LINE_MM)
    counts.append(max(2, min(26, cur + add)))
for m, n in zip(markers, counts):
    out.append(s[last:m.start()])
    out.append(f"<!--sheet-notes:{n}-->")
    last = m.end()
out.append(s[last:])
UG.write_text("".join(out), encoding="utf-8")

print("ปรับจำนวนบรรทัดช่อง 'บันทึกของแผนก':")
for (pg, used), n in zip(pages, counts):
    print(f"   หน้า {pg:>3} · ใช้พื้นที่เดิม {used*100:>3.0f}%  ->  {n} บรรทัด")

build()
print("\nbuild ซ้ำเรียบร้อย")
