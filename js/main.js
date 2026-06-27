import { db } from "./firebase-config.js";
import { isAdmin, isLoggedIn, loginUser, logout, onAuthChange, perms, canEditAnyCol, nickname, resetPassword } from "./auth.js";
import { showToast, formatDate, fullPort, getProgress, getStatus, progColor, CHECKLIST_STEPS, openModal, closeModal } from "./utils.js";
import {
  collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

window.closeModalById = closeModal;

let allShipments = [];
let importHot = null;   // Handsontable instance cho import
let editHot = null;     // Handsontable instance cho sửa
let editShipId = null;

// ====== ĐỊNH NGHĨA CỘT BẢNG EXCEL ======
const COLS = [
  { data: "stuffingDate", title: "STUFFING DATE", width: 95 },
  { data: "etd",          title: "ETD",           width: 70 },
  { data: "pod",          title: "POD",           width: 80 },
  { data: "customer",     title: "Customer",      width: 100 },
  { data: "contract",     title: "Contract",      width: 90 },
  { data: "index",        title: "Index",         width: 90 },
  { data: "items",        title: "Items",         width: 100 },
  { data: "qty",          title: "Qty (PCS)",     width: 75, type: "numeric" },
  { data: "ctns",         title: "Qty (CTNs)",    width: 75, type: "numeric" },
  { data: "kgPerCtn",     title: "Kgs/Carton",    width: 80, type: "numeric" },
  { data: "kgTotal",      title: "Qty (Kgs)",     width: 80, type: "numeric", readOnly: true },
  { data: "dimension",    title: "Dimension",     width: 95 },
  { data: "cbm",          title: "CBM",           width: 70, type: "numeric", readOnly: true },
  { data: "hsCode",       title: "HS CODE",       width: 80 },
  { data: "coForm",       title: "C/O FORM",      width: 80 },
  { data: "note",         title: "Note",          width: 120 },
];

// Cột cho bảng SỬA đơn hàng (bỏ STUFFING DATE/ETD/POD vì đã có ở thông tin lô)
const EDIT_COLS = [
  { data: "customer",     title: "Customer",      width: 110 },
  { data: "contract",     title: "Contract",      width: 95 },
  { data: "index",        title: "Index",         width: 95 },
  { data: "items",        title: "Items",         width: 105 },
  { data: "qty",          title: "Qty (PCS)",     width: 80, type: "numeric" },
  { data: "ctns",         title: "Qty (CTNs)",    width: 80, type: "numeric" },
  { data: "kgPerCtn",     title: "Kgs/Carton",    width: 85, type: "numeric" },
  { data: "kgTotal",      title: "Qty (Kgs)",     width: 85, type: "numeric", readOnly: true },
  { data: "dimension",    title: "Dimension",     width: 100 },
  { data: "tareCtn",      title: "Tare thùng",    width: 90, type: "numeric" },
  { data: "cbm",          title: "CBM",           width: 75, type: "numeric", readOnly: true },
  { data: "unitPrice",    title: "Giá GC (USD)",  width: 90, type: "numeric" },
  { data: "hsCode",       title: "HS CODE",       width: 85 },
  { data: "coForm",       title: "C/O FORM",      width: 85 },
  { data: "note",         title: "Note",          width: 130 },
];

// Tính kgTotal & cbm cho 1 dòng
function computeRow(row) {
  const ctns = parseFloat(row.ctns) || 0;
  const kgPer = parseFloat(row.kgPerCtn) || 0;
  row.kgTotal = Math.round(kgPer * ctns * 10) / 10 || "";
  // CBM từ Dimension dạng "78*55*26" (cm) → /10^6
  if (row.dimension) {
    const parts = String(row.dimension).split(/[*x×X]/).map(p => parseFloat(p.trim()));
    if (parts.length === 3 && parts.every(p => !isNaN(p))) {
      const cbmPer = parts[0]*parts[1]*parts[2] / 1000000;
      row.cbm = Math.round(cbmPer * ctns * 100) / 100 || "";
    }
  }
  return row;
}

// ====== AUTH UI ======
function updateAdminUI() {
  const on = isLoggedIn();
  const admin = isAdmin();
  const p = perms();
  document.getElementById("admin-indicator").style.display = admin ? "flex" : "none";
  document.getElementById("login-label").textContent = on ? "Đăng xuất" : "Đăng nhập";
  // Lời chào
  const g = document.getElementById("user-greeting");
  if (on) { g.style.display = ""; g.textContent = "Xin chào " + (nickname() || "") + "!"; }
  else { g.style.display = "none"; }
  // Nav cần đăng nhập
  ["btn-nav-list","nav-customers","nav-lc","nav-forwarders","btn-reports"].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = on ? "" : "none";
  });
  // Nút quản lý tài khoản: chỉ admin
  const navUsers = document.getElementById("nav-users");
  if (navUsers) navUsers.style.display = admin ? "" : "none";
  const btnBk = document.getElementById("btn-backup");
  if (btnBk) btnBk.style.display = admin ? "" : "none";
  // Thêm / Import lô: chỉ vai trò được thêm-xóa (admin)
  document.getElementById("btn-add-shipment").style.display = p.addDelete ? "flex" : "none";
  document.getElementById("btn-import-plan").style.display = p.addDelete ? "flex" : "none";
  if (!on) {
    document.getElementById("list-view").style.display = "none";
    document.getElementById("calendar-view").style.display = "";
  }
  renderList();
}

document.getElementById("btn-login-toggle").addEventListener("click", async () => {
  if (isLoggedIn()) { await logout(); showToast("Đã đăng xuất"); }
  else openModal("modal-login");
});

async function doLogin() {
  const email = document.getElementById("f-login-email").value;
  const pw = document.getElementById("f-admin-pw").value;
  const errEl = document.getElementById("login-error");
  errEl.style.display = "none";
  document.getElementById("login-info").style.display = "none";
  try {
    await loginUser(email, pw);
    closeModal("modal-login");
    document.getElementById("f-admin-pw").value = "";
    showToast("Đăng nhập thành công!");
    // onAuthChange sẽ tự cập nhật giao diện + tải dữ liệu
  } catch (e) {
    errEl.style.display = "block";
  }
}
document.getElementById("btn-do-login").addEventListener("click", doLogin);
document.getElementById("f-admin-pw").addEventListener("keydown", e => {
  if (e.key === "Enter") doLogin();
});
document.getElementById("f-login-email").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("f-admin-pw").focus();
});

// Quên mật khẩu: gửi link đặt lại qua email
document.getElementById("link-forgot").addEventListener("click", async (ev) => {
  ev.preventDefault();
  const email = (document.getElementById("f-login-email").value || "").trim();
  const errEl = document.getElementById("login-error");
  const infoEl = document.getElementById("login-info");
  errEl.style.display = "none"; infoEl.style.display = "none";
  if (!email) { errEl.textContent = "Nhập email vào ô trên rồi bấm Quên mật khẩu."; errEl.style.display = "block"; return; }
  try {
    await resetPassword(email);
    infoEl.textContent = "Đã gửi link đặt lại mật khẩu tới " + email + ". Kiểm tra hộp thư (cả mục Spam).";
    infoEl.style.display = "block";
  } catch (e) {
    errEl.textContent = "Không gửi được. Kiểm tra lại email.";
    errEl.style.display = "block";
  }
});

// ====== IMPORT / THÊM LÔ (bảng Excel trống) ======
function emptyRows(n) {
  return Array.from({length:n}, () => ({}));
}

function initImportHot() {
  const cont = document.getElementById("hot-import");
  if (importHot) { importHot.destroy(); importHot = null; }
  importHot = new Handsontable(cont, {
    data: emptyRows(60),
    columns: COLS,
    colHeaders: COLS.map(c => c.title),
    rowHeaders: true,
    height: 420,
    width: "100%",
    stretchH: "none",
    minSpareRows: 5,
    contextMenu: true,
    licenseKey: "non-commercial-and-evaluation",
    afterChange: (changes, source) => {
      if (source === "loadData") return;
      if (!changes) return;
      const data = importHot.getSourceData();
      changes.forEach(([r]) => {
        if (data[r]) computeRow(data[r]);
      });
      importHot.render();
    }
  });
}

document.getElementById("btn-add-shipment").addEventListener("click", () => {
  document.getElementById("import-modal-title").textContent = "Thêm lô hàng";
  document.getElementById("import-step1").style.display = "";
  document.getElementById("import-step2").style.display = "none";
  openModal("modal-import-plan");
  setTimeout(initImportHot, 50);
});
document.getElementById("btn-import-plan").addEventListener("click", () => {
  document.getElementById("import-modal-title").textContent = "Import kế hoạch xuất hàng";
  document.getElementById("import-step1").style.display = "";
  document.getElementById("import-step2").style.display = "none";
  openModal("modal-import-plan");
  setTimeout(initImportHot, 50);
});
document.getElementById("btn-clear-import").addEventListener("click", () => {
  if (importHot) importHot.loadData(emptyRows(60));
});
document.getElementById("btn-back-import").addEventListener("click", () => {
  document.getElementById("import-step1").style.display = "";
  document.getElementById("import-step2").style.display = "none";
});

// ----- Parse từ bảng import thành các lô -----
let parsedPlan = [];

