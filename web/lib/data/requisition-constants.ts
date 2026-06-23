// ค่าคงที่ใบเบิกวัตถุดิบ — pure (ใช้ได้ทั้ง Server/Client)
// ตรงกับ enum requisition_status ใน DB (0017_requisitions.sql)

export const REQ_STATUSES = [
  { key: "requested", label: "ขอเบิก", color: "#f59e0b" },
  { key: "issued", label: "จ่ายแล้ว", color: "#16a34a" },
  { key: "cancelled", label: "ยกเลิก", color: "#94a3b8" },
] as const;

export type RequisitionStatus = (typeof REQ_STATUSES)[number]["key"];

export const REQ_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  REQ_STATUSES.map((s) => [s.key, s.label]),
);
export const REQ_STATUS_COLOR: Record<string, string> = Object.fromEntries(
  REQ_STATUSES.map((s) => [s.key, s.color]),
);
