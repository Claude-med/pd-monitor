"""บีบสกรีนช็อตก่อนฝังลง PDF — ตัดขอบว่าง + ย่อ + ลดจำนวนสี (palette)
เก็บต้นฉบับไว้ที่ .cache/raw/ เสมอ → รันซ้ำได้ ไม่เสียคุณภาพสะสม

ใช้:  python optimize-img.py [--max-width 1200] [--colors 256] [--restore]
"""
import sys, pathlib, shutil
from PIL import Image, ImageChops

HERE = pathlib.Path(__file__).resolve().parent
IMG = HERE.parent / "manual-img"
RAW = HERE / ".cache" / "raw"
RAW.mkdir(parents=True, exist_ok=True)

arg = lambda k, d: int(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
MAXW = arg("--max-width", 1200)
COLORS = arg("--colors", 256)

if "--restore" in sys.argv:
    n = 0
    for f in RAW.glob("*.png"):
        shutil.copy2(f, IMG / f.name); n += 1
    print(f"คืนต้นฉบับ {n} ไฟล์"); raise SystemExit

# ครอปเฉพาะบางใบ (สัดส่วน left, top, right, bottom ของภาพ) — ใบที่สูงเกินจนพิมพ์แล้วอ่านไม่ออก
CROP = {
    "04-sidebar-user.png": (0.0, 0.60, 1.0, 1.0),   # เอาเฉพาะท้ายแถบเมนู: ชื่อผู้ใช้ + ชิปสิทธิ์
}

def trim(im):
    """ตัดแถบสีพื้นเรียบที่ขอบล่าง/ขวา (พื้นที่ว่างของหน้าจอที่เนื้อหาไม่เต็ม)"""
    rgb = im.convert("RGB")
    bg = Image.new("RGB", rgb.size, rgb.getpixel((rgb.width - 2, rgb.height - 2)))
    diff = ImageChops.difference(rgb, bg).convert("L").point(lambda p: 255 if p > 6 else 0)
    box = diff.getbbox()
    if not box:
        return im
    right, bottom = min(im.width, box[2] + 12), min(im.height, box[3] + 12)
    if right >= im.width - 8 and bottom >= im.height - 8:
        return im
    return im.crop((0, 0, right, bottom))

before = after = 0
tall = []
for f in sorted(IMG.glob("*.png")):
    raw = RAW / f.name
    if not raw.exists():
        shutil.copy2(f, raw)          # เก็บต้นฉบับครั้งแรก
    im = Image.open(raw)              # ทำงานจากต้นฉบับเสมอ
    before += raw.stat().st_size
    if f.name in CROP:
        l, t, r, b = CROP[f.name]
        im = im.crop((int(l * im.width), int(t * im.height), int(r * im.width), int(b * im.height)))
    im = trim(im)
    if im.width > MAXW:
        im = im.resize((MAXW, round(im.height * MAXW / im.width)), Image.LANCZOS)
    out = im.convert("RGB").quantize(colors=COLORS, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG)
    out.save(f, "PNG", optimize=True)
    after += f.stat().st_size
    if im.height > im.width * 2.6:
        tall.append(f"{f.name} ({im.width}x{im.height})")

print(f"บีบ {len(list(IMG.glob('*.png')))} ไฟล์ · {before/1048576:.1f} -> {after/1048576:.1f} MB")
if tall:
    print("\n⚠️ ภาพที่สูงเกินสัดส่วน (พิมพ์แล้วจะเล็กจนอ่านไม่ออก) — ควรถ่ายใหม่แบบไม่เต็มหน้า:")
    for t in tall: print("   ", t)
