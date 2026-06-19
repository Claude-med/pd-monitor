/* ============================================================
   app.js — helper ร่วม: โหลด/บันทึก mock data, สร้าง layout, format
   ============================================================ */

const STORE_KEY = "pd_monitor_demo_v2";   // bump เมื่อ data shape เปลี่ยน (เพิ่ม flag/วันที่) → reseed
const LOG_KEY = "pd_monitor_activity_v1"; // activity log (จำลอง audit trail)

/* ---------- จัดการข้อมูล (localStorage ให้รู้สึกเหมือนบันทึกจริง) ---------- */
function loadData() {
  let raw = localStorage.getItem(STORE_KEY);
  if (!raw) {
    const seed = { products: SEED.products, machines: SEED.machines, jobs: SEED.jobs };
    localStorage.setItem(STORE_KEY, JSON.stringify(seed));
    return seed;
  }
  try { return JSON.parse(raw); }
  catch (e) {
    const seed = { products: SEED.products, machines: SEED.machines, jobs: SEED.jobs };
    localStorage.setItem(STORE_KEY, JSON.stringify(seed));
    return seed;
  }
}
function saveData(data) { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
function resetData() { localStorage.removeItem(STORE_KEY); location.reload(); }

/* ---------- helper ---------- */
const DB = loadData();
function product(id) { return DB.products.find(p => p.id === id) || {}; }
function job(no) { return DB.jobs.find(j => j.jobNo === no); }
function statusMeta(key) { return SEED.statuses.find(s => s.key === key) || { color: "#94a3b8" }; }
function flagMeta(key) { return (SEED.flags || []).find(f => f.key === key) || { color: "#16a34a", icon: "🟢" }; }
function fmt(n) { return (n || 0).toLocaleString("th-TH"); }
function qs(k) { return new URLSearchParams(location.search).get(k); }

/* ---------- Activity log (จำลอง audit trail — ทีมข้อ 5) ---------- */
function loadLog() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY)) || null; } catch (e) { return null; }
}
function logActivity(action, jobNo, who) {
  const log = loadLog() || [];
  log.push({ ts: new Date().toISOString(), who: who || window.__role || "ผู้ใช้", action, jobNo: jobNo || "" });
  localStorage.setItem(LOG_KEY, JSON.stringify(log));
}
function getActivities(jobNo) {
  let log = loadLog();
  if (!log) {   // seed ตัวอย่างครั้งแรก ให้ demo มีประวัติให้ดู
    log = [
      { ts: "2026-06-12T08:10:00", who: "ฝ่ายวางแผน", action: "สร้าง Job และลงแผนผลิต", jobNo: "JOB-2406-001" },
      { ts: "2026-06-12T09:30:00", who: "ฝ่ายผลิต",   action: "เริ่มขั้นผสม · บันทึก in 1000 กก.", jobNo: "JOB-2406-001" },
      { ts: "2026-06-13T14:05:00", who: "ฝ่ายผลิต",   action: "บันทึกขั้นตอก · ออก 980 กก.", jobNo: "JOB-2406-001" },
    ];
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  }
  return jobNo ? log.filter(l => l.jobNo === jobNo) : log;
}
function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/* ---------- Validation helpers (ทีมข้อ 9 / rec C2) ---------- */
function numOrNull(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
/* ตรวจฟอร์มบันทึกผลิต → คืน array ข้อความ error (ว่าง = ผ่าน) */
function validateRecord({ qtyIn, qtyOut, people, hours }) {
  const errs = [];
  const vals = { "จำนวนเข้า": qtyIn, "จำนวนออก": qtyOut, "จำนวนคน": people, "เวลา": hours };
  for (const [label, v] of Object.entries(vals)) {
    if (v === null) { errs.push(`กรุณากรอก"${label}"ให้ถูกต้อง`); continue; }
    if (v < 0) errs.push(`"${label}" ต้องไม่ติดลบ`);
  }
  if (qtyIn !== null && qtyOut !== null && qtyOut > qtyIn)
    errs.push("จำนวนออกมากกว่าจำนวนเข้าไม่ได้ (output ≤ input)");
  return errs;
}

/* ---------- เมนู ---------- */
const NAV = [
  { href: "index.html",     ic: "🏠", label: "ภาพรวมโปรเจค" },
  { href: "board.html",     ic: "📋", label: "Pending Order Board" },
  { href: "record.html",    ic: "✏️", label: "บันทึกการผลิต" },
  { href: "daily.html",     ic: "📅", label: "Daily Report" },
  { href: "dashboard.html", ic: "📊", label: "Dashboard / KPI" },
];

/* สร้าง layout (sidebar + topbar) — เรียกจากแต่ละหน้า
   opts = { active, title, sub, role } */
function renderLayout(opts, contentHTML) {
  window.__role = opts.role || "ฝ่ายผลิต";   // ใช้เป็น "ใคร" ใน activity log
  const navLinks = NAV.map(n =>
    `<a href="${n.href}" onclick="closeSidebar()" class="${n.href === opts.active ? "active" : ""}">
       <span class="ic">${n.ic}</span> ${n.label}
     </a>`).join("");

  document.body.innerHTML = `
    <div class="backdrop" id="backdrop" onclick="toggleSidebar()"></div>
    <div class="layout">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <span class="logo">💊</span>
          <span>PD Monitor<small>ระบบติดตามการผลิตยา</small></span>
        </div>
        <nav>${navLinks}</nav>
        <div class="foot">
          DEMO · ข้อมูลตัวอย่าง<br>
          <a href="#" onclick="resetData();return false;" style="color:#64748b;text-decoration:underline;">รีเซ็ตข้อมูล demo</a>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="menu-btn" onclick="toggleSidebar()">☰</button>
          <div>
            <h1>${opts.title}</h1>
            ${opts.sub ? `<div class="sub">${opts.sub}</div>` : ""}
          </div>
          <div class="spacer"></div>
          <div class="role">👤 ${opts.role || "ฝ่ายผลิต"}</div>
        </header>
        <div class="content">${contentHTML}</div>
      </div>
    </div>
    <div id="toast"></div>
  `;
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("backdrop").classList.toggle("show");
}
function closeSidebar() {   // ปิดเมนูอัตโนมัติเมื่อเลือกหน้า (มือถือ — ทีมข้อ 10)
  const sb = document.getElementById("sidebar");
  const bd = document.getElementById("backdrop");
  if (sb) sb.classList.remove("open");
  if (bd) bd.classList.remove("show");
}

function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(() => t.classList.remove("show"), 2600);
}

function badge(statusKey) {
  const m = statusMeta(statusKey);
  return `<span class="badge" style="background:${m.color}">${statusKey}</span>`;
}

/* ป้ายปัญหา (flag) — แสดงเฉพาะที่ไม่ใช่ "ปกติ" ให้เด่น (ทีมข้อ 3,8) */
function flagBadge(flagKey) {
  if (!flagKey || flagKey === "ปกติ") return "";
  const f = flagMeta(flagKey);
  return `<span class="flag-badge" style="background:${f.color}">${f.icon} ${flagKey}</span>`;
}
