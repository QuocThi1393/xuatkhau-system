// ====== GIAO DIỆN ĐIỆN THOẠI ======
import { db } from "./firebase-config.js";
import { isAdmin, isGuest, isLoggedIn, loginUser, logout, onAuthChange, canEditAnyCol } from "./auth.js";
import { showToast, formatDate, fullPort, getProgress, CHECKLIST_STEPS, openModal, closeModal, normName, toggleTheme, themeIcon } from "./utils.js";
import {
  collection, onSnapshot, doc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

window.closeModalById = closeModal;

let allShipments = [];
window.__getAllShipments = () => allShipments;  // cho exports.js dùng chung

let curMonth = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`; })();
let curShipId = null; // đang xem chi tiết lô nào (null = trang chủ)

// ====== ĐĂNG NHẬP ======
function show(id, on) { document.getElementById(id).style.display = on ? "" : "none"; }

onAuthChange(u => {
  if (u) {
    show("m-login", false);
    show("m-topbar", true);
    show("m-home", true);
    document.getElementById("m-btn-desktop").style.display = isAdmin() ? "" : "none";
    subscribe();
  } else {
    show("m-login", true);
    show("m-topbar", false);
    show("m-home", false);
    show("m-detail", false);
  }
});

document.getElementById("ml-btn").addEventListener("click", doLogin);
document.getElementById("ml-pass").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
async function doLogin() {
  const email = document.getElementById("ml-email").value.trim();
  const pass = document.getElementById("ml-pass").value;
  const err = document.getElementById("ml-err");
  err.textContent = "";
  try { await loginUser(email, pass); }
  catch (e) { err.textContent = "Sai email hoặc mật khẩu. Thử lại nhé."; }
}

document.getElementById("m-btn-logout").addEventListener("click", async () => {
  if (confirm("Đăng xuất?")) await logout();
});

// Nút đổi giao diện sáng/tối
themeIcon(document.getElementById("m-btn-theme"));
document.getElementById("m-btn-theme").addEventListener("click", () => {
  toggleTheme();
  themeIcon(document.getElementById("m-btn-theme"));
});

// Nút gạt Desktop (admin, chỉ trong phiên này)
document.getElementById("m-btn-desktop").addEventListener("click", () => {
  sessionStorage.setItem("forceDesktop", "1");
  location.href = "index.html";
});

// ====== DỮ LIỆU ======
let unsub = null;
function subscribe() {
  if (unsub) return;
  unsub = onSnapshot(collection(db, "shipments"), snap => {
    allShipments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  });
}

function shipmentsOfMonth(month) {
  return allShipments.filter(s => {
    if (s.period) return s.period === month;
    if (s.stuffingDate) return s.stuffingDate.slice(0,7) === month;
    return false;
  });
}

function custLabel(s) {
  const names = [...new Set((s.orders||[]).map(o=>o.customer).filter(Boolean))];
  return names.length ? names.join(" / ") : "—";
}

function totalOf(s, field) { return (s.orders||[]).reduce((a,o)=>a+(parseFloat(o[field])||0),0); }

function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// ====== RENDER ======
function render() {
  if (curShipId) renderDetail(curShipId);
  else renderHome();
}

function renderHome() {
  show("m-detail", false);
  show("m-home", true);
  document.getElementById("m-title").textContent = "TOSGAMEX";

  // Cảnh báo cắt máng hôm nay / ngày mai — CHỈ khi bước 8 "Tờ khai Hải quan" chưa xong
  const today = localISO(new Date());
  const tmr = (() => { const d = new Date(); d.setDate(d.getDate()+1); return localISO(d); })();
  const warns = [];
  allShipments.forEach(s => {
    if (!s.cyCut) return;
    const ck8 = (s.checklist||{})[8];
    if (ck8 === "done" || ck8 === "skip") return; // đã xong tờ khai -> không cảnh báo
    if (s.cyCut === today) warns.push({ cls:"today", icon:"alert-triangle", pre:"Hôm nay", s });
    else if (s.cyCut === tmr) warns.push({ cls:"tomorrow", icon:"clock", pre:"Ngày mai", s });
  });
  document.getElementById("m-warnings").innerHTML = warns.map(w =>
    `<div class="m-warn ${w.cls}" onclick="mOpenDetail('${w.s.id}')">
      <i class="ti ti-${w.icon}" style="font-size:14px"></i>
      <span><b>${w.pre}:</b> ${custLabel(w.s)} — ${fullPort(w.s.port)}${w.s.invoiceNo?` · ${w.s.invoiceNo}`:""} · chưa tờ khai</span>
    </div>`).join("");

  // Nhãn tháng
  const [y, mo] = curMonth.split("-");
  document.getElementById("m-month-label").textContent = `Tháng ${mo}/${y}`;

  // Danh sách lô
  const kw = normName(document.getElementById("m-search").value);
  let list = shipmentsOfMonth(curMonth);
  if (kw) {
    list = list.filter(s =>
      normName(custLabel(s)).includes(kw) || normName(s.invoiceNo||"").includes(kw)
    );
  }
  list = [...list].sort((a,b) => (a.stuffingDate||"9999").localeCompare(b.stuffingDate||"9999"));

  // Tách: lô 100% -> dòng gọn xếp trên đầu; lô đang xử lý -> thẻ đầy đủ
  const doneList = list.filter(s => getProgress(s.checklist).pct >= 100);
  const workList = list.filter(s => getProgress(s.checklist).pct < 100);

  const doneHTML = doneList.map(s =>
    `<div class="m-done-row" onclick="mOpenDetail('${s.id}')">
      <b>${custLabel(s)} — ${fullPort(s.port)}</b>
      <span class="m-done-pct">100% <i class="ti ti-circle-check" style="font-size:14px"></i></span>
    </div>`).join("");

  const workHTML = workList.map(s => {
    const { pct } = getProgress(s.checklist);
    return `<div class="m-card" onclick="mOpenDetail('${s.id}')">
      <div class="m-card-head">
        <b>${custLabel(s)} — ${fullPort(s.port)}</b>
        <span class="m-pct">${pct}%</span>
      </div>
      <div class="m-sub">INV ${s.invoiceNo||"—"} · ${s.container||"—"}</div>
      <div class="m-bar"><div class="m-bar-fill" style="width:${pct}%"></div></div>
      <div class="m-dates">
        <span><i class="ti ti-home"></i> ${formatDate(s.stuffingDate)}</span>
        <span><i class="ti ti-scissors"></i> ${formatDate(s.cyCut)}</span>
        <span><i class="ti ti-ship"></i> ${formatDate(s.etd)}</span>
        <span><i class="ti ti-anchor"></i> ${formatDate(s.eta)}</span>
      </div>
    </div>`;
  }).join("");

  const gap = doneList.length && workList.length ? `<div style="height:6px"></div>` : "";
  document.getElementById("m-list").innerHTML = (doneHTML + gap + workHTML) ||
    `<div style="text-align:center;color:var(--text-muted);padding:30px 0;font-size:13px">Không có lô hàng trong tháng này</div>`;
}

window.mOpenDetail = function(id) {
  curShipId = id;
  renderDetail(id);
  window.scrollTo(0, 0);
};

window.mBack = function() {
  curShipId = null;
  renderHome();
};

function renderDetail(id) {
  const s = allShipments.find(x => x.id === id);
  if (!s) { curShipId = null; renderHome(); return; }
  show("m-home", false);
  show("m-detail", true);
  document.getElementById("m-title").textContent = "TOSGAMEX";

  const { done, total, pct } = getProgress(s.checklist);
  const nextStep = CHECKLIST_STEPS.find(st => {
    const v = (s.checklist||{})[st.id];
    return v !== "done" && v !== "skip";
  });

  const conts = (s.containers && s.containers.length) ? s.containers
              : (s.contNo||s.sealNo) ? [{type:"",no:s.contNo,seal:s.sealNo}] : [];
  const contLines = conts.length
    ? conts.map(c => `${c.type||s.container||""} · ${c.no||"—"} / ${c.seal||"—"}`).join("<br>")
    : (s.container||"—");

  const orders = s.orders || [];
  const canEdit = isAdmin();
  const isFcl = !((s.container||"").toUpperCase().match(/AIR|CPN|KNQ/));

  const orderRowsHTML = orders.map(o =>
    `<div class="m-order-row"><span>${o.customer||""} · ${o.index||o.items||""}</span><span>${Math.round(parseFloat(o.qty)||0).toLocaleString()} PCS</span></div>`
  ).join("");

  document.getElementById("m-detail").innerHTML = `
    <div class="m-back" onclick="mBack()" style="margin-bottom:10px">
      <i class="ti ti-arrow-left" style="font-size:18px"></i>
      <b style="font-size:15px">${custLabel(s)} — ${fullPort(s.port)}</b>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:10px">
      <span>INV ${s.invoiceNo||"—"}</span><span>${s.booking?`Booking: ${s.booking}`:""}</span>
    </div>

    <div class="m-box">
      <div class="m-timeline">
        <div><i class="ti ti-home"></i><br>${formatDate(s.stuffingDate)}<br>Đóng hàng</div>
        <div style="color:#A32D2D"><i class="ti ti-scissors"></i><br><b>${formatDate(s.cyCut)}</b>${s.cyCutTime?` ${s.cyCutTime}`:""}<br>Cắt máng</div>
        <div><i class="ti ti-ship"></i><br>${formatDate(s.etd)}<br>ETD</div>
        <div><i class="ti ti-anchor"></i><br>${formatDate(s.eta)}<br>Arrival</div>
      </div>
    </div>

    <div class="m-box">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <b style="font-size:13.5px"><i class="ti ti-ship"></i> ${s.vessel||"Chưa có tàu"}</b>
        ${canEdit ? `<button class="btn btn-sm" onclick="mEditVessel('${s.id}')"><i class="ti ti-edit"></i> Sửa</button>` : ""}
      </div>
      <div style="font-size:12.5px;margin-top:6px;color:var(--text)">${contLines}</div>
    </div>

    <div class="m-box">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
        <b style="font-size:13.5px">Tiến trình</b>
        <span style="font-size:12px;color:#0C447C"><b>${done}/${total} bước</b></span>
      </div>
      <div class="m-prog">${CHECKLIST_STEPS.map(st => {
        const v = (s.checklist||{})[st.id];
        return `<span class="${v==="done"||v==="skip"?"done":""}"></span>`;
      }).join("")}</div>
      ${nextStep ? `<div style="font-size:11.5px;color:var(--text-muted);margin-top:5px">Bước tiếp: ${nextStep.label}</div>` : `<div style="font-size:11.5px;color:#27500A;margin-top:5px">Hoàn tất!</div>`}
    </div>

    <div class="m-box">
      <b style="font-size:13.5px">${orders.length} đơn hàng</b>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text);margin-top:6px;flex-wrap:wrap;gap:4px">
        <span>${Math.round(totalOf(s,"qty")).toLocaleString()} PCS</span>
        <span>${Math.round(totalOf(s,"ctns")).toLocaleString()} CTNs</span>
        <span>${Math.round(totalOf(s,"kgTotal")).toLocaleString()} Kg</span>
        <span>${(Math.round(totalOf(s,"cbm")*100)/100).toLocaleString()} CBM</span>
      </div>
      <div id="m-order-detail" style="display:none;margin-top:6px">${orderRowsHTML}</div>
      <div style="font-size:12px;color:#0C447C;margin-top:6px;cursor:pointer" onclick="mToggleOrders(this)">Xem chi tiết từng dòng <i class="ti ti-chevron-down"></i></div>
    </div>

    ${canEdit ? `<div class="m-actions">
      <button class="btn" onclick="mEditVessel('${s.id}')"><i class="ti ti-ship"></i> Sửa tàu/ngày</button>
      <button class="btn" onclick="mEditCont('${s.id}')"><i class="ti ti-box"></i> Cont / Seal</button>
      <button class="btn" onclick="mEditShipMark('${s.id}')"><i class="ti ti-tag"></i> Shipping Mark</button>
      <button class="btn" onclick="mEditChecklist('${s.id}')"><i class="ti ti-checklist"></i> Tick tiến trình</button>
    </div>` : ""}

    ${isGuest() ? "" : `<div class="m-export">
      <b style="color:var(--blue-text);font-size:13.5px"><i class="ti ti-file-export"></i> Xuất chứng từ (PDF)</b>
      <div class="m-export-grid">
        <button class="btn" onclick="openPackingList('${s.id}')">Packing List</button>
        ${isFcl ? `<button class="btn" onclick="openVGM('${s.id}')">VGM</button>` : ""}
        <button class="btn" onclick="openSI('${s.id}')">SI (Draft B/L)</button>
        <button class="btn" onclick="mExportCO(event,'${s.id}')">Draft CO</button>
      </div>
      <div style="font-size:10.5px;color:var(--blue-text);margin-top:6px">Bấm In → chọn "Lưu PDF" → share qua Zalo/Line</div>
    </div>`}`;
}

window.mToggleOrders = function(el) {
  const box = document.getElementById("m-order-detail");
  const open = box.style.display !== "none";
  box.style.display = open ? "none" : "";
  el.innerHTML = open ? `Xem chi tiết từng dòng <i class="ti ti-chevron-down"></i>` : `Thu gọn <i class="ti ti-chevron-up"></i>`;
};

window.mExportCO = function(ev, shipId) {
  // Dùng lại menu nổi RCEP/AJ/D/E từ exports.js
  window.toggleCoMenu(ev, shipId);
};

// ====== SỬA NHANH ======
function esc(v) { return (v||"").replace(/"/g, "&quot;"); }

window.mEditVessel = function(shipId) {
  const s = allShipments.find(x=>x.id===shipId);
  if (!s || !isAdmin()) return;
  document.getElementById("m-edit-title").textContent = "Sửa tàu / ngày";
  document.getElementById("m-edit-body").innerHTML = `
    <div class="form-group"><label class="form-label">Tên tàu / Hãng bay</label><input class="form-input" id="me-vessel" value="${esc(s.vessel)}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Ngày đóng hàng</label><input type="date" class="form-input" id="me-stuffing" value="${s.stuffingDate||""}"></div>
      <div class="form-group"><label class="form-label">Cắt máng</label><input type="date" class="form-input" id="me-cycut" value="${s.cyCut||""}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">ETD</label><input type="date" class="form-input" id="me-etd" value="${s.etd||""}"></div>
      <div class="form-group"><label class="form-label">ETA</label><input type="date" class="form-input" id="me-eta" value="${s.eta||""}"></div>
    </div>
    <div class="form-group"><label class="form-label">Số Booking</label><input class="form-input" id="me-booking" value="${esc(s.booking)}"></div>
    <div class="form-footer">
      <button type="button" class="btn" onclick="closeModalById('modal-m-edit')">Hủy</button>
      <button type="button" class="btn btn-primary" onclick="mSaveVessel('${shipId}')"><i class="ti ti-device-floppy"></i> Lưu</button>
    </div>`;
  openModal("modal-m-edit");
};

window.mSaveVessel = async function(shipId) {
  await updateDoc(doc(db,"shipments",shipId), {
    vessel: document.getElementById("me-vessel").value.trim(),
    stuffingDate: document.getElementById("me-stuffing").value || null,
    cyCut: document.getElementById("me-cycut").value || null,
    etd: document.getElementById("me-etd").value || null,
    eta: document.getElementById("me-eta").value || null,
    booking: document.getElementById("me-booking").value.trim(),
  });
  closeModal("modal-m-edit");
  showToast("Đã lưu!");
};

window.mEditCont = function(shipId) {
  const s = allShipments.find(x=>x.id===shipId);
  if (!s || !isAdmin()) return;
  const conts = (s.containers && s.containers.length) ? s.containers
              : (s.contNo||s.sealNo) ? [{type:"",no:s.contNo,seal:s.sealNo}] : [{type:"",no:"",seal:""}];
  document.getElementById("m-edit-title").textContent = "Container / Seal";
  document.getElementById("m-edit-body").innerHTML = `
    <div class="m-sheet-label">Loại · Số cont · Số seal</div>
    <div id="me-cont-list">${conts.map(c => `
      <div class="m-cont-row">
        <input class="form-input" placeholder="40HC" value="${esc(c.type)}">
        <input class="form-input" placeholder="Số cont" value="${esc(c.no)}">
        <input class="form-input" placeholder="Số seal" value="${esc(c.seal)}">
      </div>`).join("")}</div>
    <button type="button" class="btn btn-sm" onclick="mAddContRow()"><i class="ti ti-plus"></i> Thêm container</button>
    <div class="form-footer">
      <button type="button" class="btn" onclick="closeModalById('modal-m-edit')">Hủy</button>
      <button type="button" class="btn btn-primary" onclick="mSaveCont('${shipId}')"><i class="ti ti-device-floppy"></i> Lưu</button>
    </div>`;
  openModal("modal-m-edit");
};

window.mAddContRow = function() {
  const div = document.createElement("div");
  div.className = "m-cont-row";
  div.innerHTML = `<input class="form-input" placeholder="40HC"><input class="form-input" placeholder="Số cont"><input class="form-input" placeholder="Số seal">`;
  document.getElementById("me-cont-list").appendChild(div);
};

window.mSaveCont = async function(shipId) {
  const s = allShipments.find(x=>x.id===shipId);
  if (!s) return;
  const rows = [...document.querySelectorAll("#me-cont-list .m-cont-row")];
  const oldConts = (s.containers && s.containers.length) ? s.containers : [];
  const containers = rows.map((r, i) => {
    const [type, no, seal] = [...r.querySelectorAll("input")].map(x=>x.value.trim());
    // Giữ lại tare/gw cũ nếu có (mobile không sửa 2 trường này)
    const old = oldConts[i] || {};
    return { type, no, seal, tare: old.tare||"", gw: old.gw||"" };
  }).filter(c => c.type || c.no || c.seal);
  await updateDoc(doc(db,"shipments",shipId), { containers });
  closeModal("modal-m-edit");
  showToast("Đã lưu container!");
};

window.mEditShipMark = function(shipId) {
  const s = allShipments.find(x=>x.id===shipId);
  if (!s || !isAdmin()) return;
  const safe = (s.shipMark||"").replace(/&/g,"&amp;").replace(/</g,"&lt;");
  document.getElementById("m-edit-title").textContent = "Shipping Mark";
  document.getElementById("m-edit-body").innerHTML = `
    <textarea id="me-shipmark" spellcheck="false" style="width:100%;min-height:200px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;white-space:pre;padding:10px 12px;border:0.5px solid var(--border-md);border-radius:var(--radius-md);background:var(--bg-card)">${safe}</textarea>
    <div class="form-footer" style="justify-content:space-between">
      <button type="button" class="btn" onclick="mCopyShipMark()"><i class="ti ti-copy"></i> Copy</button>
      <div style="display:flex;gap:8px">
        <button type="button" class="btn" onclick="closeModalById('modal-m-edit')">Đóng</button>
        <button type="button" class="btn btn-primary" onclick="mSaveShipMark('${shipId}')"><i class="ti ti-device-floppy"></i> Lưu</button>
      </div>
    </div>`;
  openModal("modal-m-edit");
};

window.mCopyShipMark = function() {
  const ta = document.getElementById("me-shipmark");
  ta.select(); ta.setSelectionRange(0, ta.value.length);
  try { document.execCommand("copy"); } catch(e){}
  if (navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(()=>{});
  showToast("Đã copy shipping mark!");
};

window.mSaveShipMark = async function(shipId) {
  await updateDoc(doc(db,"shipments",shipId), { shipMark: document.getElementById("me-shipmark").value });
  closeModal("modal-m-edit");
  showToast("Đã lưu shipping mark!");
};

window.mEditChecklist = function(shipId) {
  const s = allShipments.find(x=>x.id===shipId);
  if (!s || !isAdmin()) return;
  document.getElementById("m-edit-title").textContent = "Tick tiến trình";
  document.getElementById("m-edit-body").innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Bấm để đổi: chưa làm → xong → chưa làm</div>
    <div id="me-ck-list">${renderCkList(s)}</div>
    <div class="form-footer">
      <button type="button" class="btn btn-primary" onclick="closeModalById('modal-m-edit')">Xong</button>
    </div>`;
  openModal("modal-m-edit");
};

