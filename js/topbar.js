// ====== KHUNG GIAO DIỆN DESKTOP: TOPBAR + SIDEBAR + WHEEL NGÀY + NÚT CẢNH BÁO ======
import { isAdmin, isGuest, isLoggedIn, nickname, onAuthChange, perms } from "./auth.js";
import { toggleTheme, themeIcon } from "./utils.js";

const GREETINGS = [
  "Xin chào", "Hello", "こんにちは", "안녕하세요", "你好",
  "Bonjour", "Hola", "Hallo", "Ciao", "สวัสดี"
];
function pickGreeting() {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
}

let _active = "";
let _wheelCenter = 0;           // offset ngày so với hôm nay
let _wheelEvents = {};          // { "YYYY-MM-DD": { pack:[..], ship:[..] } }
const DOW = ["CN","T2","T3","T4","T5","T6","T7"];

function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function initTopbar(active) {
  _active = active;
  const host = document.getElementById("topbar");
  if (!host) return;
  host.className = "topbar";

  const isFriday = new Date().getDay() === 5;
  const warnHTML = `<i class="ti ti-alert-triangle tb-warn" title="Thứ 6 — nhớ Backup dữ liệu!"></i>`;

  // ---------- TOPBAR ----------
  host.innerHTML = `
  <div class="tb-wheel-wrap" id="tb-wheel-wrap" style="display:none">
    <button class="tb-wheel-arrow" id="tb-wheel-prev" aria-label="Lùi ngày"><i class="ti ti-chevron-left"></i></button>
    <div class="tb-wheel" id="tb-wheel"></div>
    <button class="tb-wheel-arrow" id="tb-wheel-next" aria-label="Tiến ngày"><i class="ti ti-chevron-right"></i></button>
  </div>

  <div class="tb-right">
    <span id="user-greeting" style="display:none;font-size:13px;color:var(--text-muted);margin:0 4px"></span>
    <button class="btn btn-sm" id="btn-to-mobile" style="display:none" title="Chuyển về bản điện thoại"><i class="ti ti-device-mobile"></i> Bản điện thoại</button>
    <div id="admin-indicator" style="display:none;position:relative">
      <button class="btn btn-sm" id="btn-admin-menu"><i class="ti ti-shield-check"></i> Admin ${isFriday ? warnHTML : ""}<i class="ti ti-chevron-down" style="font-size:12px"></i></button>
      <div class="tb-menu" id="admin-menu">
        <a href="users.html" class="tb-menu-item" id="nav-users"><i class="ti ti-user-cog"></i> Tài khoản</a>
        <button type="button" class="tb-menu-item" id="btn-backup"><i class="ti ti-database-export"></i> Backup dữ liệu ${isFriday ? warnHTML : ""}</button>
        <button type="button" class="tb-menu-item" id="btn-restore"><i class="ti ti-database-import"></i> Khôi phục từ backup</button>
      </div>
    </div>
    <button class="btn btn-sm" id="btn-theme" title="Đổi giao diện sáng/tối"><i class="ti ti-moon" id="theme-icon"></i></button>
    <button class="btn btn-sm" id="btn-login-toggle"><i class="ti ti-lock"></i> <span id="login-label">Đăng nhập</span></button>
  </div>`;

  // ---------- SIDEBAR: bọc .container sẵn có ----------
  const container = document.querySelector(".container");
  if (container) {
    const layout = document.createElement("div");
    layout.className = "layout";
    container.parentNode.insertBefore(layout, container);

    const side = document.createElement("aside");
    side.className = "sidebar";
    side.id = "tb-sidebar";
    side.style.display = "none";
    side.innerHTML = `
      ${active === "index"
        ? `<button class="s-logo" id="btn-home" title="Về trang chủ (Lịch)"><b>TOSGAMEX</b><span>Tomiya Summit Garment Export</span></button>`
        : `<a class="s-logo" href="index.html" title="Về trang chủ"><b>TOSGAMEX</b><span>Tomiya Summit Garment Export</span></a>`}
      <div class="s-nav">
        ${active === "index"
          ? `<button class="s-item s-active" id="btn-nav-list"><i class="ti ti-package"></i> Lô hàng</button>`
          : `<a class="s-item" id="btn-nav-list" href="index.html#list"><i class="ti ti-package"></i> Lô hàng</a>`}
        <a class="s-item ${active==="customers"?"s-active":""}" id="nav-customers" href="customers.html"><i class="ti ti-users"></i> Khách hàng</a>
        <a class="s-item ${active==="lc"?"s-active":""}" id="nav-lc" href="lc.html"><i class="ti ti-credit-card"></i> LC</a>
        <a class="s-item ${active==="forwarders"?"s-active":""}" id="nav-forwarders" href="forwarders.html"><i class="ti ti-truck-delivery"></i> Forwarder</a>
        <div class="s-label">TIỆN ÍCH</div>
        <button class="s-item" id="tb-side-cal"><i class="ti ti-calendar"></i> Về lịch</button>
        <button class="s-item" id="tb-side-import" style="display:none"><i class="ti ti-upload"></i> Import kế hoạch</button>
        <button class="s-item" id="btn-reports"><i class="ti ti-chart-bar"></i> Báo cáo</button>
        <button class="s-item" id="btn-stats"><i class="ti ti-chart-histogram"></i> Thống kê</button>
      </div>
      <div class="s-stats" id="tb-stats" style="display:none"></div>
      <div class="s-art" aria-hidden="true">
        <img src="sidebar-map.jpg" alt="" loading="lazy">
      </div>`;
    layout.appendChild(side);
    layout.appendChild(container);
  }

  // ---------- FAB CẢNH BÁO ----------
  const fab = document.createElement("div");
  fab.innerHTML = `
    <div class="tb-fab" id="tb-fab" style="display:none">
      <i class="ti ti-alert-triangle"></i>
      <span class="tb-fab-badge" id="tb-fab-badge">0</span>
    </div>
    <div class="tb-fab-panel" id="tb-fab-panel">
      <div class="fp-head"><i class="ti ti-alert-triangle"></i> Việc cần chú ý</div>
      <div id="tb-fab-list"></div>
    </div>`;
  document.body.appendChild(fab);
  document.getElementById("tb-fab").addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("tb-fab-panel").classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".tb-fab") && !e.target.closest(".tb-fab-panel"))
      document.getElementById("tb-fab-panel").classList.remove("open");
  });

  // ---------- Tooltip wheel ----------
  const tip = document.createElement("div");
  tip.className = "tb-wtip";
  tip.id = "tb-wtip";
  document.body.appendChild(tip);

  // ---------- SỰ KIỆN ----------
  themeIcon(document.getElementById("theme-icon"));
  document.getElementById("btn-theme").addEventListener("click", () => {
    toggleTheme();
    themeIcon(document.getElementById("theme-icon"));
  });

  const menuBtn = document.getElementById("btn-admin-menu");
  const menu = document.getElementById("admin-menu");
  menuBtn.addEventListener("click", (e) => { e.stopPropagation(); menu.classList.toggle("open"); });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#admin-indicator")) menu.classList.remove("open");
  });

  // Wheel: mũi tên + lăn chuột
  document.getElementById("tb-wheel-prev").addEventListener("click", () => { _wheelCenter--; renderWheel(); });
  document.getElementById("tb-wheel-next").addEventListener("click", () => { _wheelCenter++; renderWheel(); });
  document.getElementById("tb-wheel").addEventListener("wheel", (e) => {
    e.preventDefault();
    _wheelCenter += e.deltaY > 0 ? 1 : -1;
    renderWheel();
  }, { passive: false });

  // Sidebar tiện ích
  const sideCal = document.getElementById("tb-side-cal");
  const sideImport = document.getElementById("tb-side-import");
  if (active === "index") {
    sideCal.addEventListener("click", () => document.getElementById("btn-home")?.click());
    sideImport.addEventListener("click", () => document.getElementById("btn-import-plan")?.click());
  } else {
    sideCal.addEventListener("click", () => location.href = "index.html");
    sideImport.addEventListener("click", () => location.href = "index.html");
    document.getElementById("btn-reports").addEventListener("click", () => location.href = "index.html#reports");
    document.getElementById("btn-backup").addEventListener("click", () => location.href = "index.html#backup");
    document.getElementById("btn-restore").addEventListener("click", () => location.href = "index.html#restore");
    document.getElementById("btn-stats").addEventListener("click", () => location.href = "index.html#stats");
  }

  // Nút về mobile (chỉ hiện khi đang mở desktop trên điện thoại)
  const onPhone = /Android|iPhone/i.test(navigator.userAgent);
  const toMobileBtn = document.getElementById("btn-to-mobile");
  if (onPhone && toMobileBtn) {
    toMobileBtn.style.display = "";
    toMobileBtn.addEventListener("click", () => {
      sessionStorage.removeItem("forceDesktop");
      location.href = "mobile.html";
    });
  }

  // ---------- AUTH ----------
  onAuthChange(() => {
    const on = isLoggedIn();
    if (onPhone && on && !isAdmin()) {
      sessionStorage.removeItem("forceDesktop");
      location.replace("mobile.html");
      return;
    }
    const side = document.getElementById("tb-sidebar");
    if (side) side.style.display = on ? "" : "none";
    document.getElementById("tb-wheel-wrap").style.display = on ? "" : "none";
    if (on) renderWheel();
    // Khách: ẩn Báo cáo; Import: theo quyền addDelete
    const rp = document.getElementById("btn-reports");
    if (rp) rp.style.display = (on && !isGuest()) ? "" : "none";
    const stb = document.getElementById("btn-stats");
    if (stb) stb.style.display = (on && !isGuest()) ? "" : "none";
    const im = document.getElementById("tb-side-import");
    if (im) im.style.display = (on && perms().addDelete) ? "" : "none";
    document.getElementById("admin-indicator").style.display = (on && isAdmin()) ? "flex" : "none";
    const g = document.getElementById("user-greeting");
    if (on) { g.style.display = ""; g.textContent = `${pickGreeting()} ${nickname() || ""}!`; }
    else { g.style.display = "none"; }
    const lbl = document.getElementById("login-label");
    if (lbl) lbl.textContent = on ? "Đăng xuất" : "Đăng nhập";
    const lg = document.getElementById("btn-login-toggle");
    if (lg) lg.classList.toggle("tb-logout", on);
    if (!on) {
      const fabEl = document.getElementById("tb-fab");
      if (fabEl) fabEl.style.display = "none";
    }
  });
}

