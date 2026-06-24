// ค่าคงที่รูปแบบบรรจุ — ไฟล์นี้ "ไม่มี" server import → ใช้ได้ทั้ง Server/Client
// (เก็บเป็น text ใน products.pack_type — ตัวเลือกนี้เป็นแค่ตัวช่วยกรอก)

export const PACK_TYPES = [
  "Blister",
  "Strip",
  "ซอง (Sachet)",
  "ขวด",
  "กระปุก",
  "อื่นๆ",
] as const;
