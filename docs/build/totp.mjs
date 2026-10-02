// สร้างรหัส TOTP 6 หลัก (RFC 6238 · SHA1 · 30 วินาที) จากรหัสลับ base32
// ใช้กับสคริปต์ถ่ายภาพ/ทดสอบ ที่ต้องล็อกอินบัญชีผู้บริหาร/admin (บังคับ MFA ตั้งแต่ 0110)
import crypto from "node:crypto";

function base32Decode(s) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase().replace(/\s/g, "")) {
    const v = alpha.indexOf(c);
    if (v < 0) throw new Error(`base32 ผิดรูปแบบ: ${c}`);
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/** รอให้รหัสปัจจุบันเหลืออายุ ≥ 5 วินาที (กันส่งรหัสที่กำลังจะหมดอายุ) */
export async function freshTotp(secret) {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < 5) await new Promise((r) => setTimeout(r, left * 1000 + 300));
  return totp(secret);
}
