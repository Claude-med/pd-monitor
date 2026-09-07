# วิธีสร้างคู่มือ `docs/pd-monitor-manual.pdf` ใหม่

คู่มือรวมเล่มเดียวถูกประกอบจาก **markdown 3 ไฟล์ + สกรีนช็อตจากเว็บจริง**
โฟลเดอร์นี้เก็บเครื่องมือทั้งหมดไว้ เพื่อให้สร้างซ้ำได้ทุกเมื่อ (ของเดิมสร้างซ้ำไม่ได้เพราะสคริปต์ไม่ได้ commit)

> 📌 **จะแก้คู่มือรอบหน้า อ่าน [`NEXT-ROUND.md`](NEXT-ROUND.md) ก่อน** — ในนั้นมีรายการที่ค้างไว้
> เรื่องการจัดหน้า และตาราง "ฟีเจอร์เปลี่ยน → ต้องแก้คู่มือตรงไหน"

## ต้นทาง

| ไฟล์ | เป็นอะไรในเล่ม |
|---|---|
| `docs/manual-intro.md` | ส่วนหน้า — วิธีใช้คู่มือ · ฉันเป็นฝ่ายไหน · สัญลักษณ์ |
| `docs/tutorial-walkthrough.md` | **ภาค 1 — ฝึกปฏิบัติ** |
| `docs/user-guide.md` | **ภาค 2 — คู่มืออ้างอิง** |
| `docs/manual-img/` | สกรีนช็อต (ถ่ายด้วย `shoot.mjs`) |

## ติดตั้งครั้งแรก

```bash
cd docs/build
npm install
```

ต้องมีในเครื่อง: **Node 20+** · **Chrome** (ค่าเริ่มต้น `C:/Program Files/Google/Chrome/Application/chrome.exe`
เปลี่ยนได้ด้วย env `PD_CHROME`) · **Python + Pillow** (สำหรับบีบภาพ) · `pip install pypdfium2` (สำหรับตรวจ PDF)

## สร้าง PDF (ไม่ถ่ายภาพใหม่)

```bash
node build-pdf.mjs          # -> docs/pd-monitor-manual.pdf
node build-pdf.mjs --html-only   # หยุดที่ HTML (ดูที่ .cache/manual.html)
```

สิ่งที่สคริปต์ทำ: รวม markdown 3 ไฟล์ → ใส่ `id` ให้หัวข้อ (prefix `in-` / `p1-` / `p2-` กัน id ชนกัน) →
สร้างสารบัญที่มี **เลขหน้าอัตโนมัติ** ด้วย `target-counter()` → **ฝังฟอนต์ Sarabun (มีซับเซ็ตไทย)**
และรูปทั้งหมดเป็น base64 → จัดหน้าด้วย **paged.js** (เก็บไว้ใน `vendor/` ไม่พึ่ง CDN) →
พิมพ์เป็น PDF ด้วย Chrome ผ่าน `page.pdf()`

## ถ่ายสกรีนช็อตใหม่

ต้องมี `.accounts.json` (อยู่ใน `.gitignore` — ไม่ขึ้น GitHub) รูปแบบ:

```json
{ "base": "https://pd-monitor.vercel.app",
  "accounts": { "manager": { "email": "...", "password": "...", "roles": ["manager"] } } }
```

```bash
node shoot.mjs                       # ถ่ายทุกใบใน shots.json
node shoot.mjs 38 39 40              # ถ่ายเฉพาะ id ที่ขึ้นต้นด้วยเลขนี้
node shoot.mjs --probe manager /board   # ส่องหน้าเว็บ: หัวข้อ ปุ่ม selector ที่ใช้ได้
node probe-dom.mjs manager /board/690005 # ดูโครง DOM ของ main (ไว้หาว่า "การ์ด" ไหนอยู่ตรงไหน)
python optimize-img.py               # บีบภาพ (ต้นฉบับถูกเก็บที่ .cache/raw/)
python optimize-img.py --restore     # คืนต้นฉบับ
```

> ⚠️ ทุกใบเป็นการ **เปิดดูอย่างเดียว** ยกเว้นใบที่ระบุ `actions` ซึ่งใช้แค่ "เปิดฟอร์ม" ไม่กดบันทึก
> — ห้ามใส่ action ที่ยิงข้อมูลจริงลงระบบ

`shots.json` หนึ่งรายการ = หนึ่งภาพ:

| ฟิลด์ | ความหมาย |
|---|---|
| `id` | ชื่อไฟล์ (ไม่ต้องใส่ `.png`) — เลขนำหน้าใช้จัดกลุ่ม |
| `role` | คีย์บัญชีใน `.accounts.json` · `"-"` = ไม่ล็อกอิน |
| `url` | path บนเว็บ |
| `waitFor` | รอ selector นี้ก่อนถ่าย |
| `viewport` | ขนาดจอของใบนี้ |
| `target` | `page` (เท่าจอ) · `full` (ทั้งหน้า) · CSS selector |
| `card` | ชื่อหัวข้อของ "การ์ด" ที่จะถ่าย (แม่นกว่า selector) |
| `actions` | `click` · `clickText` · `type` · `select` · `waitFor` · `scrollTo` · `eval` · `pause` |
| `keepLiveBadge` | ไม่ซ่อนป้าย "อัปเดตสด" |

## ตรวจผลลัพธ์

```bash
python check-pdf.py            # หาหน้าว่าง / หน้าที่เนื้อหาน้อยผิดปกติ
python inspect-pdf.py 1,2,24   # เรนเดอร์หน้าที่ระบุเป็น PNG ไว้ดูด้วยตา (.cache/pages/)
```

## กับดักที่เคยเจอมาแล้ว

1. **ฟอนต์ไทยต้องฝังซับเซ็ต `U+0E01–0E5B` ด้วย** — เล่มเดิมฝังแต่ latin ⇒ ตัวไทยตกไปใช้ฟอนต์ระบบ
   หน้าตา PDF จึงไม่เหมือนกันในแต่ละเครื่อง (`fonts/manifest.json` คุมว่าฝังไฟล์ไหนบ้าง)
2. **`id` ของหัวข้อต้องไม่ชนกันข้ามภาค** — `target-counter()` ของสารบัญพังเงียบ ๆ ทันทีถ้าชน
3. **`---` ที่อยู่ติดหน้า `#` ต้องตัดทิ้ง** — ไม่งั้นเส้นคั่นจะไปนอนอยู่บนหน้าเปล่าของตัวเอง
   (build-pdf.mjs ตัดให้แล้ว)
4. **Pillow เข้ารหัส PNG แพ้ Chrome** — ต้อง `quantize()` เป็น palette ก่อน ไม่งั้นบีบแล้วไฟล์โตขึ้น
5. **ภาพที่สูงเกิน ~2.6 เท่าของความกว้าง พิมพ์แล้วอ่านไม่ออก** — `optimize-img.py` เตือนให้
   ถ่ายใหม่แบบ `target: "page"` แทน `"full"`
6. **`page.pdf()` ต้องรอ paged.js จัดหน้าเสร็จก่อน** — นี่คือเหตุผลที่ไม่ใช้ `chrome --print-to-pdf`
