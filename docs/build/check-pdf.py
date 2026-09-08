"""ตรวจ PDF อัตโนมัติ: หน้าว่าง · หน้าที่เนื้อหาน้อยผิดปกติ · จำนวนหน้า
ใช้:  python check-pdf.py"""
import sys
# คอนโซล Windows เป็น cp874 พิมพ์ "·" ไม่ได้ — บังคับ UTF-8 ไม่งั้นสคริปต์ตายกลางทาง
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass
import pathlib, pypdfium2 as pdfium
from PIL import Image

import sys
_a = [x for x in sys.argv[1:] if not x.startswith("-")]
PDF = pathlib.Path(_a[0]) if _a else pathlib.Path(__file__).resolve().parent.parent / "pd-monitor-manual.pdf"
doc = pdfium.PdfDocument(PDF)
blank, sparse = [], []
for i in range(len(doc)):
    im = doc[i].render(scale=0.4).to_pil().convert("L")
    # นับพิกเซลที่ไม่ใช่สีขาว (มีหมึก)
    ink = sum(1 for px in im.getdata() if px < 240) / (im.width * im.height)
    if ink < 0.002:
        blank.append(i + 1)
    elif ink < 0.02:
        sparse.append((i + 1, round(ink * 100, 1)))

print(f"{PDF.name} — {len(doc)} หน้า · {PDF.stat().st_size/1048576:.1f} MB")
print(f"หน้าว่างเปล่า: {blank if blank else 'ไม่มี ✅'}")
if sparse:
    print("หน้าที่เนื้อหาน้อย (<2% ของพื้นที่ — เช็กว่าตั้งใจหรือหน้าเสีย):")
    for n, pct in sparse: print(f"   หน้า {n} ({pct}%)")
else:
    print("หน้าที่เนื้อหาน้อยผิดปกติ: ไม่มี ✅")
