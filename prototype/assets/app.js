/* ============================================================
   app.js — helper ร่วม: โหลด/บันทึก mock data, สร้าง layout, format
   ============================================================ */

const STORE_KEY = "pd_monitor_demo_v1";

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
function fmt(n) { return (n || 0).toLocaleString("th-TH"); }
function qs(k) { return new URLSearchParams(location.search).get(k); }

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
  const navLinks = NAV.map(n =>
    `<a href="${n.href}" class="${n.href === opts.active ? "active" : ""}">
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
