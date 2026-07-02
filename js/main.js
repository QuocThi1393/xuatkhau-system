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
  { data: "items",        title: "Items",         width: 170 },
  { data: "qty",          title: "Qty (PCS)",     width: 60, type: "numeric" },
  { data: "ctns",         title: "Qty (CTNs)",    width: 60, type: "numeric" },
  { data: "kgPerCtn",     title: "Kgs/Carton",    width: 65, type: "numeric" },
  { data: "kgTotal",      title: "Qty (Kgs)",     width: 65, type: "numeric", readOnly: true },
  { data: "dimension",    title: "Dimension",     width: 95 },
  { data: "cbm",          title: "CBM",           width: 55, type: "numeric", readOnly: true },
  { data: "hsCode",       title: "HS CODE",       width: 80 },
  { data: "coForm",       title: "C/O FORM",      width: 80 },
  { data: "note",         title: "Note",          width: 120 },
];

// Cột cho bảng SỬA đơn hàng (bỏ STUFFING DATE/ETD/POD vì đã có ở thông tin lô)
const EDIT_COLS = [
  { data: "customer",     title: "Customer",      width: 110 },
  { data: "contract",     title: "Contract",      width: 95 },
  { data: "index",        title: "Index",         width: 95 },
  { data: "items",        title: "Items",         width: 175 },
  { data: "qty",          title: "Qty (PCS)",     width: 65, type: "numeric" },
  { data: "ctns",         title: "Qty (CTNs)",    width: 65, type: "numeric" },
  { data: "kgPerCtn",     title: "Kgs/Carton",    width: 70, type: "numeric" },
  { data: "kgTotal",      title: "Qty (Kgs)",     width: 70, type: "numeric", readOnly: true },
  { data: "dimension",    title: "Dimension",     width: 100 },
  { data: "tareCtn",      title: "Tare thùng",    width: 70, type: "numeric" },
  { data: "cbm",          title: "CBM",           width: 60, type: "numeric", readOnly: true },
  { data: "unitPrice",    title: "Giá GC (USD)",  width: 75, type: "numeric" },
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
    // action: "overwrite" (ghi đè lô cũ) | "create" (ghi mới, tách riêng) | "skip" (bỏ qua)
    ns.action = ns.matched ? "overwrite" : "create";
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
        ? `<select style="font-size:12px;padding:3px 6px;border:0.5px solid var(--border-md);border-radius:6px;background:var(--bg-card)" onchange="setImportAction(${i},this.value)">
             <option value="overwrite" ${ns.action==="overwrite"?"selected":""}>Ghi đè lô cũ</option>
             <option value="create" ${ns.action==="create"?"selected":""}>Ghi mới (tách riêng)</option>
             <option value="skip" ${ns.action==="skip"?"selected":""}>Bỏ qua</option>
           </select>`
        : `<span style="font-size:11px;color:var(--green-text)">Tạo mới</span>`}</td>
      <td style="font-size:11px;color:var(--text-muted)">${sample}${ns.orders.length>2?"...":""}</td>
      <td style="font-size:12px">${custs}</td>
    </tr>`;
  }).join("");
}
window.setImportAction = (i,v) => { parsedPlan[i].action = v; };

document.getElementById("btn-confirm-import-plan").addEventListener("click", async () => {
  const create = parsedPlan.filter(s=>s.action==="create");
  const ow = parsedPlan.filter(s=>s.action==="overwrite" && s.matched);
  const skip = parsedPlan.filter(s=>s.action==="skip");
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
            <button class="btn btn-sm btn-export" onclick="openSI('${s.id}')"><i class="ti ti-file-description"></i> Xuất SI (Draft B/L)</button>
            <button class="btn btn-sm" style="background:var(--green-text);color:#fff;border-color:var(--green-text)" onclick="toggleCoMenu(event,'${s.id}')"><i class="ti ti-certificate"></i> Xuất Draft CO <i class="ti ti-chevron-down"></i></button>
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
function fillEmailTemplate(tpl, vars) {
  return (tpl||"").replace(/\{(\w+)\}/g, (m,k) => (vars[k] !== undefined && vars[k] !== null) ? String(vars[k]) : "");
}

function cleanEmailHtml(html) {
  if (!html) return html;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  tmp.querySelectorAll("*").forEach(node => {
    node.style.removeProperty("height");
    node.style.removeProperty("min-height");
    node.style.removeProperty("margin-top");
    node.style.removeProperty("margin-bottom");
    node.style.removeProperty("margin");
    node.style.removeProperty("padding-top");
    node.style.removeProperty("padding-bottom");
    if (node.getAttribute("style") === "") node.removeAttribute("style");
    if (node.tagName === "DIV" || node.tagName === "P" || node.tagName === "SPAN") node.removeAttribute("height");
  });

  function isEmptyBlock(node) {
    if (node.querySelector && node.querySelector("table, img")) return false;
    const text = node.textContent.replace(/\u00a0/g, " ").trim();
    return !text;
  }

  function collapseEmptyBlocks(parent) {
    let consecutiveEmpty = 0;
    Array.from(parent.children).forEach(node => {
      const tag = node.tagName;
      if (tag === "DIV" || tag === "P") {
        if (isEmptyBlock(node)) {
          consecutiveEmpty++;
          if (consecutiveEmpty > 1) { node.remove(); return; }
        } else {
          consecutiveEmpty = 0;
        }
      } else {
        consecutiveEmpty = 0;
      }
      collapseEmptyBlocks(node);
    });
  }
  collapseEmptyBlocks(tmp);

  let out = tmp.innerHTML;
  out = out.replace(/(<br\s*\/?>\s*){3,}/gi, "<br><br>");
  return out;
}
function setupRichEditor(el) {
  if (!el || el._richSetup) return;
  el._richSetup = true;
  try { document.execCommand("defaultParagraphSeparator", false, "br"); } catch(e){}
  el.addEventListener("paste", (e) => {
    e.preventDefault();
    const html = e.clipboardData && e.clipboardData.getData("text/html");
    const text = e.clipboardData && e.clipboardData.getData("text/plain");
    if (html) {
      document.execCommand("insertHTML", false, cleanEmailHtml(html));
    } else if (text) {
      document.execCommand("insertText", false, text);
    }
  });
}

function buildEmailTable1(s) {
  const orders = s.orders || [];
  if (!orders.length) return "";
  const etd = s.etd ? new Date(s.etd).toLocaleDateString("en-GB",{day:"2-digit",month:"2-digit"}) : "";
  const pod = fullPort(s.port);
  const cust = siCustomerName(s);
  const td = "border:1px solid #000;padding:4px 8px;line-height:1.3;margin:0";
  const rows = orders.map((o,i) => `<tr style="text-align:center">
    ${i===0 ? `<td style="${td};color:#1a56db;font-weight:bold" rowspan="${orders.length}">${etd}</td>
    <td style="${td}" rowspan="${orders.length}">${pod}</td>
    <td style="${td}" rowspan="${orders.length}">${cust}</td>` : ""}
    <td style="${td}">${o.contract||""}</td>
    <td style="${td}">${o.index||o.items||""}</td>
    <td style="${td}">${Math.round(parseFloat(o.qty)||0).toLocaleString()}</td>
    <td style="${td}">${Math.round(parseFloat(o.ctns)||0).toLocaleString()}</td>
    <td style="${td}">${Math.round(parseFloat(o.kgTotal)||0).toLocaleString()}</td>
    <td style="${td}">${(parseFloat(o.cbm)||0).toFixed(2)}</td>
  </tr>`).join("");
  const tQty = orders.reduce((a,o)=>a+(parseFloat(o.qty)||0),0);
  const tCtns= orders.reduce((a,o)=>a+(parseFloat(o.ctns)||0),0);
  const tKg  = orders.reduce((a,o)=>a+(parseFloat(o.kgTotal)||0),0);
  const tCbm = orders.reduce((a,o)=>a+(parseFloat(o.cbm)||0),0);
  return `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;line-height:1.3;font-family:Arial,Helvetica,sans-serif;margin:0">
    <tr style="text-align:center;font-weight:bold">
      <td style="${td};color:#1a56db">ETD</td>
      <td style="${td}">POD</td>
      <td style="${td}">Customer</td>
      <td style="${td}">ORDER</td>
      <td style="${td}">STYLE</td>
      <td style="${td}">Qty<br>(PCS)</td>
      <td style="${td}">Qty<br>(CTNs)</td>
      <td style="${td}">Qty<br>(Kgs)</td>
      <td style="${td}">CBM</td>
    </tr>
    ${rows}
    <tr style="text-align:center;font-weight:bold;color:#C0392B">
      <td style="${td}" colspan="5">${s.container||""}</td>
      <td style="${td}">${Math.round(tQty).toLocaleString()}</td>
      <td style="${td}">${Math.round(tCtns).toLocaleString()}</td>
      <td style="${td}">${Math.round(tKg).toLocaleString()}</td>
      <td style="${td}">${tCbm.toFixed(2)}</td>
    </tr>
  </table>`;
}

function buildEmailTable2(s) {
  const orders = s.orders || [];
  if (!orders.length) return "";
  const etd = s.etd ? new Date(s.etd).toLocaleDateString("en-GB",{day:"2-digit",month:"2-digit"}) : "";
  const pod = fullPort(s.port);
  const cust = siCustomerName(s);
  const td = "border:1px solid #000;padding:4px 8px;line-height:1.3;margin:0";
  const rows = orders.map((o,i) => `<tr style="text-align:center">
    ${i===0 ? `<td style="${td};color:#1a56db;font-weight:bold" rowspan="${orders.length}">${etd}</td>
    <td style="${td}" rowspan="${orders.length}">${pod}</td>
    <td style="${td}" rowspan="${orders.length}">${cust}</td>` : ""}
    <td style="${td}">${o.contract||""}</td>
    <td style="${td}">${o.index||o.items||""}</td>
    <td style="${td}">${Math.round(parseFloat(o.qty)||0).toLocaleString()}</td>
    <td style="${td}">${o.hsCode||""}</td>
    <td style="${td}">${o.coForm||""}</td>
  </tr>`).join("");
  const tQty = orders.reduce((a,o)=>a+(parseFloat(o.qty)||0),0);
  return `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;line-height:1.3;font-family:Arial,Helvetica,sans-serif;margin:0">
    <tr style="text-align:center;font-weight:bold">
      <td style="${td};color:#1a56db">ETD</td>
      <td style="${td}">POD</td>
      <td style="${td}">Customer</td>
      <td style="${td}">Contract</td>
      <td style="${td}">Items</td>
      <td style="${td}">Qty<br>(PCS)</td>
      <td style="${td};background:#FFFF00">HS CODE</td>
      <td style="${td};background:#C6E0B4">C/O FORM<br>(RCEP or AJ)</td>
    </tr>
    ${rows}
    <tr style="text-align:center;font-weight:bold;color:#C0392B">
      <td style="${td}" colspan="5">${s.container||""}</td>
      <td style="${td}">${Math.round(tQty).toLocaleString()}</td>
      <td style="${td}"></td>
      <td style="${td}"></td>
    </tr>
  </table>`;
}

window.cleanCurrentEditor = function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = cleanEmailHtml(el.innerHTML);
  showToast("Đã dọn khoảng trắng!");
};

window.openEmailModal = async function(shipId) {
  const s = allShipments.find(x=>x.id===shipId);
  if (!s) return;
  let consignee="—", description="SHIRTS", note="", mailTo="", mailCc="", shortName="", emailTemplate=null;
  const first = (s.orders||[])[0];
  if (first?.customer) {
    try {
      const { collection:col, query:q, where, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const snap = await getDocs(q(col(db,"customers"), where("name","==",first.customer)));
      if (!snap.empty) {
        const c = snap.docs[0].data();
        consignee=c.consignee||"—"; description=c.description||"SHIRTS"; note=c.note||"";
        mailTo=c.mailTo||""; mailCc=c.mailCc||""; shortName=c.shortName||c.name||"";
        emailTemplate = c.emailTemplate || null;
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

  const vars = {
    container: s.container||"???",
    port: fullPort(s.port),
    etd: etdStr,
    etdShort: etdShort,
    description,
    contract: contracts.join(", ") || firstContract,
    qty: tPcs.toLocaleString(),
    ctns: tCtns,
    kg: tKg,
    cbm: tCbm,
    consignee,
    note: note ? "\nNote: "+note : "",
    shortName,
    table1: buildEmailTable1(s),
    table2: buildEmailTable2(s),
  };
  vars.table = vars.table1;

  const subjectTpl = emailTemplate?.subject || "New Booking {container} shipments //HCM-{port}/ ETD {etdShort} / Consignee: {shortName}//{contract}";
  const bodyTpl = emailTemplate?.body || `Please arrange for our NEW FCL BOOKING as follows!