// ---------- WHEEL NGÀY ----------
function renderWheel() {
  const w = document.getElementById("tb-wheel");
  if (!w) return;
  w.innerHTML = "";
  const today = new Date();
  for (let off = -4; off <= 4; off++) {
    const d = new Date(today);
    d.setDate(d.getDate() + _wheelCenter + off);
    const iso = localISO(d);
    const ev = _wheelEvents[iso];
    const isToday = (_wheelCenter + off) === 0;
    const el = document.createElement("div");
    el.className = "wday";
    el.dataset.off = Math.abs(off);
    el.innerHTML = `
      <div class="dow">${DOW[d.getDay()]}${isToday ? " · HÔM NAY" : ""}</div>
      <div class="dd">${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}</div>
      <div class="dots">
        ${ev && ev.pack.length ? '<span class="dot dot-pack"></span>' : ""}
        ${ev && ev.ship.length ? '<span class="dot dot-ship"></span>' : ""}
      </div>`;
    el.style.cursor = "pointer";
    el.title = "Bấm để xem lịch tháng này";
    el.addEventListener("click", () => {
      hideWheelTip();
      if (window.__onWheelDayClick) window.__onWheelDayClick(iso);
      else location.href = "index.html#cal-" + iso;
    });
    el.addEventListener("mousemove", (e) => showWheelTip(e, d, ev));
    el.addEventListener("mouseleave", hideWheelTip);
    w.appendChild(el);
  }
}

