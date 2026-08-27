// ============================================================
// คิวบันทึกที่ "ค้าง" ไว้ในเครื่อง (localStorage) — recommendations.md C1
// ใช้กันข้อมูลหายเวลาเน็ตโรงงานกระตุก/ปิดหน้าจอกลางคัน
//   - แต่ละรายการมี clientId (UUID) เป็น idempotency key → retry ไม่เกิดแถวซ้ำ
//   - เก็บเฉพาะฝั่ง browser (ทุกฟังก์ชัน guard window ให้ปลอดภัยกับ SSR)
// ============================================================
import type { RecordFormValues } from "@/lib/data/production-constants";

export type PendingRecord = {
  clientId: string;
  jobId: string;
  jobNo: string;
  /** ขั้นตอนการผลิตของบันทึกนี้ (job_routes.id) — Part C.3 ก้อน 5 */
  jobRouteId: string;
  values: RecordFormValues;
  queuedAt: string; // ISO เวลาเข้าคิว
};

// ⚠️ ขึ้นเลข version เมื่อโครง values เปลี่ยน — คิวเก่าที่ค้างในเครื่องมีรูปคนละแบบ
//    ถ้าใช้ key เดิม จะดึงของเก่าขึ้นมาแล้วยิงเข้า RPC ใหม่ไม่ผ่านแบบงง ๆ
const KEY = "pd_pending_records_v2";

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

function readAll(): PendingRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingRecord[]) : [];
  } catch {
    return [];
  }
}

function writeAll(list: PendingRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // เต็ม/โดนปิด — ยอมพลาดเงียบ ๆ (ดีกว่าทำแอปพัง)
  }
}

/** เพิ่ม/อัปเดตรายการในคิว (อิง clientId) */
export function upsertPending(rec: PendingRecord): void {
  const list = readAll().filter((r) => r.clientId !== rec.clientId);
  list.push(rec);
  writeAll(list);
}

/** เอารายการออกจากคิว (บันทึกสำเร็จ หรือยกเลิก) */
export function removePending(clientId: string): void {
  writeAll(readAll().filter((r) => r.clientId !== clientId));
}

/** รายการที่ค้างของงานนี้ */
export function pendingForJob(jobId: string): PendingRecord[] {
  return readAll().filter((r) => r.jobId === jobId);
}