function parseDate2(str) {
  if (!str) return "";
  str = String(str).trim();
  // Định dạng MM/DD hoặc MM/DD/YYYY (kiểu Nhật: tháng trước, ngày sau)
  let m = str.match(/^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?$/);
  if (m) {
    const mo = m[1], day = m[2];
    const y = m[3] ? (m[3].length===2 ? "20"+m[3] : m[3]) : new Date().getFullYear();
    return `${y}-${mo.padStart(2,"0")}-${day.padStart(2,"0")}`;
  }
  // "05-Jul" dạng
  m = str.match(/^(\d{1,2})[-\s]([A-Za-z]{3})/);
  if (m) {
    const months = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    const mo = months[m[2].toLowerCase()];
    if (mo) return `${new Date().getFullYear()}-${String(mo).padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  }
  return str;
}

document.getElementById("btn-parse-plan").addEventListener("click", () => {
  const rows = importHot.getSourceData().filter(r =>
    Object.values(r).some(v => v !== null && v !== undefined && String(v).trim() !== "")
  );
  if (!rows.length) { showToast("Bảng trống!"); return; }

  const shipments = [];
  let current = null;
  let ctxStuff = "", ctxEtd = "", ctxPod = "";

  for (const row of rows) {
    const itemVal = (row.items || "").toString().trim();
    const custVal = (row.customer || "").toString().trim();
    const contractVal = (row.contract || "").toString().trim();
    const indexVal = (row.index || "").toString().trim();
    const podVal  = (row.pod || "").toString().trim();
    const dateVal = (row.stuffingDate||"").toString().trim() || (row.etd||"").toString().trim();

    // Dòng đơn hàng THẬT phải có Items (mã hàng) HOẶC có Contract.
    // Dòng tổng: KHÔNG có Items + KHÔNG có Contract + KHÔNG có Index + KHÔNG có ngày + KHÔNG có POD
    //   (quy cách như "40F*1","AIR" thường nằm ở cột Customer, nên không xét custVal)
    const isOrderRow = itemVal !== "" || contractVal !== "" || indexVal !== "";
    const rowText = [row.customer,row.contract,row.index,row.items,row.pod]
      .map(v=>(v||"").toString().trim()).filter(Boolean).join(" ").trim();

    if (!isOrderRow) {
      // dòng không phải đơn hàng → nếu có text (quy cách) thì đóng lô
      if (rowText && current && current.orders.length) {
        current.container = rowText;
        shipments.push(current);
        current = null;
        ctxStuff = ""; ctxEtd = ""; ctxPod = ""; // reset cho lô sau
      }
      continue;
    }

    const sd = (row.stuffingDate||"").toString().trim();
    const ed = (row.etd||"").toString().trim();
    const pd = (row.pod||"").toString().trim();
    if (sd) ctxStuff = parseDate2(sd);
    if (ed) ctxEtd   = parseDate2(ed);
    if (pd) ctxPod   = pd.toUpperCase();

    if (!current) current = { stuffingDate: ctxStuff, etd: ctxEtd, pod: ctxPod, container: "", orders: [] };
    if (sd) current.stuffingDate = ctxStuff;
    if (ed) current.etd = ctxEtd;
    if (pd) current.pod = ctxPod;

    const o = computeRow({
      pod: row.pod ? String(row.pod).toUpperCase() : ctxPod,
      customer: custVal, contract: contractVal,
      index: indexVal, items: itemVal,
      qty: parseFloat(String(row.qty||"").replace(/[,]/g,""))||0,
      ctns: parseFloat(String(row.ctns||"").replace(/[,]/g,""))||0,
      kgPerCtn: parseFloat(row.kgPerCtn)||0,
      dimension: row.dimension||"",
      hsCode: row.hsCode||"", coForm: row.coForm||"", note: row.note||"",
    });
    current.orders.push(o);
  }
  if (current && current.orders.length) shipments.push(current);

  if (!shipments.length) { showToast("Không tách được lô nào. Kiểm tra dòng Quy cách!"); return; }

  // Dò trùng theo mã hàng
  shipments.forEach(ns => {
    const newItems = new Set(ns.orders.map(o=>o.items).filter(Boolean));
    ns.matched = allShipments.find(ex => {
      const exItems = new Set((ex.orders||[]).map(o=>o.items).filter(Boolean));
      let overlap = 0; newItems.forEach(i => { if (exItems.has(i)) overlap++; });
      return overlap > 0 && overlap >= Math.min(newItems.size, exItems.size) * 0.3;
    });
    ns.overwrite = !!ns.matched;
  });

  parsedPlan = shipments;
  renderImportPreview();
  document.getElementById("import-summary").textContent =
    `${shipments.length} lô · ${shipments.filter(s=>s.matched).length} trùng · ${shipments.filter(s=>!s.matched).length} mới`;
  document.getElementById("import-step1").style.display = "none";
  document.getElementById("import-step2").style.display = "";
});

function renderImportPreview() {
  document.getElementById("import-preview-tbody").innerHTML = parsedPlan.map((ns,i) => {
    const m = !!ns.matched;
    const sample = ns.orders.slice(0,2).map(o=>o.items).filter(Boolean).join(", ");
    const custs = [...new Set(ns.orders.map(o=>o.customer).filter(Boolean))].join(", ");
    return `<tr style="background:${m?'var(--amber-bg)':''}">
      <td style="text-align:center">${m?"⚠️":"🆕"}</td>
      <td><b>${fullPort(ns.pod)}</b><br><span style="font-size:11px;color:var(--text-muted)">ETD ${ns.etd||"—"} · Đóng ${ns.stuffingDate||"—"}</span></td>
      <td><span class="badge badge-blue" style="font-size:11px">${ns.container||"?"}</span></td>
      <td>${ns.orders.length}</td>
      <td style="font-size:11px;color:${m?'var(--amber-text)':'var(--green-text)'}">${m?"Có":"Mới"}</td>
      <td>${m
        ? `<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" ${ns.overwrite?"checked":""} onchange="toggleOW(${i},this.checked)"> Ghi đè</label>`
        : `<span style="font-size:11px;color:var(--green-text)">Tạo mới</span>`}</td>
      <td style="font-size:11px;color:var(--text-muted)">${sample}${ns.orders.length>2?"...":""}</td>
      <td style="font-size:12px">${custs}</td>
    </tr>`;
  }).join("");
}
window.toggleOW = (i,v) => { parsedPlan[i].overwrite = v; };

document.getElementById("btn-confirm-import-plan").addEventListener("click", async () => {
  const create = parsedPlan.filter(s=>!s.matched);
  const ow = parsedPlan.filter(s=>s.matched && s.overwrite);
  const skip = parsedPlan.filter(s=>s.matched && !s.overwrite);
  if (!confirm(`Tạo mới ${create.length} · Ghi đè ${ow.length} · Bỏ qua ${skip.length}. Tiếp tục?`)) return;

  for (const ns of create) {
    await addDoc(collection(db,"shipments"), {
      stuffingDate: ns.stuffingDate||null, etd: ns.etd||null, eta: null,
      shipDate: ns.etd || ns.stuffingDate || null,
      port: ns.pod||"", container: ns.container||"",
      cyCut: null, vessel: null,
      checklist: {1:"done"}, orders: ns.orders,
      createdAt: serverTimestamp(),
    });
  }
  for (const ns of ow) {
    await updateDoc(doc(db,"shipments",ns.matched.id), {
      orders: ns.orders,
      port: ns.pod || ns.matched.port,
      container: ns.container || ns.matched.container,
      stuffingDate: ns.stuffingDate || ns.matched.stuffingDate || null,
      etd: ns.etd || ns.matched.etd || null,
    });
  }
  closeModal("modal-import-plan");
  showToast(`Xong! Tạo ${create.length} · Ghi đè ${ow.length}`);
});

// ====== DANH SÁCH CARD ======
function sortShipments(list) {
  return [...list].sort((a,b) => {
    const da = a.stuffingDate || a.shipDate || "9999";
    const db2 = b.stuffingDate || b.shipDate || "9999";
    if (da !== db2) return da < db2 ? -1 : 1;
    return getProgress(b.checklist).pct - getProgress(a.checklist).pct;
  });
}

function renderList() {
  const filterVal = document.getElementById("filter-status").value;
  const filterMonth = document.getElementById("filter-month").value;
  const filterCust = document.getElementById("filter-customer").value;
  const filterInv = (document.getElementById("filter-invoice").value || "").trim().toLowerCase();
  const container = document.getElementById("shipment-list");
  const admin = isAdmin();

  // Đổ danh sách tháng vào dropdown
  const months = [...new Set(allShipments.map(s=>s.period).filter(Boolean))].sort().reverse();
  const monthSel = document.getElementById("filter-month");
  const curMonth = monthSel.value;
  monthSel.innerHTML = `<option value="">Tất cả tháng</option>` + months.map(m => {
    const [y,mo] = m.split("-");
    return `<option value="${m}" ${m===curMonth?"selected":""}>Tháng ${mo}/${y}</option>`;
  }).join("");

  // Đổ danh sách khách hàng vào dropdown (lấy từ đơn hàng các lô)
  const custs = [...new Set(allShipments.flatMap(s => (s.orders||[]).map(o=>o.customer)).filter(Boolean))].sort();
  const custSel = document.getElementById("filter-customer");
  const curCust = custSel.value;
  custSel.innerHTML = `<option value="">Tất cả khách</option>` + custs.map(c =>
    `<option value="${c}" ${c===curCust?"selected":""}>${c}</option>`).join("");

  const openCards = new Set();
  document.querySelectorAll(".card-detail.open").forEach(el => openCards.add(el.id.replace("detail-","")));

  let list = sortShipments(allShipments);
  if (filterVal) {
    list = list.filter(s => {
      const { label } = getStatus(s.checklist);
      return (filterVal==="done"&&label==="Hoàn tất") || (filterVal==="booking"&&label==="Chờ booking")
          || (filterVal==="processing"&&label==="Đang xử lý") || (filterVal==="pending"&&label==="Chờ xử lý");
    });
  }
  if (filterMonth) {
    list = list.filter(s => s.period === filterMonth);
  }
  if (filterCust) {
    list = list.filter(s => (s.orders||[]).some(o => o.customer === filterCust));
  }
  if (filterInv) {
    list = list.filter(s => (s.invoiceNo||"").toLowerCase().includes(filterInv));
  }

  document.getElementById("shipment-count").textContent = list.length + " lô hàng · sắp theo ngày đóng hàng";
  if (!list.length) {
    container.innerHTML = `<div class="empty-state"><i class="ti ti-package"></i><p>Chưa có lô hàng nào</p></div>`;
    return;
  }
  container.innerHTML = "";
  list.forEach(s => container.appendChild(buildCard(s, admin)));
  openCards.forEach(id => {
    document.getElementById("detail-"+id)?.classList.add("open");
    document.getElementById("cv-"+id)?.classList.add("open");
  });
}

function buildCard(s, admin) {
  const { done, total, pct } = getProgress(s.checklist);
  const status = getStatus(s.checklist);
  const isAir = (s.container||"").toUpperCase().includes("AIR");
  const isDone = done === total;
  const card = document.createElement("div");
  card.className = "shipment-card";
  card.id = "card-"+s.id;
  // Card hoàn tất → nền xanh nhẹ
  if (isDone) card.style.background = "#EBF3FB";

  // === Lộ trình vận chuyển: 4 mốc ===
  const routeNodes = [
    { ic:"building-warehouse", color:"blue", date:formatDate(s.stuffingDate), label:"Đóng hàng" },
    { ic:"scissors",           color:"pink", date:formatDate(s.cyCut),        label:"Cắt máng" },
    { ic:"plane-departure",    color:"blue", date:formatDate(s.etd),          label:"ETD" },
    { ic:"ship",               color:"blue", date:formatDate(s.eta),          label:"Arrival" },
  ];
  let timelineHTML = "";
  routeNodes.forEach((n,i) => {
    if (i>0) timelineHTML += `<div class="ch-tl-line${(i===1||i===2)?" pink":""}"></div>`;
    timelineHTML += `<div class="ch-tl-node"><div class="ch-tl-ic ${n.color}"><i class="ti ti-${n.ic}"></i></div><div class="ch-tl-date">${n.date}</div><div class="ch-tl-lbl">${n.label}</div></div>`;
  });

  // === Tàu + container / hình thức xuất ===
  const C = (s.container||"").toUpperCase();
  let bigMode = null;
  if (C.includes("AIR")) bigMode = { txt:"AIR", color:"blue" };
  else if (C.includes("LCL")) bigMode = { txt:"LCL", color:"teal" };
  else if (C.includes("CPN")) bigMode = { txt:"CPN", color:"amber" };
  else if (C.includes("KNQ")) bigMode = { txt:"KNQ", color:"purple" };
  const conts = (s.containers && s.containers.length) ? s.containers
              : (s.contNo||s.sealNo) ? [{type:"", no:s.contNo, seal:s.sealNo}] : [];
  let contHTML;
  if (!bigMode && conts.length) {
    const rows = conts.map(c => {
      const tcls = (c.type||"").includes("40") ? "ch-cont-type t40" : "ch-cont-type";
      return `<div class="ch-cont-row"><span class="${tcls}">${c.type||"CONT"}</span><div class="ch-cont-ns"><span class="ch-cont-no">${c.no||"—"}</span><span class="ch-cont-seal">Seal: ${c.seal||"—"}</span></div></div>`;
    }).join("");
    const tri = conts.length > 2 ? `<span class="ch-cont-tri" title="Lô có ${conts.length} container"></span>` : "";
    contHTML = `<div class="ch-cont-box">${rows}${tri}</div>`;
  } else {
    const big = bigMode || { txt:(s.container||"—"), color:"gray" };
    contHTML = `<div class="ch-cont-box ch-cont-big"><span class="ch-big ${big.color}">${big.txt}</span></div>`;
  }

  // === Thanh 11 bước (bấm để đổi trạng thái nếu là admin) ===
  const stepbarHTML = CHECKLIST_STEPS.map(step => {
    const state = (s.checklist||{})[step.id] || "pending";
    const cls = state==="done"?"done":state==="skip"?"skip":"pending";
    return `<div class="ch-step ${cls}" title="${step.label}" ${admin?`style="cursor:pointer" onclick="ckToggle('${s.id}',${step.id},'${state}',${step.skippable})"`:""}><span class="ch-step-num">${step.short}</span><span class="ch-step-bar"></span></div>`;
  }).join("");

  const ordersCount = (s.orders||[]).length;

  const listHTML = CHECKLIST_STEPS.map(step => {
    const state = (s.checklist||{})[step.id] || "pending";
    let cls = "ck-list-item" + (state==="done"?" ck-done":state==="skip"?" ck-skipped":"");
    const dot = state==="done"?"✓":state==="skip"?"—":step.short;
    return `<div class="${cls}" ${admin?"style='cursor:pointer'":""} onclick="${admin?`ckToggle('${s.id}',${step.id},'${state}',${step.skippable})`:''}">
      <span class="ck-dot2">${dot}</span><span class="ck-name2">${step.label}</span></div>`;
  }).join("");

  const customers = [...new Set((s.orders||[]).map(o=>o.customer).filter(Boolean))];
  const custLabel = customers.length ? customers.join(" / ")+" — " : "";
  const periodLabel = s.period ? (() => { const [y,mo]=s.period.split("-"); return `Tháng ${mo}/${y}`; })() : "";

  card.innerHTML = `
    <div class="card-head">
      <div class="ch-id">
        <div class="ch-title"><i class="ti ti-world ch-globe"></i><span>${custLabel}${fullPort(s.port)}</span></div>
        <div class="ch-pills">
          <span class="badge ${isAir?"badge-gray":"badge-blue"}">${s.container||"?"}</span>
          <span class="badge badge-gray"><i class="ti ti-package"></i> ${ordersCount} đơn hàng</span>
          <span class="badge ${status.cls}">${status.label}</span>
        </div>
        <div class="ch-meta">
          ${s.invoiceNo?`<span><i class="ti ti-file-invoice"></i>INV: ${s.invoiceNo}</span>`:""}
          ${s.booking?`<span><i class="ti ti-bookmark"></i>Booking: ${s.booking}</span>`:""}
          ${s.lcId?`<span><i class="ti ti-credit-card"></i>Đã gán LC</span>`:""}
        </div>
      </div>
      <div class="ch-route">
        <div class="ch-sec-label"><i class="ti ti-route"></i>Lộ trình vận chuyển</div>
        <div class="ch-timeline">${timelineHTML}</div>
      </div>
      <div class="ch-vessel">
        <div class="ch-sec-label2"><i class="ti ti-${isAir?"plane":"ship"}"></i><span>${s.vessel||"Chưa có tàu"}</span></div>
        ${contHTML}
      </div>
      <div class="ch-status">
        <div class="ch-status-top">
          <button class="btn btn-sm" onclick="toggleCard('${s.id}')" style="padding:4px 10px">Chi tiết <i class="ti ti-chevron-down chevron" id="cv-${s.id}"></i></button>
        </div>
        <div class="ch-prog">
          <div class="ch-prog-head"><span>${done} / ${total} bước</span><span class="ch-pct">${pct}%</span></div>
          <div class="ch-stepbar">${stepbarHTML}</div>
        </div>
        <div class="ch-period"><span class="period-label" ${admin?`onclick="editPeriod('${s.id}')" style="cursor:pointer;font-size:12px;font-weight:500;color:var(--blue-text);border:0.5px dashed var(--blue-border);padding:3px 8px;border-radius:var(--radius-md)" title="Bấm để sửa tháng"`:`style="font-size:12px;font-weight:500;color:var(--blue-text)"`}>${periodLabel || (admin?"+ Gán tháng":"")}</span></div>
      </div>
    </div>
    <div class="card-detail" id="detail-${s.id}">
      <div style="display:flex;align-items:stretch">
        <div style="flex:1;min-width:0;overflow-x:auto">
          <div class="detail-inner">
            ${buildReadonlyTable(s.orders||[])}
            <div class="action-row" style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
              ${canEditAnyCol() ? `<button class="btn btn-sm btn-primary" onclick="openEditOrders('${s.id}')"><i class="ti ti-table"></i> Chỉnh sửa (Excel)</button>` : ""}
              ${canEditAnyCol() ? `<button class="btn btn-sm" onclick="openShipMark('${s.id}')"><i class="ti ti-tag"></i> Shipping Mark</button>` : ""}
              ${admin ? `<button class="btn btn-sm" onclick="openAssignLC('${s.id}')"><i class="ti ti-credit-card"></i> Gán LC</button>` : ""}
              ${admin ? `<button class="btn btn-sm" onclick="openEditShipment('${s.id}')"><i class="ti ti-edit"></i> Sửa lô hàng</button>` : ""}
              ${admin ? `<button class="btn btn-sm btn-danger" onclick="deleteShipment('${s.id}')"><i class="ti ti-trash"></i> Xóa lô</button>` : ""}
            </div>
          </div>
        </div>
        <div style="width:210px;flex-shrink:0;border-left:0.5px solid var(--border);padding:12px;background:var(--bg-secondary);display:flex;flex-direction:column">
          <div style="font-size:11px;font-weight:500;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">Tiến trình</div>
          <div class="ck-list">${listHTML}</div>
          <div style="margin-top:14px;padding-top:12px;border-top:0.5px solid var(--border);display:flex;flex-direction:column;gap:6px">
            <button class="btn btn-sm btn-export" onclick="openEmailModal('${s.id}')"><i class="ti ti-mail"></i> Generate email</button>
            <button class="btn btn-sm btn-export" onclick="openPackingList('${s.id}')"><i class="ti ti-file-text"></i> In Packing List</button>
            ${!(C.includes("AIR")||C.includes("CPN")||C.includes("KNQ")) ? `<button class="btn btn-sm btn-export" onclick="openVGM('${s.id}')"><i class="ti ti-scale"></i> Xuất VGM</button>` : ""}
          </div>
        </div>
      </div>
    </div>`;
  return card;
}

function buildReadonlyTable(orders) {
  if (!orders.length) return `<p style="font-size:12px;color:var(--text-muted);padding:8px 0">Chưa có đơn hàng.</p>`;
  const tPcs = orders.reduce((a,o)=>a+(parseFloat(o.qty)||0),0);
  const tCtns= orders.reduce((a,o)=>a+(parseFloat(o.ctns)||0),0);
  const tKg  = orders.reduce((a,o)=>a+(parseFloat(o.kgTotal)||0),0);
  const tCbm = orders.reduce((a,o)=>a+(parseFloat(o.cbm)||0),0);
  const tAmt = orders.reduce((a,o)=>a+(parseFloat(o.qty)||0)*(parseFloat(o.unitPrice)||0),0);
  const fmtAmt = n => n ? Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}) : "—";
  const rows = orders.map(o => {
    const amt = (parseFloat(o.qty)||0)*(parseFloat(o.unitPrice)||0);
    return `<tr>
    <td>${o.customer||"—"}</td><td>${o.contract||"—"}</td><td>${o.index||"—"}</td><td>${o.items||"—"}</td>
    <td class="qty-pcs">${(parseFloat(o.qty)||0).toLocaleString()}</td><td>${parseFloat(o.ctns)||0}</td>
    <td>${parseFloat(o.kgTotal)||0}</td><td>${parseFloat(o.cbm)||0}</td>
    <td class="amount-cell">${fmtAmt(amt)}</td>
    <td>${o.hsCode||"—"}</td><td>${o.coForm||"—"}</td><td style="font-size:11px;color:var(--text-muted)">${o.note||""}</td>
  </tr>`;}).join("");
  return `<table class="data-table">
    <colgroup><col style="width:90px"><col style="width:80px"><col style="width:85px"><col style="width:90px">
    <col style="width:65px"><col style="width:50px"><col style="width:60px"><col style="width:55px">
    <col style="width:85px"><col style="width:65px"><col style="width:65px"><col style="width:auto"></colgroup>
    <thead><tr><th>Customer</th><th>Contract</th><th>Index</th><th>Items</th>
    <th>Qty PCS</th><th>CTNs</th><th>Qty Kgs</th><th>CBM</th><th>Amount (USD)</th><th>HS Code</th><th>C/O Form</th><th>Note</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4" style="color:var(--text-muted)">Tổng (${orders.length} đơn)</td>
    <td class="qty-pcs">${tPcs.toLocaleString()}</td><td>${tCtns}</td>
    <td>${Math.round(tKg*10)/10}</td><td>${Math.round(tCbm*100)/100}</td>
    <td class="amount-cell">${fmtAmt(tAmt)}</td><td colspan="3"></td></tr></tfoot>
  </table>`;
}

window.editPeriod = function(shipId) {
  const s = allShipments.find(x=>x.id===shipId);
  if (!s) return;
  const cur = s.period || "";
  const val = prompt("Nhập tháng cho lô hàng (định dạng YYYY-MM, ví dụ 2026-06).\nĐể trống để xóa:", cur);
  if (val === null) return; // hủy
  const v = val.trim();
  if (v && !/^\d{4}-\d{2}$/.test(v)) { showToast("Sai định dạng! Dùng YYYY-MM, ví dụ 2026-06"); return; }
  updateDoc(doc(db,"shipments",shipId), { period: v || null }).then(() => {
    showToast(v ? "Đã gán tháng "+v : "Đã xóa tháng");
  });
};

window.toggleCard = function(id) {
  const detail = document.getElementById("detail-"+id);
  const cv = document.getElementById("cv-"+id);
  const open = detail.classList.contains("open");
  detail.classList.toggle("open", !open);
  cv.classList.toggle("open", !open);
};

window.ckToggle = async function(shipId, stepId, state, skippable) {
  let next;
  if (state==="pending") next="done";
  else if (state==="done" && skippable) next="skip";
  else if (state==="done") next="pending";
  else next="pending";
  const s = allShipments.find(x=>x.id===shipId);
  await updateDoc(doc(db,"shipments",shipId), { checklist: {...(s.checklist||{}), [stepId]: next} });
};

// ====== SỬA ĐƠN HÀNG BẰNG HANDSONTABLE ======
window.openEditOrders = function(shipId) {
  editShipId = shipId;
  const s = allShipments.find(x=>x.id===shipId);
  if (!s) return;
  document.getElementById("edit-orders-title").textContent = `Chỉnh sửa: ${fullPort(s.port)} (${s.container||"?"})`;
  openModal("modal-edit-orders");

  setTimeout(() => {
    const cont = document.getElementById("hot-edit");
    if (editHot) { editHot.destroy(); editHot = null; }
    const data = (s.orders||[]).map(o => ({...o}));
    while (data.length < 5) data.push({});
    editHot = new Handsontable(cont, {
      data,
      columns: EDIT_COLS,
      colHeaders: EDIT_COLS.map(c=>c.title),
      rowHeaders: true,
      height: 440,
      width: "100%",
      stretchH: "none",
      minSpareRows: 3,
      contextMenu: true,
      licenseKey: "non-commercial-and-evaluation",
      cells: (row, col) => {
        const cp = EDIT_COLS[col];
        if (cp && cp.readOnly) return { className: "ht-readonly-cell", readOnly: true };
        // Khóa cột theo vai trò: admin (editCols="all") sửa hết; vai trò khác chỉ sửa cột được phép
        const pr = perms();
        if (pr.editCols !== "all") {
          const allow = Array.isArray(pr.editCols) ? pr.editCols : [];
          if (!cp || !allow.includes(cp.data)) return { className: "ht-readonly-cell", readOnly: true };
        }
        return {};
      },
      afterChange: (changes, source) => {
        if (source === "loadData" || !changes) return;
        const d = editHot.getSourceData();
        changes.forEach(([r]) => { if (d[r]) computeRow(d[r]); });
        editHot.render();
      }
    });
  }, 50);
};

document.getElementById("btn-add-edit-row").addEventListener("click", () => {
  if (editHot) editHot.alter("insert_row_below", editHot.countRows()-1);
});

document.getElementById("btn-save-edit-orders").addEventListener("click", async () => {
  if (!editHot || !editShipId) return;
  if (!confirm("Lưu tất cả thay đổi?")) return;
  const data = editHot.getSourceData()
    .filter(r => (r.items||"").toString().trim() || (r.customer||"").toString().trim())
    .map(o => computeRow({
      pod:o.pod||"", customer:o.customer||"", contract:o.contract||"", index:o.index||"",
      items:o.items||"", qty:parseFloat(o.qty)||0, ctns:parseFloat(o.ctns)||0,
      kgPerCtn:parseFloat(o.kgPerCtn)||0, kgTotal:parseFloat(o.kgTotal)||0,
      dimension:o.dimension||"", cbm:parseFloat(o.cbm)||0,
      tareCtn:parseFloat(o.tareCtn)||0,
      unitPrice:parseFloat(o.unitPrice)||0,
      hsCode:o.hsCode||"", coForm:o.coForm||"", note:o.note||"",
      stuffingDate:o.stuffingDate||"", etd:o.etd||"",
    }));
  await updateDoc(doc(db,"shipments",editShipId), { orders: data });
  closeModal("modal-edit-orders");
  showToast(`Đã lưu ${data.length} đơn hàng!`);
});

// ====== SỬA THÔNG TIN LÔ ======
window.openEditShipment = function(id) {
  const s = allShipments.find(x=>x.id===id);
  if (!s) return;
  document.getElementById("edit-shipment-body").innerHTML = `
    <form id="form-edit-ship">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Ngày đóng hàng</label><input type="date" class="form-input" id="es-stuffing" value="${s.stuffingDate||""}"></div>
        <div class="form-group"><label class="form-label">ETD (Ngày tàu đi) *</label><input type="date" class="form-input" id="es-etd" value="${s.etd||""}" required></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Cảng (POD)</label><input class="form-input" id="es-port" value="${s.port||""}"></div>
        <div class="form-group"><label class="form-label">Phương thức vận chuyển</label><input class="form-input" id="es-container" value="${s.container||""}" placeholder="20F*1, 40HC*2, AIR, LCL, KNQ..." oninput="window._refreshFclLock&&window._refreshFclLock()"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Tên tàu / Hãng bay</label><input class="form-input" id="es-vessel" value="${s.vessel||""}"></div>
        <div class="form-group"><label class="form-label">ETA (Ngày tàu đến)</label><input type="date" class="form-input" id="es-eta" value="${s.eta||""}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Ngày cắt máng (Cut off)</label><input type="date" class="form-input" id="es-cycut" value="${s.cyCut||""}"></div>
        <div class="form-group"><label class="form-label">Giờ cắt máng</label><input type="time" class="form-input" id="es-cycut-time" value="${s.cyCutTime||""}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Số Booking</label><input class="form-input" id="es-booking" value="${s.booking||""}" placeholder="SITSGYKW506862"></div>
        <div class="form-group"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Danh sách Container</label>
        <div id="es-cont-list"></div>
        <button type="button" class="btn btn-sm" id="es-add-cont" style="margin-top:6px"><i class="ti ti-plus"></i> Thêm container</button>
        <div id="es-cont-note" style="display:none;font-size:12px;color:var(--text-muted);margin-top:6px"><i class="ti ti-lock"></i> Phương thức này không dùng container — danh sách đã khóa.</div>
      </div>
      <div class="form-group">
        <label class="form-label">Lô hàng thuộc tháng (MM/YYYY)</label>
        <input type="month" class="form-input" id="es-period" value="${s.period||""}">
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Số hóa đơn (Invoice No.)</label><input class="form-input" id="es-invoice" value="${s.invoiceNo||""}" placeholder="862/26 -NPT"></div>
        <div class="form-group"><label class="form-label">Ngày hóa đơn</label><input type="date" class="form-input" id="es-invdate" value="${s.invoiceDate||""}"></div>
      </div>
      <div class="form-footer">
        <button type="button" class="btn" onclick="closeModalById('modal-edit-shipment')">Hủy</button>
        <button type="submit" class="btn btn-primary"><i class="ti ti-check"></i> Lưu</button>
      </div>
    </form>`;
  document.getElementById("form-edit-ship").addEventListener("submit", async e => {
    e.preventDefault();
    if (!confirm("Lưu thay đổi?")) return;
    const etdVal = document.getElementById("es-etd").value;
    // Thu thập danh sách container
    const containers = [];
    let contError = "";
    document.querySelectorAll("#es-cont-list .es-cont-row").forEach(row => {
      const type = row.querySelector(".ec-type").value;
      const no   = row.querySelector(".ec-no").value.trim().toUpperCase();
      const seal = row.querySelector(".ec-seal").value.trim();
      const tare = parseFloat(row.querySelector(".ec-tare").value) || 0;
      const gw   = parseFloat(row.querySelector(".ec-gw").value) || 0;
      // Quy tắc số cont: 4 chữ cái + 7 chữ số (vd ABCD1234567)
      if (no && !/^[A-Z]{4}[0-9]{7}$/.test(no)) contError = no;
      if (no || seal) containers.push({ type, no, seal, tare, gw });
    });
    if (contError) {
      alert(`Số cont "${contError}" không đúng quy tắc.\n\nĐúng phải là 4 chữ cái + 7 chữ số (ví dụ: ABCD1234567).\n\nVui lòng kiểm tra lại số cont.`);
      return;
    }
    await updateDoc(doc(db,"shipments",id), {
      stuffingDate: document.getElementById("es-stuffing").value||null,
      shipDate: etdVal,
      etd: etdVal||null,
      port: document.getElementById("es-port").value.trim().toUpperCase(),
      container: document.getElementById("es-container").value.trim(),
      vessel: document.getElementById("es-vessel").value.trim()||null,
      cyCut: document.getElementById("es-cycut").value||null,
      cyCutTime: document.getElementById("es-cycut-time").value||null,
      eta: document.getElementById("es-eta").value||null,
      booking: document.getElementById("es-booking").value.trim()||null,
      containers: containers,
      period: document.getElementById("es-period").value||null,
      invoiceNo: document.getElementById("es-invoice").value.trim()||null,
      invoiceDate: document.getElementById("es-invdate").value||null,
    });
    closeModal("modal-edit-shipment");
    showToast("Đã cập nhật lô hàng!");
  });

  // Khởi tạo danh sách container
  const contListEl = document.getElementById("es-cont-list");
  const contNoteEl = document.getElementById("es-cont-note");
  const addContBtn = document.getElementById("es-add-cont");

  // FCL = có 20F/40F (hoặc bất kỳ thứ gì không phải AIR/LCL/KNQ/CPN). Trống cũng coi như FCL.
  function isFclMethod() {
    const v = (document.getElementById("es-container").value || "").toUpperCase();
    return !/AIR|LCL|KNQ|CPN/.test(v);
  }
  function refreshGwState() {
    const fcl = isFclMethod();
    const rows = contListEl.querySelectorAll(".es-cont-row");
    const multi = rows.length > 1;
    rows.forEach(r => {
      const gw = r.querySelector(".ec-gw");
      const on = fcl && multi;
      gw.disabled = !on;
      gw.placeholder = !fcl ? "" : (multi ? "G.W cont" : "= tổng lô");
      gw.style.opacity = on ? "1" : "0.45";
    });
  }
  window._refreshFclLock = function() {
    const fcl = isFclMethod();
    contListEl.style.opacity = fcl ? "1" : "0.45";
    contListEl.querySelectorAll("input,select,button").forEach(el => { el.disabled = !fcl; });
    addContBtn.disabled = !fcl;
    addContBtn.style.opacity = fcl ? "1" : "0.45";
    if (contNoteEl) contNoteEl.style.display = fcl ? "none" : "block";
    if (fcl) refreshGwState();
  };
  function addContRow(c = {}) {
    const row = document.createElement("div");
    row.className = "es-cont-row";
    row.style.cssText = "display:flex;gap:6px;margin-bottom:6px;align-items:center";
    row.innerHTML = `
      <select class="form-select ec-type" style="width:82px;flex-shrink:0">
        ${["20GP","40DC","40HC"].map(t=>`<option value="${t}" ${c.type===t?"selected":""}>${t}</option>`).join("")}
      </select>
      <input class="form-input ec-no" placeholder="Số cont" value="${c.no||""}" style="flex:1.1;min-width:0">
      <input class="form-input ec-seal" placeholder="Số seal" value="${c.seal||""}" style="flex:1;min-width:0">
      <input class="form-input ec-tare" type="number" placeholder="Tare" value="${c.tare||""}" style="width:74px;flex-shrink:0" title="Trọng lượng vỏ container (cố định)">
      <input class="form-input ec-gw" type="number" placeholder="G.W cont" value="${c.gw||""}" style="width:86px;flex-shrink:0" title="G.W riêng cont này (chỉ cần khi lô có từ 2 cont)">
      <button type="button" class="btn btn-sm btn-danger ec-del" style="flex-shrink:0;padding:6px 9px"><i class="ti ti-x"></i></button>`;
    row.querySelector(".ec-del").addEventListener("click", () => { row.remove(); window._refreshFclLock(); });
    contListEl.appendChild(row);
    window._refreshFclLock();
  }
  // Nạp dữ liệu cũ: ưu tiên mảng containers, fallback contNo/sealNo cũ
  const existing = (s.containers && s.containers.length) ? s.containers
                 : (s.contNo||s.sealNo) ? [{type:"20GP", no:s.contNo||"", seal:s.sealNo||""}] : [];
  if (existing.length) existing.forEach(addContRow); else addContRow();
  addContBtn.addEventListener("click", () => { if (isFclMethod()) addContRow(); });
  window._refreshFclLock();
  openModal("modal-edit-shipment");
};

window.deleteShipment = async function(id) {
  if (!confirm("Xóa toàn bộ lô hàng này? Không thể hoàn tác!")) return;
  await deleteDoc(doc(db,"shipments",id));
  showToast("Đã xóa lô hàng!");
};

// ====== EMAIL BOOKING ======
window.openEmailModal = async function(shipId) {
  const s = allShipments.find(x=>x.id===shipId);
  if (!s) return;
  let consignee="—", description="SHIRTS", note="", mailTo="", mailCc="", shortName="";
  const first = (s.orders||[])[0];
  if (first?.customer) {
    try {
      const { collection:col, query:q, where, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const snap = await getDocs(q(col(db,"customers"), where("name","==",first.customer)));
      if (!snap.empty) {
        const c = snap.docs[0].data();
        consignee=c.consignee||"—"; description=c.description||"SHIRTS"; note=c.note||"";
        mailTo=c.mailTo||""; mailCc=c.mailCc||""; shortName=c.shortName||c.name||"";
      }
    } catch(e){}
  }
  const contracts = [...new Set((s.orders||[]).map(o=>o.contract).filter(Boolean))];
  const firstContract = contracts[0] || "";
  const tPcs = (s.orders||[]).reduce((a,o)=>a+(parseFloat(o.qty)||0),0);
  const tCtns= (s.orders||[]).reduce((a,o)=>a+(parseFloat(o.ctns)||0),0);
  const tKg  = Math.round((s.orders||[]).reduce((a,o)=>a+(parseFloat(o.kgTotal)||0),0));
  const tCbm = Math.round((s.orders||[]).reduce((a,o)=>a+(parseFloat(o.cbm)||0),0)*100)/100;
  const etdStr = s.etd ? new Date(s.etd).toLocaleDateString("en-US",{month:"short",day:"2-digit",year:"numeric"}).toUpperCase() : "???";
  const etdShort = s.etd ? new Date(s.etd).toLocaleDateString("en-US",{month:"short",day:"2-digit"}).toUpperCase() : "???";

  // Subject: New Booking 1x20 shipments //HCM-BANGKOK, THAILAND/ ETD 24 JUN / Consignee: FLEX THAILAND//V26TS006
  const subject = `New Booking ${s.container||""} shipments //HCM-${fullPort(s.port)}/ ETD ${etdShort} / Consignee: ${shortName}//${firstContract}`;

  const body = `Please arrange for our NEW FCL BOOKING as follows!

${s.container||"???"} TO ${fullPort(s.port)}, JAPAN:

ETD: ~ ${etdStr}  TO: ${fullPort(s.port)}: ETA:???  VESSEL: AS YOUR ARRANGEMENT

Description: ${description}
Contract number: ${contracts.join(", ")}
Quantity: ${tPcs.toLocaleString()} pcs = (about) ${tCtns} cartons = (about) ${tKg} kgs = (about) ${tCbm} cbm

Consignee: ${consignee}
${note ? "\nNote: "+note : ""}

Best regards,`;

  document.getElementById("email-body").innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
      <div style="display:flex;gap:8px;align-items:center">
        <span style="width:50px;font-size:12px;font-weight:500;color:var(--text-muted)">To:</span>
        <input class="form-input" id="em-to" value="${mailTo}" style="flex:1;font-size:12px">
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span style="width:50px;font-size:12px;font-weight:500;color:var(--text-muted)">CC:</span>
        <input class="form-input" id="em-cc" value="${mailCc}" style="flex:1;font-size:12px">
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span style="width:50px;font-size:12px;font-weight:500;color:var(--text-muted)">Subject:</span>
        <input class="form-input" id="em-subject" value="${subject.replace(/"/g,'&quot;')}" style="flex:1;font-size:12px">
      </div>
    </div>
    <textarea id="em-body" style="width:100%;height:280px;font-size:13px;line-height:1.6;border:0.5px solid var(--border);border-radius:var(--radius-md);padding:12px;font-family:inherit;resize:vertical;outline:none">${body}</textarea>`;

  window._emailData = { mailTo, mailCc };
  openModal("modal-email");
};
document.getElementById("btn-copy-email").addEventListener("click", () => {
  const body = document.getElementById("em-body")?.value || "";
  navigator.clipboard.writeText(body);
  showToast("Đã copy nội dung email!");
});
document.getElementById("btn-open-mail").addEventListener("click", () => {
  const to = document.getElementById("em-to")?.value || "";
  const cc = document.getElementById("em-cc")?.value || "";
  const subject = document.getElementById("em-subject")?.value || "";
  const body = document.getElementById("em-body")?.value || "";
  const link = `mailto:${encodeURIComponent(to)}?cc=${encodeURIComponent(cc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = link;
});

