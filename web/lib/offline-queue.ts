// ============================================================
// คิวบันทึกที่ "ค้าง" ไว้ในเครื่อง (localStorage) — recommendations.md C1
// ใช้กันข้อมูลหายเวลาเน็ตโรงงานกระตุก/ปิดหน้าจอกลางคัน
//   - แต่ละรายการมี clientId (UUID) เป็น idempotency key → retry ไม่เกิดแถวซ้ำ
//   - เก็บเฉพาะฝั่ง browser (ทุกฟังก์ชัน guard window ให้ปลอดภัยกับ SSR)
// ============================================================
import type { RecordFormValues } from "@/lib/data/production-constants";

export type PendingRecord = {
  clientId: string;
  /** ผู้บันทึก (profiles.id) — คิวแยกตามคน ส่งใหม่ได้เฉพาะในนามเจ้าของรายการ */
  profileId: string;
  jobId: string;
  jobNo: string;
  /** ขั้นตอนการผลิตของบันทึกนี้ (job_routes.id) — Part C.3 ก้อน 5 */
  jobRouteId: string;
  values: RecordFormValues;
  queuedAt: string; // ISO เวลาเข้าคิว
};

// ⚠️ ขึ้นเลข version เมื่อโครง values เปลี่ยน — คิวเก่าที่ค้างในเครื่องมีรูปคนละแบบ
//    ถ้าใช้ key เดิม จะดึงของเก่าขึ้นมาแล้วยิงเข้า RPC ใหม่ไม่ผ่านแบบงง ๆ
// 🚨 v3 (รีวิว 1 ต.ค. 69): แยก key ตามผู้ใช้ — เดิม key เดียวทั้งเครื่อง
//    แท็บเล็ตที่ใช้ร่วมกัน: A บันทึกค้างแล้วออกจากระบบ → B เปิดงานเดียวกัน
//    ระบบส่งรายการของ A ขึ้นไป "ในนามของ B" (ผู้บันทึกผิดคน = ผิด ALCOA)
const KEY_PREFIX = "pd_pending_records_v3:";

function keyOf(profileId: string): string {
  return KEY_PREFIX + profileId;
}

/** UUID จากฝั่ง client (crypto ถ้ามี ไม่งั้น fallback) */
export function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // fallback (กรณี browser เก่า/ไม่ใช่ secure context)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const val = c === "x" ? r : (r & 0x3) | 0x8;
    return val.toString(16);
  });
}

function readAll(profileId: string): PendingRecord[] {
  if (typeof window === "undefined" || !profileId) return [];
  try {
    const raw = window.localStorage.getItem(keyOf(profileId));
    const list = raw ? (JSON.parse(raw) as PendingRecord[]) : [];
    // กันข้อมูลที่ถูกแก้มือ/ปนกัน — ส่งเฉพาะรายการที่เป็นของผู้ใช้คนนี้จริง
    return list.filter((r) => r.profileId === profileId);
  } catch {
    return [];
  }
}

function writeAll(profileId: string, list: PendingRecord[]): void {
  if (typeof window === "undefined" || !profileId) return;
  try {
    window.localStorage.setItem(keyOf(profileId), JSON.stringify(list));
  } catch {
    // เต็ม/โดนปิด — ยอมพลาดเงียบ ๆ (ดีกว่าทำแอปพัง)
  }
}

/** เพิ่ม/อัปเดตรายการในคิวของเจ้าของรายการ (อิง clientId) */
export function upsertPending(rec: PendingRecord): void {
  const list = readAll(rec.profileId).filter((r) => r.clientId !== rec.clientId);
  list.push(rec);
  writeAll(rec.profileId, list);
}

/** เอารายการออกจากคิว (บันทึกสำเร็จ หรือยกเลิก) */
export function removePending(profileId: string, clientId: string): void {
  writeAll(
    profileId,
    readAll(profileId).filter((r) => r.clientId !== clientId),
  );
}

/** รายการที่ค้างของงานนี้ — เฉพาะของผู้ใช้คนนี้ */
export function pendingForJob(profileId: string, jobId: string): PendingRecord[] {
  return readAll(profileId).filter((r) => r.jobId === jobId);
}