{container} TO {port}, JAPAN:

ETD: ~ {etd}  TO: {port}: ETA:???  VESSEL: AS YOUR ARRANGEMENT

Description: {description}
Contract number: {contract}
Quantity: {qty} pcs = (about) {ctns} cartons = (about) {kg} kgs = (about) {cbm} cbm

Consignee: {consignee}
{note}

Best regards,`;

  const subject = fillEmailTemplate(subjectTpl, vars);
  const bodyHtml = cleanEmailHtml(fillEmailTemplate(bodyTpl, vars).replace(/\n/g,"<br>"));

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
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
      <span>Sửa trực tiếp nội dung bên dưới nếu cần. "Copy nội dung" giữ nguyên bảng khi dán vào Gmail/Outlook; "Mở Mail" chỉ gửi được bản chữ thường (giới hạn của mailto).</span>
      <button type="button" class="btn btn-sm" onclick="cleanCurrentEditor('em-body')"><i class="ti ti-eraser"></i> Dọn khoảng trắng</button>
    </div>
    <div class="rich-edit" id="em-body" contenteditable="true">${bodyHtml}</div>`;
  setupRichEditor(document.getElementById("em-body"));

  window._emailData = { mailTo, mailCc };
  openModal("modal-email");
};
document.getElementById("btn-copy-email").addEventListener("click", async () => {
  const el = document.getElementById("em-body");
  if (!el) return;
  const html = el.innerHTML;
  const text = el.innerText;
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], {type:"text/html"}),
          "text/plain": new Blob([text], {type:"text/plain"}),
        })
      ]);
    } else {
      await navigator.clipboard.writeText(text);
    }
    showToast("Đã copy nội dung email (giữ nguyên bảng)!");
  } catch(e) {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      document.execCommand("copy");
      sel.removeAllRanges();
      showToast("Đã copy nội dung email!");
    } catch(e2) {
      showToast("Không copy được, anh bôi đen rồi Ctrl+C thử nhé.");
    }
  }
});
document.getElementById("btn-open-mail").addEventListener("click", () => {
  const to = document.getElementById("em-to")?.value || "";
  const cc = document.getElementById("em-cc")?.value || "";
  const subject = document.getElementById("em-subject")?.value || "";
  const body = document.getElementById("em-body")?.innerText || "";
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
    contData = [{ label:`1 X ${c.type||s.container||""}: ${c.no||""} / ${c.seal||""}`, tare, gw: totalGW, vgm: Math.round(totalGW+tare) }];
  } else if (conts.length > 1) {
    contData = conts.map((c) => {
      const tare = parseFloat(c.tare)||0;
      const gw = parseFloat(c.gw)||0;
      return { label:`1 X ${c.type||""}: ${c.no||""} / ${c.seal||""}`, tare, gw: gw||null, vgm: gw?Math.round(gw+tare):null };
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

// ====== XUẤT SI (DRAFT B/L) ======
const SI_DEFAULT_SHIPPER = "TOMIYA SUMMIT GARMENT EXPORT CO., LTD.\nLOT B1, LONG BINH TECHNO PARK (LOTECO) EPZ,\nLONG BINH WARD, DONG NAI PROVINCE, VIET NAM\nTEL: 84-251-3992537       FAX: 84-251-3992540";
const SI_LC_CUSTOMERS = ["MITSUWA","SANMARINO","ACROS","HEMD"];

function siCustomerName(s) { return (s.orders||[])[0]?.customer || ""; }
function siIsLcCust(custName, s) {
  const U = (custName||"").toUpperCase();
  return SI_LC_CUSTOMERS.some(n => U.includes(n)) || !!(s && s.lcId);
}
function siDistinctHsCodes(s) { return [...new Set((s.orders||[]).map(o=>o.hsCode).filter(Boolean))]; }
function siItemList(s) {
  const seen = new Set(), out = [];
  (s.orders||[]).forEach(o => {
    const contract = o.contract||"", index = o.index||o.items||"";
    if (!contract && !index) return;
    const key = contract+"|"+index;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ contract, index });
  });
  return out;
}

window.openSI = async function(shipId) {
  const s = allShipments.find(x=>x.id===shipId);
  if (!s) return;
  const custName = siCustomerName(s);
  const existing = s.si || {};

  // Forwarder liên kết với khách hàng này
  let allFwd = [];
  try {
    const { collection:col, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const snap = await getDocs(col(db,"forwarders"));
    allFwd = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e){}
  const matchedFwd = allFwd.filter(f => (f.customers||[]).includes(custName));

  // Thông tin khách hàng + SI mẫu đã lưu sẵn cho khách này
  let cust = {};
  if (custName) {
    try {
      const { collection:col, query:q, where, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const snap = await getDocs(q(col(db,"customers"), where("name","==",custName)));
      if (!snap.empty) cust = snap.docs[0].data();
    } catch(e){}
  }
  const tpl = cust.siTemplate || {};

  // Số LC gợi ý sẵn nếu lô đã "Gán LC"
  let lcNoSuggest = "";
  if (s.lcId) {
    try {
      const { doc:d2, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const snap = await getDoc(d2(db,"lc",s.lcId));
      if (snap.exists()) lcNoSuggest = snap.data().name || "";
    } catch(e){}
  }

  const def = {
    forwarderId: existing.forwarderId || (matchedFwd.length===1 ? matchedFwd[0].id : (matchedFwd.find(f=>f.id===tpl.forwarderId) ? tpl.forwarderId : "")),
    attnText: existing.attnText || tpl.attnText || "",
    shipperText: existing.shipperText || tpl.shipperText || SI_DEFAULT_SHIPPER,
    consigneeText: existing.consigneeText || tpl.consigneeText || cust.consignee || "",
    notifyText: existing.notifyText || tpl.notifyText || cust.consignee || "",
    goodsDescription: existing.goodsDescription || tpl.goodsDescription || cust.description || "SHIRTS",
    billType: existing.billType || tpl.billType || "SURRENDERED",
    freightCollect: existing.freightCollect ?? true,
    showItemList: existing.showItemList ?? tpl.showItemList ?? true,
    lcNo: existing.lcNo || lcNoSuggest || tpl.lcNo || "",
  };
  if (!def.attnText && def.forwarderId) {
    const f = allFwd.find(x=>x.id===def.forwarderId);
    if (f) def.attnText = `${(f.info||f.name||"").split("\n")[0].trim()} Docs Team`;
  }

  const fwdOptionsHTML = allFwd.map(f=>`<option value="${f.id}" ${def.forwarderId===f.id?"selected":""}>${f.name}</option>`).join("");
  const fwdBlockHTML = matchedFwd.length === 1
    ? `<input type="hidden" id="si-forwarder" value="${matchedFwd[0].id}">
       <div style="font-size:13px;padding:8px 0;color:var(--text-muted)">Tự động: <b>${matchedFwd[0].name}</b> <span style="font-size:11px">(khách này chỉ có 1 forwarder)</span></div>`
    : `<select class="form-select" id="si-forwarder">
         <option value="">${matchedFwd.length ? "— Chọn forwarder —" : "— Chưa gán forwarder cho khách này, chọn tay —"}</option>
         ${fwdOptionsHTML}
       </select>`;

  const showLcField = siIsLcCust(custName, s);

  document.getElementById("si-form-body").innerHTML = `
    <div class="form-group">
      <label class="form-label">Forwarder (TO:)</label>
      ${fwdBlockHTML}
    </div>
    <div class="form-group">
      <label class="form-label">ATTN</label>
      <input class="form-input" id="si-attn" value="${(def.attnText||"").replace(/"/g,"&quot;")}" placeholder="TRALINKS CO.,LTD Docs Team">
    </div>
    <div class="form-group">
      <label class="form-label">SHIPPER</label>
      <textarea class="form-textarea" id="si-shipper" rows="4">${def.shipperText}</textarea>
    </div>
    <div class="form-group"><label class="form-label">CONSIGNEE</label><textarea class="form-textarea" id="si-consignee" rows="4">${def.consigneeText}</textarea></div>
    <div class="form-group"><label class="form-label">NOTIFY PARTY</label><textarea class="form-textarea" id="si-notify" rows="4">${def.notifyText}</textarea></div>
    <div class="form-group">
      <label class="form-label">Tên hàng (Goods Description)</label>
      <input class="form-input" id="si-goods" value="${def.goodsDescription}">
    </div>
    ${showLcField ? `<div class="form-group">
      <label class="form-label">Thông tin L/C</label>
      <textarea class="form-textarea" id="si-lcno" rows="3" placeholder="CONTRACT NO. NPTC/TOSG-2026/007/011
L/C NO. LC002200003063">${(def.lcNo||"")}</textarea>
    </div>` : `<input type="hidden" id="si-lcno" value="">`}
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Loại Bill</label>
        <select class="form-select" id="si-billtype">
          <option value="SURRENDERED" ${def.billType==="SURRENDERED"?"selected":""}>SURRENDERED B/L</option>
          <option value="SEAWAY" ${def.billType==="SEAWAY"?"selected":""}>SEAWAY BILL</option>
        </select>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;margin-top:22px"><input type="checkbox" id="si-freight" ${def.freightCollect?"checked":""}> Freight Collect</label>
    </div>
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="si-itemlist" ${def.showItemList?"checked":""}> Hiện danh sách Contract/Style</label>
    <div class="form-footer">
      <button type="button" class="btn" onclick="closeModalById('modal-si')">Hủy</button>
      <button type="button" class="btn btn-primary" onclick="saveSI('${shipId}')"><i class="ti ti-file-export"></i> Lưu & Xuất SI</button>
    </div>`;
  openModal("modal-si");
};

window.saveSI = async function(shipId) {
  const s = allShipments.find(x=>x.id===shipId);
  if (!s) return;
  if (!(s.shipMark||"").trim()) {
    if (!confirm("Bạn chưa nhập Shipping Mark. Có muốn tiếp tục xuất SI?")) return;
  }
  const fwdSel = document.getElementById("si-forwarder");
  const si = {
    forwarderId: fwdSel ? fwdSel.value : "",
    attnText: document.getElementById("si-attn").value.trim(),
    shipperText: document.getElementById("si-shipper").value,
    consigneeText: document.getElementById("si-consignee").value,
    notifyText: document.getElementById("si-notify").value,
    goodsDescription: document.getElementById("si-goods").value.trim(),
    billType: document.getElementById("si-billtype").value,
    freightCollect: document.getElementById("si-freight").checked,
    showItemList: document.getElementById("si-itemlist").checked,
    lcNo: (document.getElementById("si-lcno")?.value || "").trim(),
  };

  let fwdInfo = "";
  if (si.forwarderId) {
    try {
      const { doc:d2, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const snap = await getDoc(d2(db,"forwarders",si.forwarderId));
      if (snap.exists()) fwdInfo = snap.data().info || snap.data().name || "";
    } catch(e){}
  }
  si.toText = fwdInfo;

  await updateDoc(doc(db,"shipments",shipId), { si });
  closeModal("modal-si");
  showToast("Đã lưu thông tin SI!");
  renderSIPrint({ ...s, si });
};

function renderSIPrint(s) {
  const si = s.si || {};
  const orders = s.orders || [];
  const totalCtns = orders.reduce((a,o)=>a+(parseFloat(o.ctns)||0),0);
  const totalGWv  = orders.reduce((a,o)=>a+(parseFloat(o.kgTotal)||0),0);
  const totalNW   = orders.reduce((a,o)=>{ const gw=parseFloat(o.kgTotal)||0, tare=parseFloat(o.tareCtn)||0, ct=parseFloat(o.ctns)||0; return a+(gw-tare*ct); }, 0);
  const totalCBMv = orders.reduce((a,o)=>a+(parseFloat(o.cbm)||0),0);

  const conts = (s.containers && s.containers.length) ? s.containers
              : (s.contNo||s.sealNo) ? [{type:"",no:s.contNo,seal:s.sealNo}] : [];

  const fmtNum = (n,dec=2) => Number(n||0).toLocaleString("en-US",{minimumFractionDigits:dec,maximumFractionDigits:dec});
  const fmtInt = (n) => Math.round(n||0).toLocaleString("en-US");

  const contLineRows = conts.length ? conts.map(c => {
    let ctnsC, gwC, nwC, cbmC;
    if (conts.length === 1) {
      ctnsC = totalCtns; gwC = totalGWv; nwC = totalNW; cbmC = totalCBMv;
    } else {
      gwC = parseFloat(c.gw)||0;
      const ratio = totalGWv ? gwC/totalGWv : 0;
      ctnsC = Math.round(totalCtns*ratio);
      nwC = Math.round(totalNW*ratio*100)/100;
      cbmC = Math.round(totalCBMv*ratio*100)/100;
    }
    return `<tr>
      <td>1 X ${c.type||s.container||""}: ${c.no||""} / ${c.seal||""}</td>
      <td style="text-align:right">${fmtInt(ctnsC)} CTNS</td>
      <td style="text-align:right;color:#888888">${fmtNum(nwC,2)} KGS</td>
      <td style="text-align:right">${fmtNum(gwC,2)} KGS</td>
      <td style="text-align:right">${fmtNum(cbmC,2)} CBM</td>
    </tr>`;
  }).join("") : `<tr>
      <td>${s.container||""}</td>
      <td style="text-align:right">${fmtInt(totalCtns)} CTNS</td>
      <td style="text-align:right;color:#888888">${fmtNum(totalNW,2)} KGS</td>
      <td style="text-align:right">${fmtNum(totalGWv,2)} KGS</td>
      <td style="text-align:right">${fmtNum(totalCBMv,2)} CBM</td>
    </tr>`;

  const totalRow = `<tr style="font-weight:bold;font-style:italic">
      <td>TOTAL</td>
      <td style="text-align:right">${fmtInt(totalCtns)} CTNS</td>
      <td style="text-align:right">${fmtNum(totalNW,2)} KGS</td>
      <td style="text-align:right">${fmtNum(totalGWv,2)} KGS</td>
      <td style="text-align:right">${fmtNum(totalCBMv,2)} CBM</td>
    </tr>`;

  const items = siItemList(s);
  const itemsHTML = (si.showItemList && items.length)
    ? `<tr><td colspan="5" style="padding-top:4px">
        <table style="width:100%">
          ${items.map(it=>`<tr><td style="padding:1px 0;width:110px">${it.contract}</td><td style="padding:1px 0">${it.index}</td></tr>`).join("")}
        </table>
      </td></tr>`
    : "";

  const hsCodes = siDistinctHsCodes(s).join(", ");
  const now = new Date();
  const dateStr = `${now.toLocaleString("en-US",{month:"short"}).toUpperCase()} ${String(now.getDate()).padStart(2,"0")}, ${now.getFullYear()}`;
  const etdStr = s.etd ? (() => { const d = new Date(s.etd); return `${d.toLocaleString("en-US",{month:"long"})} ${d.getDate()}, ${d.getFullYear()}`; })() : "";
  const billTypeText = si.billType === "SEAWAY" ? "SEAWAY BILL" : "SURRENDERED B/L";
  const lcBlock = si.lcNo ? `<tr><td colspan="5">${si.lcNo.replace(/\n/g,"<br>")}</td></tr>` : "";
  const toLines = (si.toText||"").split("\n").filter(Boolean);

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing:border-box; }
  body { font-family:Helvetica,Arial,sans-serif; font-size:11px; color:#000; margin:0; }
  table { border-collapse:collapse; width:100%; }
  td,th { padding:3px 6px; vertical-align:top; }
  .box { border:1.5px solid #000; }
  .yellow { background:#FFFF99; }
  .center { text-align:center; }
  .bold { font-weight:bold; }
  @media print { .no-print{display:none;} }
</style></head><body>

<table class="box"><tr>
  <td class="yellow" style="width:22%;border-right:1.5px solid #000"><b style="font-size:16px">TOSGAMEX</b></td>
  <td class="yellow center">
    <div class="bold" style="font-size:13px">TOMIYA SUMMIT GARMENT EXPORT CO., LTD</div>
    <div style="font-size:9px">LOT B1, LONG BINH TECHNO PARK (LOTECO), LONG BINH WARD, DONG NAI CITY, VIETNAM</div>
    <div style="font-size:9px">TEL: 84-0251-3992537&nbsp;&nbsp;FAX: 84-0251-3992540&nbsp;&nbsp;E-MAIL: tos2@tosg.com.vn</div>
  </td>
</tr></table>

<table class="box" style="border-top:none"><tr>
  <td style="width:60%;border-right:1px solid #000">
    <b>TO:</b> ${toLines[0]||""}<br>${toLines.slice(1).join("<br>")}
    <br><b>ATTN:</b> ${si.attnText||""}
  </td>
  <td>
    <span class="yellow bold">FROM: QUOC THI</span><br>DATE: ${dateStr}
  </td>
</tr></table>

<div class="center yellow bold" style="font-size:17px;padding:6px 0;margin:6px 0">DETAILS FOR B/L</div>

<table class="box">
  <tr>
    <td style="border-bottom:1px solid #000"><b>SHIPPER:</b><br>${(si.shipperText||"").replace(/\n/g,"<br>")}</td>
  </tr>
  <tr>
    <td style="border-bottom:1px solid #000"><b>CONSIGNEE:</b><br>${(si.consigneeText||"").replace(/\n/g,"<br>")}</td>
  </tr>
  <tr>
    <td><b>NOTIFY PARTY:</b><br>${(si.notifyText||"").replace(/\n/g,"<br>")}</td>
  </tr>
</table>

<table class="box" style="border-top:none">
  <tr class="yellow bold center">
    <td style="width:25%;border-right:1px solid #000">FROM:</td>
    <td style="width:25%;border-right:1px solid #000">TO:</td>
    <td style="width:25%;border-right:1px solid #000">FEEDER VESSEL:</td>
    <td style="width:25%">DEPARTURE DATE:</td>
  </tr>
  <tr class="center">
    <td style="border-right:1px solid #000">HOCHIMINH, VIETNAM</td>
    <td style="border-right:1px solid #000">${fullPort(s.port)}, JAPAN</td>
    <td style="border-right:1px solid #000">${s.vessel||""}</td>
    <td>${etdStr}</td>
  </tr>
</table>

<table style="margin-top:6px">
  <colgroup><col style="width:46%"><col style="width:13%"><col style="width:14%"><col style="width:14%"><col style="width:13%"></colgroup>
  <thead>
    <tr class="box yellow bold center">
      <th style="border-right:1px solid #000">GOODS DESCRIPTION</th>
      <th style="border-right:1px solid #000">QUANTITY<br>(CARTONS)</th>
      <th style="border-right:1px solid #000">N.W<br>(KGS)</th>
      <th style="border-right:1px solid #000">G.W<br>( KGS )</th>
      <th>M' MENT<br>( CBM )</th>
    </tr>
  </thead>
  <tbody>
    <tr><td colspan="5" style="padding-top:8px" class="bold">${si.goodsDescription||""}</td></tr>
    ${lcBlock}
    ${itemsHTML}
    <tr><td colspan="5" style="height:8px"></td></tr>
    ${contLineRows}
    ${totalRow}
  </tbody>
</table>

<div class="box" style="border-color:#C0392B;border-width:2px;padding:8px 10px;margin-top:10px;color:#C0392B" class="bold">
  ${si.freightCollect ? `<b>"FREIGHT COLLECT"</b><br>` : ""}
  <b>HS CODE: ${hsCodes}&nbsp;&nbsp;&nbsp;DON'T SHOW ON B/L</b><br>
  <b>${billTypeText}</b><br>
  <b>PLEASE SEND COPY B/L THROUGH E-MAIL: tos2@tosg.com.vn</b>
</div>

<div style="margin-top:10px"><b>SHIPPING MARKS:</b><div style="margin-top:4px;font-weight:bold;white-space:pre-line">${(s.shipMark||"").replace(/</g,"&lt;")}</div></div>

<div class="center bold" style="font-size:12px;letter-spacing:1px;margin-top:22px">--- THE END ---</div>

<div class="no-print center" style="margin-top:20px">
  <button onclick="window.print()" style="padding:10px 24px;font-size:14px;cursor:pointer;background:#1a1a1a;color:#fff;border:none;border-radius:6px">🖨 In / Lưu PDF</button>
</div>
</body></html>`;

  const w = window.open("","_blank");
  w.document.write(html);
  w.document.close();
  w.document.title = pdfFileName("Draft SI", s.invoiceNo);
}


// ====== XUẤT DRAFT CO ======
const CO_HS_COLORS = ["#FFF9C4","#BBDEFB","#C8E6C9","#FFE0B2","#F8BBD0",null,"#E1BEE7"];
const CO_TYPE_LABEL = { RCEP:"RCEP", AJ:"AJ", D:"Form D" };
const CO_ROWS_PER_PAGE = 22;

function coShipperDefault(s) {
  const city = (s && s.lcId) ? "DONG NAI PROVINCE" : "DONG NAI CITY";
  return `TOMIYA SUMMIT GARMENT EXPORT CO., LTD\nLOT B1, LONG BINH TECHNO PARK (LOTECO) EPZ,\nLONG BINH WARD, ${city}, VIETNAM`;
}

function coChunk(arr, size) {
  const out = [];
  for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size));
  return out.length ? out : [[]];
}

window.toggleCoMenu = function(ev, shipId) {
  ev.stopPropagation();
  const existing = document.getElementById("co-floating-menu");
  const wasForThisShip = existing && existing.dataset.ship === shipId;
  if (existing) existing.remove();
  if (wasForThisShip) return;

  const btn = ev.currentTarget;
  const rect = btn.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.id = "co-floating-menu";
  menu.dataset.ship = shipId;
  menu.style.cssText = "position:fixed;z-index:9999;background:var(--bg-card);border:0.5px solid var(--border);border-radius:var(--radius-md);box-shadow:0 4px 16px rgba(0,0,0,0.25);min-width:160px;overflow:hidden;font-size:13px";
  menu.innerHTML = `
    <div style="padding:9px 14px;cursor:pointer" onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''" onclick="openCODraft('${shipId}','RCEP')">CO RCEP</div>
    <div style="padding:9px 14px;cursor:pointer" onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''" onclick="openCODraft('${shipId}','AJ')">CO AJ</div>
    <div style="padding:9px 14px;cursor:pointer" onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''" onclick="openCODraft('${shipId}','D')">CO Form D</div>
  `;
  document.body.appendChild(menu);

  const menuHeight = menu.offsetHeight || 108;
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < menuHeight + 12) {
    menu.style.bottom = (window.innerHeight - rect.top + 4) + "px";
  } else {
    menu.style.top = (rect.bottom + 4) + "px";
  }
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 176)) + "px";
};
document.addEventListener("click", (e) => {
  const menu = document.getElementById("co-floating-menu");
  if (menu && !menu.contains(e.target)) menu.remove();
});

function coFilterOrders(s, type) {
  const orders = s.orders || [];
  return orders.filter(o => {
    const v = (o.coForm||"").toUpperCase().trim();
    if (type === "RCEP") return v.includes("RCEP");
    if (type === "AJ") return v.includes("AJ") && !v.includes("RCEP");
    if (type === "D") return v.includes("FORM D") || v === "D";
    return false;
  });
}

function coGroupByHsCode(lines) {
  const order = [];
  const map = {};
  lines.forEach(o => {
    const hs = o.hsCode || "";
    if (!map[hs]) { map[hs] = []; order.push(hs); }
    map[hs].push(o);
  });
  return order.map((hs,i) => ({ hsCode: hs, color: CO_HS_COLORS[i % CO_HS_COLORS.length], lines: map[hs] }));
}

function coFmtDepDate(etd) {
  if (!etd) return "";
  const d = new Date(etd);
  return `${String(d.getDate()).padStart(2,"0")}-${d.toLocaleString("en-US",{month:"short"})}-${String(d.getFullYear()).slice(-2)}`;
}
function coFmtSignDate(etd) {
  if (!etd) return "";
  const d = new Date(etd);
  if (d.getDay() === 0) d.setDate(d.getDate()+1);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}
function coFmtCertNo(etd) {
  if (!etd) return "VN-JP /";
  const d = new Date(etd);
  return `VN-JP ${String(d.getFullYear()).slice(-2)}/${String(d.getMonth()+1).padStart(2,"0")}/`;
}

window.openCODraft = async function(shipId, type) {
  const menu = document.getElementById("co-floating-menu");
  if (menu) menu.remove();
  const s = allShipments.find(x=>x.id===shipId);
  if (!s) return;
  const lines = coFilterOrders(s, type);
  if (!lines.length) {
    showToast(`Lô hàng không có dòng hàng dùng CO ${CO_TYPE_LABEL[type]}!`);
    return;
  }
  const groups = coGroupByHsCode(lines);

  const custName = siCustomerName(s);
  let cust = {};
  if (custName) {
    try {
      const { collection:col, query:q, where, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const snap = await getDocs(q(col(db,"customers"), where("name","==",custName)));
      if (!snap.empty) cust = snap.docs[0].data();
    } catch(e){}
  }
  const consigneeText = cust.siTemplate?.consigneeText || cust.consignee || "";
  const goodsDescription = cust.siTemplate?.goodsDescription || cust.description || "SHIRTS";

  window._coDraft = { shipId, type, groups, goodsDescription };

  const shipperDef = coShipperDefault(s);
  document.getElementById("co-draft-title").textContent = `Xem lại Draft CO ${CO_TYPE_LABEL[type]}`;

  if (type === "AJ") {
    document.getElementById("co-draft-body").innerHTML = `
      <div class="form-group">
        <label class="form-label">1. Goods consigned from (Shipper)</label>
        <textarea class="form-textarea" id="cod-shipper" rows="3">${shipperDef}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">2. Goods consigned to (Consignee)</label>
        <textarea class="form-textarea" id="cod-consignee" rows="3">${consigneeText}</textarea>
      </div>
      <div class="form-row-3">
        <div class="form-group"><label class="form-label">Shipment date</label><input class="form-input" id="cod-depdate" value="${coFmtDepDate(s.etd)}"></div>
        <div class="form-group"><label class="form-label">Vessel</label><input class="form-input" id="cod-vessel" value="${(s.vessel||"").replace(/"/g,"&quot;")}"></div>
        <div class="form-group"><label class="form-label">Port of Discharge</label><input class="form-input" id="cod-pod" value="${fullPort(s.port)}, JAPAN"></div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Tên hàng (box 7)</label>
          <input class="form-input" id="cod-goods" value="${goodsDescription}">
        </div>
        <div class="form-group">
          <label class="form-label">Box 6 hiện</label>
          <div style="display:flex;gap:16px;padding-top:8px">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="cod-ctns" checked> Số thùng (CTNS)</label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="cod-shipmark"> Shipping Mark</label>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">13.</label>
        <div style="display:flex;flex-direction:column;gap:6px">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="cod-thirdcountry"> Third Country Invoicing</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="cod-backtoback"> Back-to-Back CO</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="cod-retro"> Issued Retroactively</label>
        </div>
      </div>
      <div class="form-footer">
        <button type="button" class="btn" onclick="closeModalById('modal-co-draft')">Hủy</button>
        <button type="button" class="btn btn-primary" onclick="confirmExportCO()"><i class="ti ti-certificate"></i> Xuất Draft CO</button>
      </div>`;
  } else {
    document.getElementById("co-draft-body").innerHTML = `
      <div class="form-group">
        <label class="form-label">1. Goods Consigned from (Shipper)</label>
        <textarea class="form-textarea" id="cod-shipper" rows="3">${shipperDef}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">2. Goods Consigned to (Consignee)</label>
        <textarea class="form-textarea" id="cod-consignee" rows="3">${consigneeText}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">3. Producer</label>
        <textarea class="form-textarea" id="cod-producer" rows="3">${shipperDef}</textarea>
      </div>
      <div class="form-row-3">
        <div class="form-group"><label class="form-label">Departure Date</label><input class="form-input" id="cod-depdate" value="${coFmtDepDate(s.etd)}"></div>
        <div class="form-group"><label class="form-label">Vessel</label><input class="form-input" id="cod-vessel" value="${(s.vessel||"").replace(/"/g,"&quot;")}"></div>
        <div class="form-group"><label class="form-label">Port of Discharge</label><input class="form-input" id="cod-pod" value="${fullPort(s.port)}, JAPAN"></div>
      </div>
      <div class="form-group">
        <label class="form-label">8. Number and kind of packages — hiện cột nào</label>
        <div style="display:flex;gap:16px">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="cod-contract" checked> Contract</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="cod-index" checked> Index</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="cod-items" checked> Items</label>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">17.</label>
        <div style="display:flex;flex-direction:column;gap:6px">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="cod-backtoback"> Back-to-back Certificate of Origin</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="cod-thirdparty"> Third-party invoicing</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="cod-retro"> ISSUED RETROACTIVELY</label>
        </div>
      </div>
      <div class="form-footer">
        <button type="button" class="btn" onclick="closeModalById('modal-co-draft')">Hủy</button>
        <button type="button" class="btn btn-primary" onclick="confirmExportCO()"><i class="ti ti-certificate"></i> Xuất Draft CO</button>
      </div>`;
  }
  openModal("modal-co-draft");
};

window.confirmExportCO = function() {
  const d = window._coDraft;
  if (!d) return;
  const s = allShipments.find(x=>x.id===d.shipId);
  if (!s) return;

  if (d.type === "AJ") {
    const overrides = {
      shipperText: document.getElementById("cod-shipper").value,
      consigneeText: document.getElementById("cod-consignee").value,
      depDate: document.getElementById("cod-depdate").value,
      vessel: document.getElementById("cod-vessel").value,
      pod: document.getElementById("cod-pod").value,
      goodsDescription: document.getElementById("cod-goods").value,
      showCtns: document.getElementById("cod-ctns").checked,
      showShipMark: document.getElementById("cod-shipmark").checked,
      thirdCountry: document.getElementById("cod-thirdcountry").checked,
      backToBack: document.getElementById("cod-backtoback").checked,
      retro: document.getElementById("cod-retro").checked,
    };
    closeModal("modal-co-draft");
    renderCOPrintAJ(s, d.groups, overrides);
  } else {
    const overrides = {
      shipperText: document.getElementById("cod-shipper").value,
      consigneeText: document.getElementById("cod-consignee").value,
      producerText: document.getElementById("cod-producer").value,
      depDate: document.getElementById("cod-depdate").value,
      vessel: document.getElementById("cod-vessel").value,
      pod: document.getElementById("cod-pod").value,
      showContract: document.getElementById("cod-contract").checked,
      showIndex: document.getElementById("cod-index").checked,
      showItems: document.getElementById("cod-items").checked,
      backToBack: document.getElementById("cod-backtoback").checked,
      thirdParty: document.getElementById("cod-thirdparty").checked,
      retro: document.getElementById("cod-retro").checked,
    };
    closeModal("modal-co-draft");
    renderCOPrintRCEP(s, d.type, d.groups, d.goodsDescription, overrides);
  }
};

function coFillerRows(count, colCount, rowHeight) {
  if (count <= 0) return "";
  let out = "";
  for (let i=0;i<count;i++) {
    let tds = "";
    for (let c=0;c<colCount;c++) {
      tds += `<td style="height:${rowHeight}px;${c<colCount-1?"border-right:1px solid #000;":""}">&nbsp;</td>`;
    }
    out += `<tr>${tds}</tr>`;
  }
  return out;
}

const CO_PRINT_STYLE = `
  @page { size: A4; margin: 10mm; }
  * { box-sizing:border-box; }
  body { font-family:Arial,Helvetica,sans-serif; font-size:10.5px; color:#000; margin:0; }
  table { border-collapse:collapse; width:100%; }
  td,th { padding:3px 5px; vertical-align:top; }
  .co-page { page-break-after: always; }
  .co-page-last { page-break-after: auto; }
  @media print { .no-print{display:none;} }
`;

function coOpenPrintWindow(pagesHtml, title) {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${CO_PRINT_STYLE}</style></head><body>
    ${pagesHtml}
    <div class="no-print" style="text-align:center;margin-top:20px">
      <button onclick="window.print()" style="padding:10px 24px;font-size:14px;cursor:pointer;background:#1a1a1a;color:#fff;border:none;border-radius:6px">🖨 In / Lưu PDF</button>
    </div>
  </body></html>`;
  const w = window.open("","_blank");
  w.document.write(html);
  w.document.close();
  w.document.title = title;
}

// ---------- RCEP ----------
function renderCOPrintRCEP(s, type, groups, goodsDescription, ov) {
  const orders = groups.flatMap(g => g.lines.map(o => ({ ...o, _color: g.color })));
  const totalCtns = orders.reduce((a,o)=>a+(parseFloat(o.ctns)||0),0);
  const signDate = coFmtSignDate(s.etd);
  const certNo = coFmtCertNo(s.etd);
  const chk = (b) => b ? "&#9746;" : "&#9633;";

  const packCols = [ov.showContract && "contract", ov.showIndex && "index", ov.showItems && "items"].filter(Boolean);
  function packCell(o) {
    if (!packCols.length) return "";
    const vals = packCols.map(k => k==="contract" ? (o.contract||"") : k==="index" ? (o.index||"") : (o.items||""));
    return `<table style="width:100%"><tr>${vals.map(v=>`<td style="padding:0 4px 0 0">${v}</td>`).join("")}</tr></table>`;
  }

  const pages = coChunk(orders, CO_ROWS_PER_PAGE);
  const pagesHtml = pages.map((pageOrders, pIdx) => {
    const isLast = pIdx === pages.length - 1;
    const startNum = pIdx * CO_ROWS_PER_PAGE;
    const rowSpanCount = 1 + pageOrders.length;

    const rows = pageOrders.map((o,i) => `<tr style="font-size:9px;height:20px">
      <td style="border-right:1px solid #000;text-align:center;background:${o._color||"transparent"}">${startNum+i+1}</td>
      <td style="border-right:1px solid #000;background:${o._color||"transparent"}"></td>
      <td style="border-right:1px solid #000;padding:2px 4px;background:${o._color||"transparent"}">${packCell(o)}</td>
      <td style="border-right:1px solid #000;text-align:center;background:${o._color||"transparent"}">${o.hsCode||""}</td>
      <td style="border-right:1px solid #000;text-align:center">CTC</td>
      <td style="border-right:1px solid #000;text-align:center">VIETNAM</td>
      <td style="border-right:1px solid #000;text-align:center">${Math.round(parseFloat(o.qty)||0).toLocaleString()} PCS</td>
    </tr>`).join("");

    return `<div class="${isLast ? "co-page co-page-last" : "co-page"}">
<table style="border:1.5px solid #000">
<tr>
<td style="width:52%;border-right:1.5px solid #000;border-bottom:1.5px solid #000;padding:5px;vertical-align:top">
<b>1. Goods Consigned from (Exporter's name, address and country)</b><br>
${(ov.shipperText||"").replace(/\n/g,"<br>")}
</td>
<td style="border-bottom:1.5px solid #000;padding:5px;vertical-align:top">
<div style="display:flex;justify-content:space-between"><span>Certificate No. <b>${certNo}</b></span><span><b>Form ${CO_TYPE_LABEL[type]}</b></span></div>
<div style="text-align:center;font-weight:bold;font-size:12px;margin-top:8px">REGIONAL COMPREHENSIVE ECONOMIC<br>PARTNERSHIP AGREEMENT</div>
<div style="text-align:center;font-weight:bold;font-size:11px;margin-top:6px">CERTIFICATE OF ORIGIN</div>
<div style="text-align:center;margin-top:10px">Issued in ....<b>VIETNAM</b>....................<br><span style="font-size:9.5px">(Country)</span></div>
</td>
</tr>
<tr>
<td style="border-right:1.5px solid #000;padding:0;vertical-align:top">
<div style="border-bottom:1px solid #000;padding:5px">
<b>2. Goods Consigned to (Importer's/ Consignee's name, address, country)</b><br>
${(ov.consigneeText||"").replace(/\n/g,"<br>")}
</div>
<div style="border-bottom:1px solid #000;padding:5px">
<b>3. Producer's name, address and country (if known)</b><br>
${(ov.producerText||"").replace(/\n/g,"<br>")}
</div>
<div style="padding:5px">
<b>4. Means of transport and route (if known)</b>
<div style="margin-top:5px">Departure Date: &nbsp;&nbsp;${ov.depDate||""}</div>
<div style="margin-top:6px">Vessel's name/Aircraft flight number, etc.: ${ov.vessel||""}</div>
<div style="margin-top:6px">Port of Discharge: &nbsp;&nbsp;${ov.pod||""}</div>
</div>
</td>
<td style="padding:5px;vertical-align:top">
<b>5. For Official Use</b>
<div style="margin-top:5px"><b>Preferential Treatment:</b></div>
<div style="margin-top:4px">&#9633; Given &nbsp;&nbsp;&nbsp;&nbsp; &#9633; Not Given (Please state reason/s)</div>
<div style="height:36px"></div>
<div style="text-align:center">........................................................................<br><span style="font-size:9.5px">Signature of Authorised Signatory of the Customs Authority of the Importing Country</span></div>
</td>
</tr>
</table>

<table style="border:1.5px solid #000;border-top:none">
<colgroup><col style="width:6%"><col style="width:8%"><col style="width:29%"><col style="width:10%"><col style="width:8%"><col style="width:8%"><col style="width:16%"><col style="width:15%"></colgroup>
<tr style="text-align:center;font-weight:bold;font-size:8.5px">
<td style="border-right:1px solid #000">6. Item number</td>
<td style="border-right:1px solid #000">7. Marks and numbers on packages</td>
<td style="border-right:1px solid #000">8. Number and kind of packages; and description of goods.</td>
<td style="border-right:1px solid #000">9. HS Code of the goods (6 digit-level)</td>
<td style="border-right:1px solid #000">10. Origin Conferring Criterion</td>
<td style="border-right:1px solid #000">11. RCEP Country of Origin</td>
<td style="border-right:1px solid #000">12. Quantity (Gross weight or other measurement), and value (FOB) where RVC is applied</td>
<td>13. Invoice number(s) and date of invoice(s)</td>
</tr>
<tr style="border-top:1px solid #000;font-size:9px">
<td style="border-right:1px solid #000"></td>
<td style="border-right:1px solid #000"></td>
<td style="border-right:1px solid #000;text-align:center;font-weight:bold">${Math.round(totalCtns).toLocaleString()} CTNS &nbsp;&nbsp; ${goodsDescription}</td>
<td style="border-right:1px solid #000"></td>
<td style="border-right:1px solid #000"></td>
<td style="border-right:1px solid #000"></td>
<td style="border-right:1px solid #000"></td>
<td rowspan="${rowSpanCount}" style="text-align:center;vertical-align:top;padding-top:4px">${s.invoiceNo||""}<br>DATE: ${s.invoiceDate||""}</td>
</tr>
${rows}
${coFillerRows(CO_ROWS_PER_PAGE - pageOrders.length, 8, 20)}
</table>

${isLast ? `
<table style="border:1.5px solid #000;border-top:none">
<tr><td style="padding:5px"><b>14. Remarks</b><div style="height:20px"></div></td></tr>
</table>

<table style="border:1.5px solid #000;border-top:none;font-size:9.5px">
<tr>
<td style="width:50%;border-right:1px solid #000;padding:5px;vertical-align:top">
<b style="font-size:10.5px">15. Declaration by the exporter or producer</b>
<div style="margin-top:5px">The undersigned hereby declares that the above details and statements are correct and that the goods covered in this Certificate comply with the requirements specified for these goods in the Regional Comprehensive Economic Partnership Agreement. These goods are exported to:</div>
<div style="margin-top:10px;text-align:center">.............<b>JAPAN</b>.............<br><span style="font-size:9px">(importing country)</span></div>
<div style="margin-top:14px;text-align:center">DONG NAI, ${signDate}<br>........................................<br><span style="font-size:9px">Place and date, and signature of authorised signatory</span></div>
</td>
<td style="padding:5px;vertical-align:top">
<b style="font-size:10.5px">16. Certification</b>
<div style="margin-top:5px">On the basis of control carried out, it is hereby certified that the information herein is correct and that the goods described comply with the origin requirements specified in the Regional Comprehensive Economic Partnership Agreement.</div>
<div style="margin-top:28px;text-align:center">DONG NAI,<br>........................................................<br><span style="font-size:9px">Place and date, signature and seal or stamp of Issuing Body</span></div>
</td>
</tr>
</table>

<table style="border:1.5px solid #000;border-top:none">
<tr><td style="padding:5px 8px">17.&nbsp; ${chk(ov.backToBack)} Back-to-back Certificate of Origin &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${chk(ov.thirdParty)} Third-party invoicing &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${chk(ov.retro)} ISSUED RETROACTIVELY</td></tr>
</table>` : ""}
</div>`;
  }).join("");

  const fname = `Draft CO ${CO_TYPE_LABEL[type]} ${(s.invoiceNo||"").replace(/[\/\-]/g," ").trim()}`.trim();
  coOpenPrintWindow(pagesHtml, fname);
}

// ---------- AJ ----------
function renderCOPrintAJ(s, groups, ov) {
  const orders = groups.flatMap(g => g.lines.map(o => ({ ...o, _color: g.color })));
  const totalCtns = orders.reduce((a,o)=>a+(parseFloat(o.ctns)||0),0);
  const signDate = coFmtSignDate(s.etd);
  const certNo = coFmtCertNo(s.etd);
  const chk = (b) => b ? "&#9746;" : "&#9633;";

  const marksParts = [];
  if (ov.showCtns) marksParts.push(`${Math.round(totalCtns).toLocaleString()} CTNS`);
  if (ov.showShipMark) marksParts.push((s.shipMark||"").replace(/\n/g,"<br>"));
  const marksHTML = marksParts.join("<br>");

  const pages = coChunk(orders, CO_ROWS_PER_PAGE);
  const pagesHtml = pages.map((pageOrders, pIdx) => {
    const isLast = pIdx === pages.length - 1;
    const startNum = pIdx * CO_ROWS_PER_PAGE;
    const rowSpanCount = 1 + pageOrders.length;

    const itemRows = pageOrders.map((o,i) => `<tr style="font-size:9px;height:20px">
      <td style="border-right:1px solid #000;text-align:center">${startNum+i+1}</td>
      <td style="border-right:1px solid #000;padding:2px 4px;background:${o._color||"transparent"}">
        <table style="width:100%"><tr><td style="width:55px;padding:1px 2px">${o.hsCode||""}</td><td style="width:65px;padding:1px 2px">${o.contract||""}</td><td style="padding:1px 2px">${o.index||o.items||""}</td></tr></table>
      </td>
      <td style="border-right:1px solid #000;text-align:center">CTC</td>
      <td style="border-right:1px solid #000;text-align:right;padding:2px 4px">${Math.round(parseFloat(o.qty)||0).toLocaleString()} PCS</td>
    </tr>`).join("");

    return `<div class="${isLast ? "co-page co-page-last" : "co-page"}">
<div style="text-align:right;font-weight:bold;font-size:10px;margin-bottom:4px">ORIGINAL</div>
<table style="border:1.5px solid #000">
<tr>
<td style="width:56%;border-right:1.5px solid #000;border-bottom:1.5px solid #000;padding:5px;vertical-align:top">
<b>1. Goods consigned from (Exporter's name, address, country)</b><br>
${(ov.shipperText||"").replace(/\n/g,"<br>")}
</td>
<td style="border-bottom:1.5px solid #000;padding:5px;vertical-align:top">
<div>Reference No. <b>${certNo}</b></div>
<div style="text-align:center;font-weight:bold;font-size:8px;margin-top:5px">THE AGREEMENT ON COMPREHENSIVE ECONOMIC<br>PARTNERSHIP AMONG MEMBER STATES OF THE<br>ASSOCIATION OF SOUTHEAST ASIAN NATIONS AND JAPAN<br>(AJCEP AGREEMENT)</div>
<div style="text-align:center;font-weight:bold;font-size:10.5px;margin-top:5px">CERTIFICATE OF ORIGIN</div>
<div style="text-align:center;margin-top:5px"><span style="background:#FFFF00;font-weight:bold;padding:0 4px">FORM AJ</span></div>
<div style="text-align:center;margin-top:5px">Issued in <u>VIET NAM</u><br><span style="font-size:8.5px">(Country)</span> <span style="font-size:8.5px">See Notes Overleaf</span></div>
</td>
</tr>
<tr>
<td style="border-right:1.5px solid #000;padding:0;vertical-align:top">
<div style="border-bottom:1px solid #000;padding:5px">
<b>2. Goods consigned to (Importer's/Consignee's name, address, country)</b><br>
${(ov.consigneeText||"").replace(/\n/g,"<br>")}
</div>
<div style="padding:5px">
<b>3. Means of transport and route (as far as known)</b><br>
FROM: HOCHIMINH, VIETNAM
<div style="margin-top:4px">Shipment date &nbsp;&nbsp;${ov.depDate||""}</div>
<div style="margin-top:4px">Vessel's name/Aircraft etc. &nbsp;${ov.vessel||""}</div>
<div style="margin-top:4px">Port of discharge &nbsp;${ov.pod||""}</div>
</div>
</td>
<td style="padding:5px;vertical-align:top">
<b>4. For Official Use</b>
<div style="display:flex;gap:6px;margin-top:6px"><span>&#9633;</span><span>Preferential Treatment Given Under AJCEP Agreement</span></div>
<div style="display:flex;gap:6px;margin-top:6px"><span>&#9633;</span><span>Preferential Treatment Not Given (Please state reason/s)</span></div>
<div style="height:22px"></div>
<div style="text-align:center">........................................................................<br><span style="font-size:8.5px">Signature of Authorised Signatory of the Importing Country</span></div>
</td>
</tr>
</table>

<table style="border:1.5px solid #000;border-top:none">
<colgroup><col style="width:6%"><col style="width:11%"><col style="width:39%"><col style="width:14%"><col style="width:16%"><col style="width:14%"></colgroup>
<tr style="text-align:center;font-weight:bold;font-size:8px">
<td style="border-right:1px solid #000;padding:3px">5. Item number</td>
<td style="border-right:1px solid #000;padding:3px">6. Marks and numbers of packages</td>
<td style="border-right:1px solid #000;padding:3px">7. Number and type of packages, description of goods (including quantity where appropriate and HS number of the importing Party)</td>
<td style="border-right:1px solid #000;padding:3px">8. Origin criteria (see Notes overleaf)</td>
<td style="border-right:1px solid #000;padding:3px">9. Gross weight or other quantity and value (FOB only when RVC criterion is used)</td>
<td style="padding:3px">10. Number and date of invoices</td>
</tr>
<tr style="font-size:9px">
<td style="border-right:1px solid #000;border-top:1px solid #000"></td>
<td rowspan="${rowSpanCount}" style="border-right:1px solid #000;border-top:1px solid #000;text-align:center;vertical-align:top;padding-top:3px">${marksHTML}</td>
<td style="border-right:1px solid #000;border-top:1px solid #000;padding:2px 4px">
<div style="font-weight:bold">${ov.goodsDescription||""}</div>
<div style="margin-top:2px">HS CODE</div>
</td>
<td style="border-right:1px solid #000;border-top:1px solid #000"></td>
<td style="border-right:1px solid #000;border-top:1px solid #000"></td>
<td rowspan="${rowSpanCount}" style="border-top:1px solid #000;text-align:center;vertical-align:top;padding-top:3px">${s.invoiceNo||""}<br>DATE: ${s.invoiceDate||""}</td>
</tr>
${itemRows}
${coFillerRows(CO_ROWS_PER_PAGE - pageOrders.length, 6, 20)}
</table>

${isLast ? `
<table style="border:1.5px solid #000;border-top:none;font-size:9px">
<tr>
<td style="width:50%;border-right:1px solid #000;padding:5px;vertical-align:top">
<b style="font-size:9.5px">11. Declaration by the exporter</b>
<div style="margin-top:4px">The undersigned hereby declares that the above details and statements are correct; that all the goods were produced in</div>
<div style="margin-top:8px;text-align:center">.............<b>VIETNAM</b>.............<br><span style="font-size:8px">(Country)</span></div>
<div style="margin-top:6px">and that they comply with the requirements specified for these goods in the AJCEP Agreement for the goods exported to</div>
<div style="margin-top:8px;text-align:center">.............<b>JAPAN</b>.............<br><span style="font-size:8px">(importing Country)</span></div>
<div style="margin-top:12px;text-align:center">DONG NAI, ${signDate}<br>........................................<br><span style="font-size:8px">Place and date, name, signature and company of authorised signatory</span></div>
</td>
<td style="padding:5px;vertical-align:top">
<b style="font-size:9.5px">12. Certification</b>
<div style="margin-top:4px">It is hereby certified, on the basis of control carried out, that the declaration by the exporter is correct.</div>
<div style="height:70px"></div>
<div style="text-align:center">DONG NAI,<br>........................................................<br><span style="font-size:8px">Place and date, signature and stamp of certifying authority</span></div>
</td>
</tr>
</table>

<table style="border:1.5px solid #000;border-top:none">
<tr><td style="padding:4px 8px;font-size:10px">13.&nbsp; ${chk(ov.thirdCountry)} Third Country Invoicing &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${chk(ov.backToBack)} Back-to-Back CO &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${chk(ov.retro)} Issued Retroactively</td></tr>
</table>` : ""}
</div>`;
  }).join("");

  const fname = `Draft CO AJ ${(s.invoiceNo||"").replace(/[\/\-]/g," ").trim()}`.trim();
  coOpenPrintWindow(pagesHtml, fname);
}

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
function totalCtnsShip(s){ return (s.orders||[]).reduce((a,o)=>a+(parseFloat(o.ctns)||0),0); }

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
      <td style="text-align:right">${Math.round(totalCtnsShip(s)).toLocaleString()}</td>
      <td style="text-align:right">${Math.round(totalGW(s)).toLocaleString()}</td>
      <td style="text-align:right">${(Math.round(totalCBM(s)*100)/100).toLocaleString()}</td>
      <td>${hinhthuc}</td>
    </tr>`;
  }).join("");

  const sumCtns = Math.round(list.reduce((a,s)=>a+totalCtnsShip(s),0));
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
    <th style="width:30px">STT</th><th style="width:65px">Ngày đóng hàng</th>
    <th style="width:130px">Khách hàng — Cảng</th><th style="width:55px">Số Carton</th>
    <th style="width:70px">G.W (KGS)</th>
    <th style="width:55px">CBM</th><th>Hình thức xuất</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr>
    <td colspan="3" style="text-align:right">TỔNG CỘNG</td>
    <td style="text-align:right">${sumCtns.toLocaleString()}</td>
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
function showListView(month) {
  document.getElementById("calendar-view").style.display = "none";
  document.getElementById("list-view").style.display = "block";
  if (month !== undefined) document.getElementById("filter-month").value = month;
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
  const s = allShipments.find(x=>x.id===id);
  ["filter-status","filter-customer","filter-invoice"].forEach(fid => {
    const el = document.getElementById(fid); if (el) el.value = "";
  });
  openShipmentPopup(id, s?.period ?? "");
};

document.getElementById("btn-home").addEventListener("click", showCalendar);
document.getElementById("btn-nav-list").addEventListener("click", () => showListView(calMonth));
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
      return `<div class="cal-tag ${e.type}" onclick="openShipmentPopup('${e.s.id}','${e.s.period||''}')">
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
window.openShipmentPopup = function(shipId, month) {
  showListView(month !== undefined ? month : calMonth);
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
    } else {
      // Lô không nằm trong tháng đang lọc → bỏ lọc tháng rồi thử lại
      document.getElementById("filter-month").value = "";
      renderList();
      setTimeout(() => {
        const card2 = document.getElementById("card-"+shipId);
        if (card2) {
          card2.scrollIntoView({behavior:"smooth", block:"center"});
          card2.style.transition = "box-shadow .3s";
          card2.style.boxShadow = "0 0 0 3px #185FA5";
          setTimeout(()=>{ card2.style.boxShadow = ""; }, 1600);
        }
      }, 100);
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