document.getElementById("filter-status").addEventListener("change", renderList);
document.getElementById("filter-month").addEventListener("change", renderList);
document.getElementById("filter-customer").addEventListener("change", renderList);
document.getElementById("filter-invoice").addEventListener("input", renderList);

// ====== GÁN LC ======
window.openAssignLC = async function(shipId) {
  const s = allShipments.find(x=>x.id===shipId);
  if (!s) return;

  // Lấy danh sách LC từ Firestore
  let lcList = [];
  try {
    const { collection:col, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const snap = await getDocs(col(db,"lc"));
    lcList = snap.docs.map(d=>({id:d.id, ...d.data()}));
  } catch(e){}

  // Map tên khách LC ↔ key
  const LC_MAP = { "MITSUWA":"MITSUWA", "SANMARINO":"SANMARINO", "HEMD (OGITA)":"NPT", "ACROS":"ACROS" };
  const custs = [...new Set((s.orders||[]).map(o=>o.customer).filter(Boolean))];
  const lcKey = custs.map(c=>LC_MAP[c]).find(Boolean);

  let body;
  if (!lcKey) {
    body = `<div style="font-size:13px;color:var(--text-muted);padding:8px 0">
      Lô này không thuộc khách hàng dùng LC (MITSUWA, SANMARINO, NPT/HEMD, ACROS).
    </div>
    <div class="form-footer"><button class="btn" onclick="closeModalById('modal-assign-lc')">Đóng</button></div>`;
  } else {
    const relevant = lcList.filter(x=>x.lcKey===lcKey).sort((a,b)=>(b.issueDate||"").localeCompare(a.issueDate||""));
    if (!relevant.length) {
      body = `<div style="font-size:13px;color:var(--text-muted);padding:8px 0">
        Khách <b>${lcKey}</b> chưa có LC nào. Vào trang LC để tạo trước.
      </div>
      <div class="form-footer"><button class="btn" onclick="closeModalById('modal-assign-lc')">Đóng</button></div>`;
    } else {
      const opts = relevant.map(lc => {
        const checked = s.lcId === lc.id ? "checked" : "";
        const statusTxt = lc.status==="active" ? "Đang hoạt động" : "Đã kết thúc";
        return `<label style="display:flex;align-items:center;gap:8px;padding:10px;border:0.5px solid var(--border-md);border-radius:var(--radius-md);cursor:pointer;margin-bottom:6px">
          <input type="radio" name="assign-lc" value="${lc.id}" ${checked}>
          <div><div style="font-weight:500">${lc.name} <span style="font-size:11px;color:var(--text-muted)">(${statusTxt})</span></div>
          <div style="font-size:11px;color:var(--text-muted)">Amount: ${(parseFloat(lc.amount)||0).toLocaleString()} USD · Hạn: ${formatDate(lc.expiry)||"—"}</div></div>
        </label>`;
      }).join("");
      body = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Khách LC: <b>${lcKey}</b>. Chọn LC để gán lô này (số tiền INV sẽ trừ vào LC đó):</div>
        ${(() => {
          // Bảng kiểm điều kiện để INV được cộng vào LC
          const exported = (s.checklist||{})[8]==="done" || (s.checklist||{})[8]==="skip";
          const hasInv = !!s.invoiceNo, hasInvDate = !!s.invoiceDate;
          const hasPrice = (s.orders||[]).length>0 && (s.orders||[]).every(o => parseFloat(o.unitPrice)>0);
          const chk = (ok,label) => `<div style="font-size:12px;display:flex;align-items:center;gap:6px;color:${ok?'var(--green-text)':'var(--red-text)'}">
            <i class="ti ti-${ok?'circle-check':'circle-x'}"></i> ${label}</div>`;
          const allOk = exported && hasInv && hasInvDate && hasPrice;
          return `<div style="background:${allOk?'var(--green-bg)':'#FFF8E8'};border-radius:var(--radius-md);padding:10px 12px;margin-bottom:12px">
            <div style="font-size:11px;font-weight:500;margin-bottom:6px;color:var(--text-muted)">ĐIỀU KIỆN ĐỂ INV CỘNG VÀO LC:</div>
            ${chk(exported,"Đã làm tờ khai Hải quan (bước 8)")}
            ${chk(hasInv,"Có Số hóa đơn (Invoice No.)")}
            ${chk(hasInvDate,"Có Ngày hóa đơn")}
            ${chk(hasPrice,"Tất cả mã hàng có Giá gia công")}
            ${allOk?'<div style="font-size:11px;color:var(--green-text);margin-top:6px">✓ Đủ điều kiện — INV sẽ tự cộng vào LC</div>':'<div style="font-size:11px;color:var(--amber-text);margin-top:6px">⚠ Còn thiếu — vẫn gán được nhưng INV chưa cộng vào LC</div>'}
          </div>`;
        })()}
        ${opts}
        <label style="display:flex;align-items:center;gap:8px;padding:8px;cursor:pointer;color:var(--text-muted)">
          <input type="radio" name="assign-lc" value="" ${!s.lcId?"checked":""}> Không gán LC
        </label>
        <div class="form-footer">
          <button class="btn" onclick="closeModalById('modal-assign-lc')">Hủy</button>
          <button class="btn btn-primary" onclick="saveAssignLC('${shipId}')"><i class="ti ti-check"></i> Lưu</button>
        </div>`;
    }
  }
  document.getElementById("assign-lc-body").innerHTML = body;
  openModal("modal-assign-lc");
};

window.saveAssignLC = async function(shipId) {
  const sel = document.querySelector('input[name="assign-lc"]:checked');
  const lcId = sel ? sel.value : "";
  const s = allShipments.find(x=>x.id===shipId);

  // Nếu gán LC (không phải bỏ gán) → kiểm tra điều kiện để INV được cộng vào LC
  if (lcId && s) {
    const missing = [];
    const exported = (s.checklist||{})[8]==="done" || (s.checklist||{})[8]==="skip";
    if (!exported) missing.push("Lô chưa làm tờ khai Hải quan (bước 8)");
    if (!s.invoiceNo) missing.push("Chưa có Số hóa đơn (Invoice No.)");
    if (!s.invoiceDate) missing.push("Chưa có Ngày hóa đơn");
    const noPrice = (s.orders||[]).some(o => !(parseFloat(o.unitPrice)>0));
    if (noPrice) missing.push("Có mã hàng chưa nhập Giá gia công");

    if (missing.length) {
      const ok = confirm(
        "⚠️ Lô này được gán LC nhưng INV CHƯA được cộng vào LC vì còn thiếu:\n\n• " +
        missing.join("\n• ") +
        "\n\nINV sẽ tự động cộng vào LC khi bổ sung đủ các thông tin trên.\n\nVẫn lưu việc gán LC?"
      );
      if (!ok) return;
    }
  }

  await updateDoc(doc(db,"shipments",shipId), { lcId: lcId || null });
  closeModal("modal-assign-lc");
  showToast(lcId ? "Đã gán LC cho lô hàng!" : "Đã bỏ gán LC.");
};

// ====== PACKING LIST ======
window.openPackingList = async function(shipId) {
  const s = allShipments.find(x=>x.id===shipId);
  if (!s) return;

  // Lấy thông tin khách hàng
  const firstCust = (s.orders||[])[0]?.customer;
  let cust = {};
  if (firstCust) {
    try {
      const { collection:col, query:q, where, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const snap = await getDocs(q(col(db,"customers"), where("name","==",firstCust)));
      if (!snap.empty) cust = snap.docs[0].data();
    } catch(e){}
  }

  const orders = s.orders || [];
  const totalCtns = orders.reduce((a,o)=>a+(parseFloat(o.ctns)||0),0);
  const totalPcs  = orders.reduce((a,o)=>a+(parseFloat(o.qty)||0),0);
  const totalGW   = orders.reduce((a,o)=>a+(parseFloat(o.kgTotal)||0),0);  // kgTotal = GW
  // Net Weight = Σ (GW từng dòng − tare thùng × số thùng của dòng đó)
  const totalNW = orders.reduce((a,o)=>{
    const gw = parseFloat(o.kgTotal)||0, tare = parseFloat(o.tareCtn)||0, ct = parseFloat(o.ctns)||0;
    return a + (gw - tare*ct);
  }, 0);
  const totalCBM  = orders.reduce((a,o)=>a+(parseFloat(o.cbm)||0),0);

  // Container: tare lấy sẵn từ lô hàng (nhập ở "Sửa lô hàng")
  const conts = (s.containers && s.containers.length) ? s.containers
              : (s.contNo||s.sealNo) ? [{type:"",no:s.contNo,seal:s.sealNo,tare:0}] : [];
  const totalTareCont = conts.reduce((a,c)=>a+(parseFloat(c.tare)||0),0);
  let contData;
  if (conts.length === 1) {
    const c = conts[0];
    const tare = parseFloat(c.tare)||0;
    contData = [{ label:`01 X ${c.type||s.container||""}: ${c.no||""} / ${c.seal||""}`, tare, gw: totalGW, vgm: Math.round(totalGW+tare) }];
  } else if (conts.length > 1) {
    contData = conts.map((c,i) => {
      const tare = parseFloat(c.tare)||0;
      const gw = parseFloat(c.gw)||0;
      return { label:`${String(i+1).padStart(2,"0")} X ${c.type||""}: ${c.no||""} / ${c.seal||""}`, tare, gw: gw||null, vgm: gw?Math.round(gw+tare):null };
    });
    const sumGw = conts.reduce((a,c)=>a+(parseFloat(c.gw)||0),0);
    const gwTot = sumGw || totalGW;
    contData.push({ label:"TOTAL", tare: totalTareCont, gw: gwTot, vgm: Math.round(gwTot+totalTareCont), isTotal:true });
  } else {
    contData = [{ label:`${s.container||""}`, tare:0, gw: totalGW, vgm:0 }];
  }
  const vgm = Math.round(totalGW + totalTareCont);

  // TERM OF PAYMENT: mặc định T/T; khách có L/C thì hỏi (1 cú bấm)
  const U = (firstCust||"").toUpperCase();
  const isLcCust = ["MITSUWA","SANMARINO","ACROS","HEMD"].some(n => U.includes(n));
  let term = "T/T";
  if (isLcCust) {
    const useLC = confirm(`Khách hàng "${firstCust}" có L/C.\n\nLô này thanh toán bằng L/C?\n\n• OK = L/C\n• Cancel = T/T`);
    term = useLC ? "L/C" : "T/T";
  }

  renderPackingA4(s, cust, { invoice:s.invoiceNo||"", invDate:s.invoiceDate||"", term, contData,
    totalCtns, totalPcs, totalGW, totalNW, totalCBM, vgm });
};

// Tên file PDF: bỏ "/", đổi "-" thành cách, bỏ ký tự cấm. VD "485/26-TOYOTA" -> "Packing list 48526 TOYOTA"
function pdfFileName(prefix, inv) {
  const clean = (inv||"").replace(/\//g,"").replace(/-/g," ").replace(/[\\:*?"<>|]/g,"").replace(/\s+/g," ").trim();
  return clean ? `${prefix} ${clean}` : prefix;
}

function renderPackingA4(s, cust, p) {
  const fmtNum = (n, dec=2) => Number(n).toLocaleString("en-US",{minimumFractionDigits:dec, maximumFractionDigits:dec});
  const fmtInt = (n) => Math.round(n).toLocaleString("en-US");
  const dateStr = p.invDate ? new Date(p.invDate).toLocaleDateString("en-US",{month:"short",day:"2-digit",year:"numeric"}).toUpperCase() : "";
  const etdStr  = s.etd ? new Date(s.etd).toLocaleDateString("en-US",{month:"long",day:"2-digit",year:"numeric"}) : "";

  // Rows đơn hàng
  const rows = (s.orders||[]).map(o => `
    <tr>
      <td style="padding:2px 4px">${o.contract||""}</td>
      <td style="padding:2px 4px">${o.index||o.items||""}</td>
      <td style="text-align:right;padding:2px 4px">${o.ctns?fmtInt(o.ctns):""}</td>
      <td style="text-align:right;padding:2px 4px">${o.qty?fmtInt(o.qty):""}</td>
      <td style="text-align:right;padding:2px 4px">${o.kgTotal?fmtNum((parseFloat(o.kgTotal)||0)-((parseFloat(o.tareCtn)||0)*(parseFloat(o.ctns)||0))):""}</td>
      <td style="text-align:right;padding:2px 4px">${o.kgTotal?fmtNum(o.kgTotal):""}</td>
      <td style="text-align:right;padding:2px 4px">${o.cbm?fmtNum(o.cbm):""}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Times New Roman", serif; font-size: 12px; color:#000; margin:0; }
  .pl-header { text-align:center; position:relative; border-bottom:0; }
  .company-name { font-size:15px; font-weight:bold; }
  .company-info { font-size:10px; }
  .logo { position:absolute; left:0; top:0; font-size:20px; font-weight:bold; font-style:italic; }
  .title { text-align:center; font-size:20px; font-weight:bold; margin:10px 0; }
  table.info { width:100%; border-collapse:collapse; }
  table.info td { border:1px solid #000; padding:4px 6px; vertical-align:top; font-size:11px; }
  .label { font-weight:bold; font-size:10px; }
  table.goods { width:100%; border-collapse:collapse; margin-top:0; }
  table.goods th, table.goods td { border:1px solid #000; font-size:11px; }
  table.goods th { padding:3px; background:#f0f0f0; font-size:10px; }
  .totals td { font-weight:bold; }
  .footer-sign { margin-top:30px; text-align:right; padding-right:40px; }
  @media print { .no-print { display:none; } }
</style></head><body>

<div class="pl-header">
  <div class="logo">TOS GAMEX</div>
  <div class="company-name">TOMIYA SUMMIT GARMENT EXPORT CO., LTD</div>
  <div class="company-info">LOT B1, LONG BINH TECHNO PARK (LOTECO) EPZ, LONG BINH WARD, DONG NAI CITY, VIETNAM</div>
  <div class="company-info">TEL: 84 - 251- 3992537&nbsp;&nbsp;&nbsp;&nbsp;FAX: 84 - 251- 3992540</div>
</div>

<div class="title">PACKING LIST/ WEIGHT LIST</div>

<table class="info">
  <tr>
    <td style="width:55%"><span class="label">MESSRS :</span><br><span style="white-space:pre-line">${cust.messrs||""}</span></td>
    <td><span class="label">INVOICE NO. AND DATE</span><br>${p.invoice||""} &nbsp;&nbsp;&nbsp; ${dateStr}<br><br><span class="label">TERM OF PAYMENT</span><br>${p.term||"T/T"}</td>
  </tr>
  <tr>
    <td><span class="label">CONSIGNEE:</span><br><span style="white-space:pre-line">${cust.consignee||""}</span></td>
    <td><span class="label">REFERENCE:</span><br>${cust.hdgc||""}<br><br><span class="label">BK NO.:</span> ${s.booking||""}</td>
  </tr>
  <tr>
    <td><span class="label">FROM:</span> HOCHIMINH, VIETNAM &nbsp;&nbsp; <span class="label">TO:</span> ${fullPort(s.port)}, JAPAN</td>
    <td><span class="label">VESSEL / FLIGHT NO.</span> ${s.vessel||""}<br><span class="label">DEPARTURE DATE:</span> ${etdStr}</td>
  </tr>
</table>

<table class="goods">
  <thead>
    <tr>
      <th colspan="2" style="width:48%">GOODS DESCRIPTION</th>
      <th>NO. OF CTNS</th><th>Q'TY ( PCS )</th><th>N.W (KGS)</th><th>G.W (KGS)</th><th>CBM</th>
    </tr>
  </thead>
  <tbody>
    <tr><td colspan="2" style="font-weight:bold;padding:4px">${cust.description||"SHIRTS"}</td><td></td><td></td><td></td><td></td><td></td></tr>
    ${rows}
    <tr class="totals">
      <td colspan="2" style="padding:4px">TOTAL</td>
      <td style="text-align:right;padding:2px 4px">${fmtInt(p.totalCtns)}</td>
      <td style="text-align:right;padding:2px 4px">${fmtInt(p.totalPcs)}</td>
      <td style="text-align:right;padding:2px 4px">${fmtNum(p.totalNW)}</td>
      <td style="text-align:right;padding:2px 4px">${fmtNum(p.totalGW)}</td>
      <td style="text-align:right;padding:2px 4px">${fmtNum(p.totalCBM)}</td>
    </tr>
  </tbody>
</table>

<table class="goods" style="margin-top:10px">
  <thead><tr><th style="width:55%;text-align:left;padding:3px 6px">CTN NO.</th><th>Tare</th><th>GW</th><th>VGM</th></tr></thead>
  <tbody>
    ${(p.contData||[]).map(cd => `<tr${cd.isTotal?' class="totals"':''}>
      <td style="font-weight:bold;padding:3px 6px">${cd.label}</td>
      <td style="text-align:right;padding:2px 4px">${cd.tare?fmtNum(cd.tare):""}</td>
      <td style="text-align:right;padding:2px 4px">${cd.gw?fmtNum(cd.gw):""}</td>
      <td style="text-align:right;padding:2px 4px">${cd.vgm?fmtInt(cd.vgm):""}</td>
    </tr>`).join("")}
  </tbody>
</table>

<div class="footer-sign">
  <div style="font-weight:bold">TOMIYA SUMMIT GARMENT EXPORT CO.,LTD</div>
  <div style="margin-top:40px;font-weight:bold">NGUYEN THI OANH</div>
  <div style="font-weight:bold">IMP-EXP DEPT LEADER</div>
</div>

<div class="no-print" style="text-align:center;margin-top:20px">
  <button onclick="window.print()" style="padding:10px 24px;font-size:14px;cursor:pointer;background:#1a1a1a;color:#fff;border:none;border-radius:6px">🖨 In / Lưu PDF</button>
</div>
</body></html>`;

  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
  w.document.title = pdfFileName("Packing list", p.invoice);
}

// ====== XUẤT VGM ======
window.openVGM = function(shipId) {
  const s = allShipments.find(x=>x.id===shipId);
  if (!s) return;
  const C = (s.container||"").toUpperCase();
  if (C.includes("AIR") || C.includes("CPN") || C.includes("KNQ")) { showToast("Hàng AIR/CPN/KNQ không cần VGM."); return; }
  const isLcl = C.includes("LCL");

  const orders = s.orders || [];
  const totalGW   = orders.reduce((a,o)=>a+(parseFloat(o.kgTotal)||0),0);
  const totalCtns = orders.reduce((a,o)=>a+(parseFloat(o.ctns)||0),0);
  const now = new Date();
  const dateStr = `Long Bình, ngày ${now.getDate()} tháng ${now.getMonth()+1} năm ${now.getFullYear()}`;
  const fmt = n => Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});

  const css = `@page{size:A4 landscape;margin:12mm;} *{box-sizing:border-box;}
    body{font-family:"Times New Roman",serif;font-size:13px;color:#1f3864;margin:0;}
    .center{text-align:center;} .title{font-weight:bold;font-size:15px;margin-top:6px;}
    .title-en{font-weight:bold;font-style:italic;font-size:14px;}
    table.vgm{width:100%;border-collapse:collapse;margin-top:10px;}
    table.vgm th,table.vgm td{border:1px solid #1f3864;padding:5px;font-size:12px;vertical-align:middle;height:26px;}
    table.vgm th{font-weight:bold;text-align:center;} td.c{text-align:center;}
    @media print{.no-print{display:none;}}`;
  const printBtn = `<div class="no-print center" style="margin-top:20px"><button onclick="window.print()" style="padding:10px 24px;font-size:14px;cursor:pointer;background:#1a1a1a;color:#fff;border:none;border-radius:6px">🖨 In / Lưu PDF</button></div>`;
  const signCont = `<table style="width:100%;margin-top:14px"><tr>
    <td class="center" style="width:50%"><b>ĐƠN VỊ CÂN<br>WEIGHING SCALE</b><br><span style="font-style:italic">(ký, ghi rõ họ tên)<br>(signed full name, stamped)</span><div style="margin-top:50px"><b>NGUYEN QUOC THI</b><br><b>IMP-EXP DEPT</b></div></td>
    <td class="center" style="width:50%"><b>NGƯỜI GỬI HÀNG<br>SHIPPER</b><br><span style="font-style:italic">(ký, ghi rõ họ tên)<br>(signed full name, stamped)</span><div style="margin-top:50px"><b>NGUYEN QUOC THI</b><br><b>IMP-EXP DEPT</b></div></td>
  </tr></table>`;

  let html;
  if (isLcl) {
    html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>
<div class="center title">BẢN XÁC NHẬN KHỐI LƯỢNG HÀNG HÓA VẬN CHUYỂN QUỐC TẾ</div>
<div class="center title-en">VERIFIED GROSS MASS OF LCL CARGO ON INTERNATIONAL TRANSPORT</div>
<p style="margin-top:16px"><b>1. Tên người gửi hàng:</b> CÔNG TY TNHH TOMIYA SUMMIT GARMENT EXPORT<br><span style="font-style:italic">&nbsp;&nbsp;&nbsp;Name of shipper:</span></p>
<p><b>2. Khai báo thông tin và khối lượng toàn bộ LÔ HÀNG LCL đã đóng hàng:</b><br><span style="font-style:italic">LCL Cargo declaration/VGM of packed shipment</span></p>
<table class="vgm">
<thead><tr>
  <th style="width:12%">Số thứ tự<br>No.</th><th style="width:28%">Số booking<br>Booking no</th>
  <th style="width:20%">Loại bao bì<br>Package type</th><th style="width:18%">Số kiện<br>Number of Package</th>
  <th style="width:22%">Tổng trọng lượng<br>VGM (KG)</th>
</tr></thead>
<tbody>
  <tr><td class="c">1</td><td class="c"><b>${s.booking||""}</b></td><td class="c">CARTON</td><td class="c">${totalCtns}</td><td class="c">${fmt(totalGW)}</td></tr>
  <tr><td></td><td></td><td></td><td></td><td></td></tr>
  <tr><td class="c">...</td><td></td><td></td><td></td><td></td></tr>
  <tr><td class="c"><b>Total</b></td><td></td><td></td><td></td><td class="c"><b>${fmt(totalGW)}</b></td></tr>
</tbody>
</table>
<p style="margin-top:14px">Chúng tôi cam kết và chịu trách nhiệm việc xác nhận khối lượng toàn bộ lô hàng trên là đúng sự thật.<br>We are committed to and responsible for VGM of the above mentioned LCL shipment (s) is true.</p>
<p style="margin:14px 0 0">Ghi chú/Note:</p>
<p style="margin:4px 0">1. Thời hạn cung cấp VGM :</p>
<p style="margin:4px 0">2. Thời hạn chỉnh sửa VGM:</p>
${signCont}
${printBtn}
</body></html>`;
  } else {
    const conts = (s.containers && s.containers.length) ? s.containers
                : (s.contNo||s.sealNo) ? [{type:"",no:s.contNo,tare:0}] : [];
    const sizeMap = { "20GP":"20'GP", "40HC":"40'HC", "40DC":"40'DC" };
    const maxMap  = { "20GP":30480, "40HC":32500, "40DC":32500 };
    const rows = conts.map((c,i) => {
      const gw   = conts.length === 1 ? totalGW : (parseFloat(c.gw)||0);
      const tare = parseFloat(c.tare)||0;
      const vgm  = gw + tare;
      const size = sizeMap[c.type] || c.type || "";
      const mx   = maxMap[c.type] || 0;
      return `<tr><td class="c">${i+1}</td><td class="c">${c.no||""}</td><td class="c">${size}</td><td class="c">${mx?fmt(mx)+" KGS":""}</td><td class="c">${fmt(vgm)} KGS</td><td></td></tr>`;
    }).join("");
    let extra = "";
    for (let k = conts.length; k < 3; k++) extra += `<tr><td class="c">${k+1}</td><td></td><td></td><td></td><td></td><td></td></tr>`;
    extra += `<tr><td class="c">...</td><td></td><td></td><td></td><td></td><td></td></tr>`;
    html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>
<div class="center">Biểu mẫu</div>
<div class="center">(Ban hành kèm theo Văn bản số 2428/CHHVN-VTDVHH</div>
<div class="center">Ngày 15 tháng 6 năm 2016 của Cục Hàng hải Việt Nam</div>
<div class="center">--------------------</div>
<div class="center title">XÁC NHẬN KHỐI LƯỢNG TOÀN BỘ CÔNG-TE-NƠ VẬN CHUYỂN QUỐC TẾ</div>
<div class="center title-en">VERIFIED GROSS MASS OF CONTAINER ON INTERNATIONAL TRANSPORT (VGM)</div>
<div style="text-align:right;margin-top:10px">${dateStr}</div>
<p style="margin-top:8px"><b>1. Tên người gửi hàng, địa chỉ, số điện thoại /Name of Shipper, address, phone number:</b></p>
<div style="padding-left:16px">CÔNG TY TNHH TOMIYA SUMMIT GARMENT EXPORT<br>LÔ B1, KCX LONG BÌNH, PHƯỜNG LONG BÌNH, THÀNH PHỐ ĐỒNG NAI.<br>ĐIỆN THOẠI: 0251.3992537</div>
<p style="margin-top:10px"><b>2. Thông số công-te-nơ/ Container's particular :</b></p>
<table class="vgm">
<thead><tr>
  <th style="width:6%">Stt<br>Seq</th>
  <th style="width:18%">Số Công-te-nơ<br>Container no.</th>
  <th style="width:16%">Kích cỡ công-te-nơ<br>Size of container<br>(20'/40'/other)</th>
  <th style="width:20%">Khối lượng sử dụng lớn nhất<br>Max gross weight (kg)</th>
  <th style="width:22%">Xác nhận khối lượng toàn bộ công-te-nơ<br>Verified gross mass of a packed container (kg)</th>
  <th style="width:18%">Tên đơn vị, địa chỉ cân<br>Name of weighing scale, Address</th>
</tr></thead>
<tbody>${rows}${extra}</tbody>
</table>
<p style="margin-top:12px">Chúng tôi cam kết và chịu trách nhiệm việc xác nhận khối lượng toàn bộ công-te-nơ trên là đúng sự thật.<br>We are committed to and responsible for VGM of the above mentioned container(s) is true.</p>
${signCont}
${printBtn}
</body></html>`;
  }
  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
  w.document.title = pdfFileName("VGM", s.invoiceNo);
};

// ====== SHIPPING MARK (ghi chú theo lô, copy được) ======
window.openShipMark = function(shipId) {
  const s = allShipments.find(x=>x.id===shipId);
  if (!s) return;
  const safe = (s.shipMark||"").replace(/&/g,"&amp;").replace(/</g,"&lt;");
  document.getElementById("shipmark-body").innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Gõ hoặc dán shipping mark cho lô này (giữ nguyên khoảng trắng như Excel). Bấm <b>Lưu</b> để lưu theo lô, <b>Copy</b> để chép cả khối.</div>
    <textarea id="sm-text" spellcheck="false" style="width:100%;min-height:240px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;white-space:pre;padding:10px 12px;border:0.5px solid var(--border-md);border-radius:var(--radius-md);background:var(--bg-card)">${safe}</textarea>
    <div class="form-footer" style="justify-content:space-between">
      <button type="button" class="btn" id="sm-copy"><i class="ti ti-copy"></i> Copy</button>
      <div style="display:flex;gap:8px">
        <button type="button" class="btn" onclick="closeModalById('modal-shipmark')">Đóng</button>
        <button type="button" class="btn btn-primary" id="sm-save"><i class="ti ti-device-floppy"></i> Lưu</button>
      </div>
    </div>`;
  document.getElementById("sm-copy").addEventListener("click", () => {
    const ta = document.getElementById("sm-text");
    ta.select(); ta.setSelectionRange(0, ta.value.length);
    try { document.execCommand("copy"); } catch(e){}
    if (navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(()=>{});
    showToast("Đã copy shipping mark!");
  });
  document.getElementById("sm-save").addEventListener("click", async () => {
    await updateDoc(doc(db,"shipments",shipId), { shipMark: document.getElementById("sm-text").value });
    closeModal("modal-shipmark");
    showToast("Đã lưu shipping mark!");
  });
  openModal("modal-shipmark");
};

// ====== BÁO CÁO ======
document.getElementById("btn-reports").addEventListener("click", () => {
  const now = new Date();
  document.getElementById("rp-month").value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  document.getElementById("rp-asof").value = now.toISOString().slice(0,10);
  document.getElementById("rp-date-wrap").style.display = "block";
  openModal("modal-reports");
});

function shipmentsOfMonth(month) {
  // month = "YYYY-MM"; lọc theo period, nếu không có period thì theo stuffingDate
  return allShipments.filter(s => {
    if (s.period) return s.period === month;
    if (s.stuffingDate) return s.stuffingDate.slice(0,7) === month;
    return false;
  });
}

function totalGW(s){ return (s.orders||[]).reduce((a,o)=>a+(parseFloat(o.kgTotal)||0),0); }
function totalCBM(s){ return (s.orders||[]).reduce((a,o)=>a+(parseFloat(o.cbm)||0),0); }

// --- BÁO CÁO BỐC XẾP ---
window.reportBocXep = function() {
  const month = document.getElementById("rp-month").value;
  if (!month) { showToast("Chọn tháng!"); return; }
  let list = shipmentsOfMonth(month);
  if (!list.length) { showToast("Không có lô hàng trong tháng này!"); return; }
  // sắp theo ngày đóng hàng
  list = [...list].sort((a,b)=>(a.stuffingDate||"9999")<(b.stuffingDate||"9999")?-1:1);
  const [y,mo] = month.split("-");

  const rows = list.map((s,i) => {
    const cont = (s.container||"").toUpperCase();
    let hinhthuc = s.container || "—";
    // Nếu là container thật → ghi loại + cont/seal
    const isAir = cont.includes("AIR");
    const isLcl = cont.includes("LCL");
    if (!isAir && !isLcl) {
      const conts = (s.containers && s.containers.length) ? s.containers
                  : (s.contNo||s.sealNo) ? [{type:"",no:s.contNo,seal:s.sealNo}] : [];
      if (conts.length) {
        hinhthuc = `${s.container||""}<br><span style="font-size:10px">${conts.map(c=>`${c.type?c.type+" ":""}${c.no||"—"}/${c.seal||"—"}`).join("<br>")}</span>`;
      }
    }
    const custs = [...new Set((s.orders||[]).map(o=>o.customer).filter(Boolean))].join(", ");
    return `<tr>
      <td style="text-align:center">${i+1}</td>
      <td>${fmtDateVN(s.stuffingDate)}</td>
      <td>${custs} — ${fullPort(s.port)}</td>
      <td style="text-align:right">${Math.round(totalGW(s)).toLocaleString()}</td>
      <td style="text-align:right">${(Math.round(totalCBM(s)*100)/100).toLocaleString()}</td>
      <td>${hinhthuc}</td>
    </tr>`;
  }).join("");

  const sumGW = Math.round(list.reduce((a,s)=>a+totalGW(s),0));
  const sumCBM = Math.round(list.reduce((a,s)=>a+totalCBM(s),0)*100)/100;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: "Times New Roman", serif; font-size: 13px; margin:0; }
  h2 { text-align:center; margin:4px 0; }
  .sub { text-align:center; font-size:12px; margin-bottom:14px; }
  table { width:100%; border-collapse:collapse; }
  th,td { border:1px solid #000; padding:5px 7px; }
  th { background:#e8e8e8; font-size:12px; }
  tfoot td { font-weight:bold; background:#f5f5f5; }
  .company { font-size:12px; }
  @media print { .no-print{display:none;} }
</style></head><body>
<div class="company"><b>CTY TNHH TOMIYA SUMMIT GARMENT EXPORT</b><br>Phòng Xuất Nhập Khẩu</div>
<h2>BÁO CÁO BỐC XẾP</h2>
<div class="sub">Tháng ${mo}/${y}</div>
<table>
  <thead><tr>
    <th style="width:40px">STT</th><th style="width:110px">Ngày đóng hàng</th>
    <th>Khách hàng — Cảng</th><th style="width:110px">G.W (KGS)</th>
    <th style="width:90px">CBM</th><th style="width:200px">Hình thức xuất</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr>
    <td colspan="3" style="text-align:right">TỔNG CỘNG</td>
    <td style="text-align:right">${sumGW.toLocaleString()}</td>
    <td style="text-align:right">${sumCBM.toLocaleString()}</td>
    <td></td>
  </tr></tfoot>
</table>
<div style="margin-top:30px;text-align:right;padding-right:40px">
  <div>Ngày ${new Date().getDate()} tháng ${new Date().getMonth()+1} năm ${new Date().getFullYear()}</div>
  <div style="margin-top:6px">Lập bởi: Phòng XNK</div>
  <div style="margin-top:40px;font-weight:bold">NGUYEN QUOC THI</div>
</div>
<div class="no-print" style="text-align:center;margin-top:20px">
  <button onclick="window.print()" style="padding:10px 24px;font-size:14px;cursor:pointer;background:#1a1a1a;color:#fff;border:none;border-radius:6px">🖨 In / Lưu PDF</button>
</div>
</body></html>`;
  closeModal("modal-reports");
  const w = window.open("","_blank"); w.document.write(html); w.document.close();
};

// --- BÁO CÁO NGUỒN THU (xuất Excel) ---
window.reportNguonThu = function() {
  const month = document.getElementById("rp-month").value;
  const asOf  = document.getElementById("rp-asof").value;
  if (!month) { showToast("Chọn tháng!"); return; }
  let list = shipmentsOfMonth(month);
  if (!list.length) { showToast("Không có lô hàng trong tháng này!"); return; }
  const [y,mo] = month.split("-");

  const isExported = s => (s.checklist||{})[8] === "done" || (s.checklist||{})[8] === "skip";

  // Nhóm theo khách hàng
  const byCustomer = {};
  list.forEach(s => {
    const cust = [...new Set((s.orders||[]).map(o=>o.customer).filter(Boolean))][0] || "KHÁC";
    if (!byCustomer[cust]) byCustomer[cust] = [];
    byCustomer[cust].push(s);
  });

  // Xây mảng AOA (array of arrays) cho Excel
  const aoa = [];
  aoa.push(["CTY TNHH TOMIYA SUMMIT GARMENT EXPORT"]);
  aoa.push(["Phòng Xuất Nhập Khẩu"]);
  aoa.push([`BÁO CÁO NGUỒN THU - Tháng ${mo}/${y}${asOf?` (tính đến ${fmtDateVN(asOf)})`:""}`]);
  aoa.push([]);
  aoa.push(["Stt","P.thức giao","P.thức TT","Số & ngày hóa đơn","Hợp đồng","Mã hàng","ĐVT","Số lượng","Đơn giá (USD)","Thành tiền (USD)","Ngày xuất","Ngày tàu chạy"]);

  let stt = 0, grandQty = 0, grandAmount = 0;

  Object.keys(byCustomer).sort().forEach(cust => {
    stt++;
    const shipments = byCustomer[cust];
    aoa.push([stt, `${cust}`]);

    const exported = shipments.filter(isExported);
    const planned  = shipments.filter(s=>!isExported(s));
    let custQty = 0, custAmount = 0;
    const multiShip = shipments.length > 1;

    const renderGroup = (groupShipments, label) => {
      if (!groupShipments.length) return;
      aoa.push(["", label]);
      groupShipments.forEach(s => {
        const orders = s.orders||[];
        let shipQty = 0, shipAmount = 0;
        orders.forEach((o,idx) => {
          const qty = parseFloat(o.qty)||0;
          const price = parseFloat(o.unitPrice)||0;
          const amount = Math.round(qty*price*100)/100;  // ROUND(x,2)
          shipQty += qty; shipAmount = Math.round((shipAmount+amount)*100)/100;
          custQty += qty; custAmount = Math.round((custAmount+amount)*100)/100;
          aoa.push([
            "", idx===0?"FOB":"", idx===0?"T/T":"",
            idx===0?`${s.invoiceNo||s.booking||""}${s.stuffingDate?` (${fmtDateVN(s.stuffingDate)})`:""}`:"",
            o.contract||"", `${o.items||""}${o.index?`(${o.index})`:""}`, "Cái",
            qty, price||"", amount||"",
            idx===0?fmtDateVN(s.stuffingDate):'"', idx===0?fmtDateVN(s.etd):'"'
          ]);
        });
        // dòng tổng từng lô (nếu khách có nhiều lô)
        if (multiShip) {
          aoa.push(["","","","","","Tổng lô","",shipQty,"",shipAmount,"",""]);
        }
      });
    };
    renderGroup(exported, "Đã xuất");
    renderGroup(planned, `Dự kiến xuất trong tháng ${mo}/${y}`);

    aoa.push(["","","","","","CỘNG "+cust,"",custQty,"",custAmount,"",""]);
    grandQty += custQty; grandAmount = Math.round((grandAmount+custAmount)*100)/100;
  });

  aoa.push(["","","","","","TỔNG CỘNG","",grandQty,"",grandAmount,"",""]);
  aoa.push([]);
  aoa.push(["","","","","","","","","","Lập bởi: Phòng XNK","",""]);
  aoa.push(["","","","","","","","","","NGUYEN QUOC THI","",""]);

  // Tạo workbook
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{wch:5},{wch:11},{wch:9},{wch:22},{wch:12},{wch:26},{wch:6},{wch:10},{wch:11},{wch:13},{wch:12},{wch:12}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Nguồn thu");
  XLSX.writeFile(wb, `BaoCao_NguonThu_${mo}-${y}.xlsx`);

  closeModal("modal-reports");
  showToast("Đã xuất file Excel! Mở file để sửa & in.");
};

function fmtDateVN(str) {
  if (!str) return "—";
  const d = new Date(str);
  if (isNaN(d)) return str;
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}

// ====== LỊCH (TRANG CHỦ) ======
let calMonth = new Date().getFullYear() + "-" + String(new Date().getMonth()+1).padStart(2,"0");

function showCalendar() {
  document.getElementById("calendar-view").style.display = "block";
  document.getElementById("list-view").style.display = "none";
  renderCutoffWarnings();
  renderCalendar();
}
function showListView() {
  document.getElementById("calendar-view").style.display = "none";
  document.getElementById("list-view").style.display = "block";
  renderList();
}

// ====== CẢNH BÁO CẮT MÁNG ======
function renderCutoffWarnings() {
  const box = document.getElementById("cutoff-warning");
  if (!box) return;
  if (!isLoggedIn()) { box.innerHTML = ""; return; }
  const now = new Date();
  const items = [];
  allShipments.forEach(s => {
    if (!s.cyCut) return;                                   // không có ngày cắt máng (AIR/LCL) → bỏ
    const ck = s.checklist || {};
    if (ck[8] === "done" || ck[8] === "skip") return;       // đã làm tờ khai → bỏ
    const dt = new Date(s.cyCut + "T" + (s.cyCutTime || "23:59"));
    if (isNaN(dt)) return;
    const diffH = (dt - now) / 3600000;
    if (diffH > 48) return;                                 // còn xa hơn 48h → chưa cảnh báo
    if (diffH < -168) return;                               // quá hạn > 7 ngày → coi như tồn cũ, bỏ
    items.push({ s, dt, diffH });
  });
  if (!items.length) { box.innerHTML = ""; return; }
  items.sort((a,b) => a.dt - b.dt);

  const rows = items.map(({s, dt, diffH}) => {
    const cust = (s.orders||[])[0]?.customer || "—";
    const port = s.port || "";
    const overdue = diffH < 0;
    const hrs = Math.round(Math.abs(diffH));
    const pill = overdue
      ? `color:var(--red-text);background:var(--red-bg)`
      : `color:var(--amber-text);background:var(--bg-card);border:0.5px solid var(--amber-border)`;
    const icon = overdue ? "ti-clock-exclamation" : "ti-clock";
    const iconColor = overdue ? "var(--red-text)" : "var(--amber-text)";
    const dd = String(dt.getDate()).padStart(2,"0") + "/" + String(dt.getMonth()+1).padStart(2,"0");
    const tt = s.cyCutTime ? " " + s.cyCutTime : "";
    return `<div onclick="gotoShipment('${s.id}')" style="display:flex;align-items:center;gap:12px;background:var(--bg-card);border:0.5px solid var(--border);border-radius:var(--radius-md);padding:10px 12px;cursor:pointer">
      <i class="ti ${icon}" style="font-size:18px;color:${iconColor}"></i>
      <div style="min-width:0">
        <div style="font-size:14px;font-weight:500;color:var(--text)">${cust} — ${port}</div>
        <div style="font-size:12px;color:var(--text-muted)">Cắt máng ${dd}${tt} · INV ${s.invoiceNo||"—"}</div>
      </div>
      <span style="margin-left:auto;flex-shrink:0;font-size:12px;font-weight:500;padding:3px 10px;border-radius:20px;${pill}">${overdue?`Quá hạn ${hrs} giờ`:`Còn ${hrs} giờ`}</span>
    </div>`;
  }).join("");

  box.innerHTML = `<div style="background:var(--amber-bg);border:0.5px solid var(--amber-border);border-radius:var(--radius-lg);padding:14px 16px;margin-bottom:16px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <i class="ti ti-alert-triangle" style="font-size:20px;color:var(--amber-text)"></i>
      <span style="font-size:15px;font-weight:500;color:var(--amber-text)">Sắp cắt máng — chưa làm tờ khai</span>
      <span style="margin-left:auto;font-size:12px;font-weight:500;color:var(--amber-text);background:var(--bg-card);border:0.5px solid var(--amber-border);padding:2px 10px;border-radius:20px">${items.length} lô</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">${rows}</div>
  </div>`;
}

window.gotoShipment = function(id) {
  ["filter-status","filter-month","filter-customer","filter-invoice"].forEach(fid => {
    const el = document.getElementById(fid); if (el) el.value = "";
  });
  openShipmentPopup(id);
};

document.getElementById("btn-home").addEventListener("click", showCalendar);
document.getElementById("btn-nav-list").addEventListener("click", showListView);
document.getElementById("btn-back-calendar").addEventListener("click", showCalendar);

function renderCalendar() {
  const [y, m] = calMonth.split("-").map(Number);
  const box = document.getElementById("calendar-box");
  const todayStr = new Date().toISOString().slice(0,10);

  // Gom sự kiện theo ngày: đóng hàng (stuffingDate) + tàu chạy (etd)
  const events = {}; // "YYYY-MM-DD" -> [{type, ship}]
  allShipments.forEach(s => {
    if (s.stuffingDate) { (events[s.stuffingDate]=events[s.stuffingDate]||[]).push({type:"pack", s}); }
    if (s.etd)          { (events[s.etd]=events[s.etd]||[]).push({type:"ship", s}); }
  });

  const firstDay = new Date(y, m-1, 1);
  const startDow = firstDay.getDay(); // 0=CN
  const daysInMonth = new Date(y, m, 0).getDate();
  const prevDays = new Date(y, m-1, 0).getDate();

  const dows = ["CN","T2","T3","T4","T5","T6","T7"];
  let cells = "";

  // Hàm tạo nhãn sự kiện cho 1 ngày
  function tagsFor(dateStr) {
    const evs = events[dateStr] || [];
    return evs.map(e => {
      const custs = [...new Set((e.s.orders||[]).map(o=>o.customer).filter(Boolean))].join(", ") || "—";
      const inv = e.s.invoiceNo || e.s.booking || "";
      const icon = e.type==="pack" ? "package" : "ship";
      return `<div class="cal-tag ${e.type}" onclick="openShipmentPopup('${e.s.id}')">
        <i class="ti ti-${icon}"></i> ${custs}${inv?`<br><span style="opacity:0.85">${inv}</span>`:""}
      </div>`;
    }).join("");
  }

  // Ô tháng trước (vẫn hiện sự kiện nếu có)
  for (let i=0; i<startDow; i++) {
    const d = prevDays - startDow + i + 1;
    const pm = m-1<1 ? 12 : m-1, py = m-1<1 ? y-1 : y;
    const dateStr = `${py}-${String(pm).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    cells += `<div class="cal-cell other"><div class="cal-daynum other">${d}</div>${tagsFor(dateStr)}</div>`;
  }
  // Ô trong tháng
  for (let d=1; d<=daysInMonth; d++) {
    const dateStr = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const dow = new Date(y, m-1, d).getDay();
    const isToday = dateStr === todayStr;
    const numHTML = isToday ? `<div class="cal-today-num">${d}</div>`
                  : `<div class="cal-daynum ${dow===0?'sun':''}">${d}</div>`;
    cells += `<div class="cal-cell ${isToday?'today':''}">${numHTML}${tagsFor(dateStr)}</div>`;
  }
  // Ô tháng sau (vẫn hiện sự kiện nếu có)
  const totalCells = startDow + daysInMonth;
  const trailing = (7 - (totalCells % 7)) % 7;
  for (let i=1; i<=trailing; i++) {
    const nm = m+1>12 ? 1 : m+1, ny = m+1>12 ? y+1 : y;
    const dateStr = `${ny}-${String(nm).padStart(2,"0")}-${String(i).padStart(2,"0")}`;
    cells += `<div class="cal-cell other"><div class="cal-daynum other">${i}</div>${tagsFor(dateStr)}</div>`;
  }

  box.innerHTML = `
    <div class="cal-wrap">
      <div class="cal-header">
        <button id="cal-prev"><i class="ti ti-chevron-left"></i></button>
        <div style="text-align:center">
          <div style="font-size:22px;font-weight:500;letter-spacing:1px">THÁNG ${m}</div>
          <div style="font-size:13px;opacity:0.85">${y}</div>
        </div>
        <button id="cal-next"><i class="ti ti-chevron-right"></i></button>
      </div>
      <div class="cal-legend">
        <span><i class="ti ti-package" style="color:#BA7517"></i> Đóng hàng</span>
        <span><i class="ti ti-ship" style="color:#185FA5"></i> Tàu chạy (ETD)</span>
        <button class="btn btn-sm" id="cal-today" style="margin-left:auto;padding:3px 10px">Hôm nay</button>
      </div>
      <div class="cal-grid">
        ${dows.map((dw,i)=>`<div class="cal-dow ${i===0?'sun':''}">${dw}</div>`).join("")}
        ${cells}
      </div>
    </div>`;

  document.getElementById("cal-prev").addEventListener("click", () => { calMonth = shiftMonth(calMonth,-1); renderCalendar(); });
  document.getElementById("cal-next").addEventListener("click", () => { calMonth = shiftMonth(calMonth,1); renderCalendar(); });
  document.getElementById("cal-today").addEventListener("click", () => {
    calMonth = new Date().getFullYear()+"-"+String(new Date().getMonth()+1).padStart(2,"0"); renderCalendar();
  });
}

function shiftMonth(ym, delta) {
  let [y,m] = ym.split("-").map(Number);
  m += delta;
  if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2,"0")}`;
}

// Popup chi tiết lô từ lịch — chuyển sang danh sách và mở card
window.openShipmentPopup = function(shipId) {
  showListView();
  setTimeout(() => {
    const card = document.getElementById("card-"+shipId);
    if (card) {
      const detail = document.getElementById("detail-"+shipId);
      const cv = document.getElementById("cv-"+shipId);
      if (detail && !detail.classList.contains("open")) { detail.classList.add("open"); cv?.classList.add("open"); }
      card.scrollIntoView({behavior:"smooth", block:"center"});
      card.style.transition = "box-shadow .3s";
      card.style.boxShadow = "0 0 0 3px #185FA5";
      setTimeout(()=>{ card.style.boxShadow = ""; }, 1600);
    }
  }, 100);
};

// ====== FIRESTORE REALTIME (chỉ chạy khi đã đăng nhập) ======
let _unsubShipments = null;
function startData() {
  if (_unsubShipments) return;
  const q = query(collection(db,"shipments"), orderBy("createdAt","desc"));
  _unsubShipments = onSnapshot(q, snap => {
    allShipments = snap.docs.map(d => ({id:d.id, ...d.data()}));
    renderList();
    renderCutoffWarnings();
    if (document.getElementById("calendar-view").style.display !== "none") renderCalendar();
  }, err => { console.warn("Firestore:", err.message); });
}
function stopData() {
  if (_unsubShipments) { _unsubShipments(); _unsubShipments = null; }
  allShipments = [];
}

// ====== BACKUP DỮ LIỆU ======
async function downloadBackup() {
  try {
    showToast("Đang tạo backup...");
    const { collection:col, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const names = ["shipments","customers","lc","forwarders"];
    const data = { _exportedAt: new Date().toISOString() };
    for (const n of names) {
      const snap = await getDocs(col(db, n));
      data[n] = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date().toISOString().slice(0,10);
    a.href = url; a.download = `backup-xuatkhau-${today}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    try { localStorage.setItem("lastBackup", today); } catch(e){}
    showToast("Đã tải file backup!");
  } catch (e) {
    showToast("Lỗi backup: " + (e.message||e));
  }
}
const _btnBackup = document.getElementById("btn-backup");
if (_btnBackup) _btnBackup.addEventListener("click", downloadBackup);

// Nhắc backup mỗi thứ 6 (chỉ admin, mỗi ngày 1 lần)
function maybeFridayBackup() {
  if (!isAdmin()) return;
  const now = new Date();
  if (now.getDay() !== 5) return;   // 5 = thứ 6
  const today = now.toISOString().slice(0,10);
  try {
    if (localStorage.getItem("backupReminded") === today) return;
    localStorage.setItem("backupReminded", today);
  } catch(e){}
  setTimeout(() => {
    if (confirm("Hôm nay thứ 6 — bạn có muốn tải file backup dữ liệu về máy không?\n\n(Nên lưu thêm 1 bản lên Google Drive cho chắc.)")) downloadBackup();
  }, 1200);
}

onAuthChange(user => {
  updateAdminUI();
  if (user) {
    startData();
    maybeFridayBackup();
  } else {
    stopData();
    showCalendar();   // về lịch trống
    renderCalendar();
  }
});

showCalendar();       // hiện lịch ngay khi tải trang (trống nếu chưa đăng nhập)
renderCalendar();
