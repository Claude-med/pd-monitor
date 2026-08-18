// ค่าคงที่รูปแบบบรรจุ — ไฟล์นี้ "ไม่มี" server import → ใช้ได้ทั้ง Server/Client
// (เก็บเป็น text ใน jobs.pack_type ตั้งแต่ Part 2 — ตัวเลือกนี้เป็นแค่ตัวช่วยกรอก)
// Part 3: ตัด "กระปุก" ออกตามที่ทีมแจ้ง — งานเก่าที่เคยเลือกไว้ยังแสดงได้ปกติ (เก็บเป็น text)

export const PACK_TYPES = [
  "Blister",
  "Strip",
  "ซอง (Sachet)",
  "ขวด",
  "อื่นๆ",
] as const;