function showWheelTip(e, d, ev) {
  const tip = document.getElementById("tb-wtip");
  if (!tip) return;
  const ds = `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
  let html = `<b>${ds}</b><br>`;
  if (!ev || (!ev.pack.length && !ev.ship.length)) {
    html += `<span style="opacity:0.6">Không có sự kiện</span>`;
  } else {
    ev.pack.forEach(p => html += `<span class="t-pack">● Đóng hàng:</span> ${p}<br>`);
    ev.ship.forEach(s => html += `<span class="t-ship">● Tàu chạy:</span> ${s}<br>`);
  }
  tip.innerHTML = html;
  tip.style.display = "block";
  tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 270) + "px";
  tip.style.top = (e.clientY + 16) + "px";
}
function hideWheelTip() {
  const tip = document.getElementById("tb-wtip");
  if (tip) tip.style.display = "none";
}

// main.js gọi sau khi có dữ liệu: evMap = { "YYYY-MM-DD": {pack:[..], ship:[..]} }
export function updateWheelEvents(evMap) {
  _wheelEvents = evMap || {};
  renderWheel();
}

// ---------- KHỐI TIẾN ĐỘ THÁNG (pipeline) ----------
// stats = { monthLabel, total, rows: [{label, count, last}] }
export function updateSidebarStats(stats) {
  const el = document.getElementById("tb-stats");
  if (!el) return;
  if (!stats || !stats.total) { el.style.display = "none"; return; }
  el.style.display = "";
  const rowsHTML = (stats.rows || []).map(r => {
    const pct = stats.total ? Math.round(r.count / stats.total * 100) : 0;
    const op = r.last ? 1 : (0.55 + 0.45 * (stats.total ? r.count / stats.total : 0)).toFixed(2);
    return `<div class="s-pl-row">
      <div class="s-pl-lbl"><span>${r.label}</span><b>${r.count}/${stats.total}</b></div>
      <div class="s-pl-bar"><div class="s-pl-fill${r.last ? " last" : ""}" style="width:${pct}%;opacity:${op}"></div></div>
    </div>`;
  }).join("");
  el.innerHTML = `
    <div class="s-pl-head"><b>Tiến độ tháng ${stats.monthLabel}</b><span><strong>${stats.total}</strong> lô</span></div>
    ${rowsHTML}`;
}

// ---------- FAB CẢNH BÁO ----------
// warns = [{ id, title, sub, when: "today"|"tomorrow" }], onClick(id)
export function updateFabWarnings(warns, onClick) {
  const fab = document.getElementById("tb-fab");
  const list = document.getElementById("tb-fab-list");
  if (!fab || !list) return;
  if (!warns || !warns.length) {
    fab.style.display = "none";
    document.getElementById("tb-fab-panel").classList.remove("open");
    return;
  }
  fab.style.display = "flex";
  document.getElementById("tb-fab-badge").textContent = warns.length;
  fab.classList.toggle("pulse", warns.some(w => w.when === "today"));
  const META = {
    today:    { cls:"fp-today", ic:"alert-triangle", tag:"fp-tag-today", text:"Hôm nay" },
    tomorrow: { cls:"fp-tmr",   ic:"clock",          tag:"fp-tag-tmr",   text:"Ngày mai" },
    late:     { cls:"fp-late",  ic:"package-off",    tag:"fp-tag-late",  text:"Chưa xong" },
  };
  list.innerHTML = warns.map((w, i) => {
    const m = META[w.when] || META.late;
    return `<div class="fp-item ${m.cls}" data-i="${i}">
      <i class="ti ti-${m.ic}"></i>
      <div><b>${w.title}</b><div class="fp-sub">${w.sub}</div></div>
      <span class="fp-tag ${m.tag}">${m.text}</span>
    </div>`;
  }).join("");
  list.querySelectorAll(".fp-item").forEach(el => {
    el.addEventListener("click", () => {
      document.getElementById("tb-fab-panel").classList.remove("open");
      if (onClick) onClick(warns[parseInt(el.dataset.i)].id);
    });
  });
}
