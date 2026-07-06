// ====== THANH ĐẦU TRANG DÙNG CHUNG (desktop) ======
import { isAdmin, isGuest, isLoggedIn, nickname, onAuthChange } from "./auth.js";
import { toggleTheme, themeIcon } from "./utils.js";

// 10 ngôn ngữ chào hỏi — random mỗi ngày / mỗi phiên đăng nhập
const GREETINGS = [
  "Xin chào", "Hello", "こんにちは", "안녕하세요", "你好",
  "Bonjour", "Hola", "Hallo", "Ciao", "สวัสดี"
];

function pickGreeting() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const saved = JSON.parse(sessionStorage.getItem("tbGreet") || "null");
    if (saved && saved.date === today) return GREETINGS[saved.idx] || GREETINGS[0];
    const idx = Math.floor(Math.random() * GREETINGS.length);
    sessionStorage.setItem("tbGreet", JSON.stringify({ date: today, idx }));
    return GREETINGS[idx];
  } catch (e) { return GREETINGS[0]; }
}

export function initTopbar(active) {
  const host = document.getElementById("topbar");
  if (!host) return;
  host.className = "topbar";

  const isFriday = new Date().getDay() === 5;
  const warnHTML = `<i class="ti ti-alert-triangle tb-warn" title="Thứ 6 — nhớ Backup dữ liệu!"></i>`;

  const navBtn = (key, html) => {
    const cls = "btn btn-sm tb-nav-btn" + (active === key ? " tb-active" : "");
    return html.replace("__CLS__", cls);
  };

  host.innerHTML = `
  <div class="tb-nav">
    ${active === "index"
      ? navBtn("index", `<button class="__CLS__" id="btn-nav-list" style="display:none"><i class="ti ti-package"></i> Lô hàng</button>`)
      : navBtn("index", `<a href="index.html" class="__CLS__" id="btn-nav-list" style="display:none"><i class="ti ti-package"></i> Lô hàng</a>`)}
    ${navBtn("customers", `<a href="customers.html" class="__CLS__" id="nav-customers" style="display:none"><i class="ti ti-users"></i> Khách hàng</a>`)}
    ${navBtn("lc", `<a href="lc.html" class="__CLS__" id="nav-lc" style="display:none"><i class="ti ti-credit-card"></i> LC</a>`)}
    ${navBtn("forwarders", `<a href="forwarders.html" class="__CLS__" id="nav-forwarders" style="display:none"><i class="ti ti-truck-delivery"></i> Forwarder</a>`)}
    ${navBtn("reports", `<button class="__CLS__" id="btn-reports" style="display:none"><i class="ti ti-report"></i> Báo cáo</button>`)}
  </div>

  <div class="tb-center">
    ${active === "index"
      ? `<span id="btn-home" style="cursor:pointer;line-height:0;display:inline-block" title="Về trang chủ (Lịch)">__SVG__</span>`
      : `<a href="index.html" style="line-height:0;display:inline-block" title="Về trang chủ">__SVG__</a>`}
  </div>

  <div class="tb-right">
    <span id="user-greeting" style="display:none;font-size:13px;color:var(--text-muted);margin:0 4px"></span>
    <div id="admin-indicator" style="display:none;position:relative">
      <button class="btn btn-sm" id="btn-admin-menu"><i class="ti ti-shield-check"></i> Admin ${isFriday ? warnHTML : ""}<i class="ti ti-chevron-down" style="font-size:12px"></i></button>
      <div class="tb-menu" id="admin-menu">
        <a href="users.html" class="tb-menu-item" id="nav-users"><i class="ti ti-user-cog"></i> Tài khoản</a>
        <button type="button" class="tb-menu-item" id="btn-backup"><i class="ti ti-database-export"></i> Backup dữ liệu ${isFriday ? warnHTML : ""}</button>
      </div>
    </div>
    <button class="btn btn-sm" id="btn-theme" title="Đổi giao diện sáng/tối"><i class="ti ti-moon" id="theme-icon"></i></button>
    <button class="btn btn-sm" id="btn-login-toggle"><i class="ti ti-lock"></i> <span id="login-label">Đăng nhập</span></button>
  </div>`;

  // Chèn banner TOS (giữ nguyên kích thước 280x52)
  const svg = `<svg width="280" height="52" viewBox="0 0 280 52">
    <defs><linearGradient id="tosgradTB" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#155A2C"/><stop offset="100%" stop-color="#2E9E54"/>
    </linearGradient></defs>
    <rect x="0" y="2" width="280" height="48" rx="8" fill="url(#tosgradTB)"/>
    <text x="140" y="28" font-family="'Trebuchet MS', Arial, sans-serif" font-size="26" font-weight="bold" fill="#FFFFFF" text-anchor="middle" letter-spacing="2">TOSGAMEX</text>
    <text x="140" y="43" font-family="Arial, sans-serif" font-size="8" fill="#D4EDDA" text-anchor="middle" letter-spacing="1.5">TOMIYA SUMMIT GARMENT EXPORT</text>
  </svg>`;
  host.innerHTML = host.innerHTML.replace(/__SVG__/g, svg);

  // Nút đổi sáng/tối
  themeIcon(document.getElementById("theme-icon"));
  document.getElementById("btn-theme").addEventListener("click", () => {
    toggleTheme();
    themeIcon(document.getElementById("theme-icon"));
  });

  // Menu Admin xổ xuống
  const menuBtn = document.getElementById("btn-admin-menu");
  const menu = document.getElementById("admin-menu");
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#admin-indicator")) menu.classList.remove("open");
  });

  // Báo cáo / Backup ở trang khác index -> chuyển về index và tự chạy
  if (active !== "index") {
    document.getElementById("btn-reports").addEventListener("click", () => {
      location.href = "index.html#reports";
    });
    document.getElementById("btn-backup").addEventListener("click", () => {
      location.href = "index.html#backup";
    });
  }

  // Hiện/ẩn theo trạng thái đăng nhập + lời chào đa ngôn ngữ
  onAuthChange(() => {
    const on = isLoggedIn();
    ["btn-nav-list", "nav-customers", "nav-lc", "nav-forwarders", "btn-reports"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = on ? "" : "none";
    });
    // Khách: ẩn Báo cáo
    if (on && isGuest()) {
      const rp = document.getElementById("btn-reports");
      if (rp) rp.style.display = "none";
    }
    document.getElementById("admin-indicator").style.display = (on && isAdmin()) ? "flex" : "none";
    const g = document.getElementById("user-greeting");
    if (on) {
      g.style.display = "";
      g.textContent = `${pickGreeting()} ${nickname() || ""}!`;
    } else {
      g.style.display = "none";
    }
    const lbl = document.getElementById("login-label");
    if (lbl) lbl.textContent = on ? "Đăng xuất" : "Đăng nhập";
  });
}
