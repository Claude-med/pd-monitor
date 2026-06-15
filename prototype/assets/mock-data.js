/* ============================================================
   mock-data.js — ข้อมูลตัวอย่างสำหรับ prototype (ไม่มี backend จริง)
   ข้อมูลนี้จะถูกโหลดเข้า localStorage ครั้งแรก แล้วแก้ไขสด ๆ ได้
   ============================================================ */

const SEED = {
  // ---------- Master: รายการยา ----------
  products: [
    { id: "P-001", name: "พาราเซตามอล 500 มก.", formula: "F-PARA-500", batchSize: 700000, packType: "Blister", size: "10×10's", stdTimeHr: 16 },
    { id: "P-002", name: "วิตามินซี 1000 มก.",   formula: "F-VITC-1000", batchSize: 500000, packType: "Strip",   size: "10×10's", stdTimeHr: 12 },
    { id: "P-003", name: "ฟ้าทะลายโจร แคปซูล",   formula: "F-ANDRO-400", batchSize: 300000, packType: "ขวด",     size: "60's",    stdTimeHr: 10 },
    { id: "P-004", name: "ยาแก้ไอ น้ำเชื่อม",     formula: "F-COUGH-SY",  batchSize: 20000,  packType: "ขวด",     size: "60 ml",   stdTimeHr: 8 },
    { id: "P-005", name: "แคลเซียม + D3",         formula: "F-CAL-D3",    batchSize: 400000, packType: "Blister", size: "10×10's", stdTimeHr: 14 },
    { id: "P-006", name: "ยาธาตุ ตรากระต่าย",     formula: "F-DIGEST",    batchSize: 250000, packType: "ซอง",     size: "50×10's", stdTimeHr: 9 },
  ],

  // ---------- Master: เครื่องจักร / station ----------
  machines: [
    { id: "M-MIX-01", name: "เครื่องผสม #1",  station: "ผสม" },
    { id: "M-MIX-02", name: "เครื่องผสม #2",  station: "ผสม" },
    { id: "M-TAB-01", name: "เครื่องตอก #1",  station: "ตอก" },
    { id: "M-TAB-02", name: "เครื่องตอก #2",  station: "ตอก" },
    { id: "M-CAP-01", name: "เครื่องแคปซูล #1", station: "แคปซูล" },
    { id: "M-BLI-01", name: "เครื่อง Blister #1", station: "บรรจุ" },
    { id: "M-STR-01", name: "เครื่อง Strip #1",   station: "บรรจุ" },
    { id: "M-BOT-01", name: "สายบรรจุขวด #1",     station: "บรรจุ" },
  ],

  // ลำดับ station มาตรฐานของ job ผลิตยาเม็ด
  stageFlow: ["เตรียมยา", "ผสม", "ตอก/แคปซูล", "บรรจุ", "QC", "QA", "FG"],

  // คอลัมน์บนบอร์ด + สี
  statuses: [
    { key: "รอแจ้งผลิต", color: "#94a3b8" },
    { key: "มีแผนแล้ว",  color: "#6366f1" },
    { key: "กำลังผลิต",  color: "#f59e0b" },
    { key: "QC",         color: "#0ea5e9" },
    { key: "QA",         color: "#a855f7" },
    { key: "FG",         color: "#22c55e" },
  ],

  // ---------- Jobs ----------
  jobs: [
    mkJob("JOB-2406-001", "P-001", "รพ.ศิริราช",        "L-24A-001", 1000, "กำลังผลิต", "2026-06", 3),
    mkJob("JOB-2406-002", "P-002", "ร้านขายยา ฟ้าใส",   "L-24A-002", 800,  "QC",        "2026-06", 4),
    mkJob("JOB-2406-003", "P-003", "บ.เฮลท์พลัส",        "L-24A-003", 500,  "มีแผนแล้ว", "2026-06", 1),
    mkJob("JOB-2406-004", "P-005", "รพ.บำรุงราษฎร์",     "L-24A-004", 1200, "กำลังผลิต", "2026-06", 2),
    mkJob("JOB-2406-005", "P-004", "ร้านยา สุขภาพดี",    "L-24A-005", 300,  "รอแจ้งผลิต","2026-07", 0),
    mkJob("JOB-2406-006", "P-006", "บ.เนเชอรัล",         "L-24A-006", 600,  "QA",        "2026-06", 5),
    mkJob("JOB-2406-007", "P-001", "รพ.จุฬาฯ",           "L-24A-007", 1500, "FG",        "2026-06", 6),
    mkJob("JOB-2406-008", "P-002", "บ.เมก้าฟาร์ม",       "L-24A-008", 700,  "มีแผนแล้ว", "2026-07", 1),
    mkJob("JOB-2406-009", "P-003", "ร้านยา เภสัชกร",     "L-24A-009", 400,  "รอแจ้งผลิต","",        0),
    mkJob("JOB-2406-010", "P-005", "รพ.รามาธิบดี",       "L-24A-010", 900,  "กำลังผลิต", "2026-06", 2),
    mkJob("JOB-2406-011", "P-006", "บ.ไทยเฮิร์บ",        "L-24A-011", 550,  "FG",        "2026-06", 6),
    mkJob("JOB-2406-012", "P-004", "ร้านยา 24 ชม.",      "L-24A-012", 250,  "QC",        "2026-06", 4),
  ],
};

/* สร้าง job 1 ใบ พร้อม stage timeline ตาม progress (stageDone = จำนวน stage ที่เสร็จแล้ว) */
function mkJob(jobNo, productId, customer, lot, batchKg, status, planMonth, stageDone) {
  const flow = ["เตรียมยา", "ผสม", "ตอก/แคปซูล", "บรรจุ", "QC", "QA", "FG"];
  const totalKg = batchKg;
  const stages = flow.map((name, i) => {
    let st = "pending";
    if (i < stageDone) st = "done";
    else if (i === stageDone && status !== "รอแจ้งผลิต") st = "active";
    // ปริมาณ in/out จำลอง (กิโล) — ขั้นที่เสร็จทำครบ, ขั้น active ทำได้ครึ่ง
    const qtyIn  = st === "pending" ? 0 : totalKg;
    const qtyOut = st === "done" ? Math.round(totalKg * 0.98)
                 : st === "active" ? Math.round(totalKg * 0.5)
                 : 0;
    return {
      name,
      status: st,
      machine: pickMachine(name),
      qtyIn,
      qtyOut,
      people: st === "pending" ? 0 : (name === "บรรจุ" ? 8 : 3),
      hours: st === "pending" ? 0 : (st === "active" ? 4 : 8),
      note: "",
    };
  });
  const progressPct = Math.round((stageDone / flow.length) * 100);
  return { jobNo, productId, customer, lot, batchKg, status, planMonth, stages, progressPct };
}

function pickMachine(stage) {
  const map = {
    "ผสม": "เครื่องผสม #1",
    "ตอก/แคปซูล": "เครื่องตอก #1",
    "บรรจุ": "เครื่อง Blister #1",
  };
  return map[stage] || "-";
}