function renderCkList(s) {
  return CHECKLIST_STEPS.map(st => {
    const v = (s.checklist||{})[st.id] || "pending";
    const cls = v==="done"?"done":v==="skip"?"skip":"";
    const dot = v==="done"?"✓":v==="skip"?"—":st.short;
    return `<div class="m-ck-item ${cls}" onclick="mCkToggle('${s.id}',${st.id},'${v}',${st.skippable})">
      <span class="m-ck-dot">${dot}</span><span>${st.label}</span>
    </div>`;
  }).join("");
}

window.mCkToggle = async function(shipId, stepId, state, skippable) {
  let next;
  if (state==="pending") next="done";
  else if (state==="done" && skippable) next="skip";
  else next="pending";
  const s = allShipments.find(x=>x.id===shipId);
  await updateDoc(doc(db,"shipments",shipId), { checklist: {...(s.checklist||{}), [stepId]: next} });
  // Cập nhật lại danh sách trong modal sau khi snapshot về
  setTimeout(() => {
    const s2 = allShipments.find(x=>x.id===shipId);
    const el = document.getElementById("me-ck-list");
    if (el && s2) el.innerHTML = renderCkList(s2);
  }, 400);
};

// ====== SỰ KIỆN TRANG CHỦ ======
document.getElementById("m-prev").addEventListener("click", () => { curMonth = shiftMonth(curMonth, -1); renderHome(); });
document.getElementById("m-next").addEventListener("click", () => { curMonth = shiftMonth(curMonth, 1); renderHome(); });
document.getElementById("m-search").addEventListener("input", () => renderHome());

function shiftMonth(m, delta) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
