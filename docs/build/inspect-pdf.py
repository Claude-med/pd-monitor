"""ตรวจ PDF ที่ build ออกมา: เรนเดอร์เป็นภาพ + ดูฟอนต์ที่ฝังจริง
ใช้:  python inspect-pdf.py [หน้าที่อยากเรนเดอร์ เช่น 1,2,3,10]"""
import sys
# คอนโซล Windows เป็น cp874 พิมพ์ "·" ไม่ได้ — บังคับ UTF-8 ไม่งั้นสคริปต์ตายกลางทาง
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass
import sys, pathlib, pypdfium2 as pdfium

PDF = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else pathlib.Path(__file__).resolve().parent.parent / "pd-monitor-manual.pdf"
OUT = pathlib.Path(__file__).resolve().parent / ".cache" / "pages"
OUT.mkdir(parents=True, exist_ok=True)

doc = pdfium.PdfDocument(PDF)
print(f"{PDF.name} — {len(doc)} หน้า · {PDF.stat().st_size/1048576:.1f} MB")

pages = [int(x) for x in sys.argv[1].split(",")] if len(sys.argv) > 1 else [1, 2, 3]
for n in pages:
    if not (1 <= n <= len(doc)):
        continue
    doc[n - 1].render(scale=1.6).to_pil().save(OUT / f"p{n:03d}.png")
print("เรนเดอร์:", ", ".join(f"p{n:03d}.png" for n in pages), "->", OUT)
