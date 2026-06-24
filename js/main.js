import { db } from "./firebase-config.js";
import { isAdmin, loginAdmin, logoutAdmin } from "./auth.js";
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
  const admin = isAdmin();
  document.getElementById("admin-indicator").style.display = admin ? "flex" : "none";
  document.getElementById("login-label").textContent = admin ? "Đăng xuất" : "Đăng nhập";
  document.getElementById("btn-add-shipment").style.display = admin ? "flex" : "none";
  document.getElementById("btn-import-plan").style.display = admin ? "flex" : "none";
  renderList();
}

document.getElementById("btn-login-toggle").addEventListener("click", () => {
  if (isAdmin()) { logoutAdmin(); showToast("Đã đăng xuất"); updateAdminUI(); }
  else openModal("modal-login");
});
document.getElementById("btn-do-login").addEventListener("click", () => {
  const pw = document.getElementById("f-admin-pw").value;
  if (loginAdmin(pw)) {
    closeModal("modal-login");
    document.getElementById("f-admin-pw").value = "";
    document.getElementById("login-error").style.display = "none";
    showToast("Đăng nhập thành công!");
    updateAdminUI();
  } else {
    document.getElementById("login-error").style.display = "block";
  }
});
document.getElementById("f-admin-pw").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("btn-do-login").click();
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

  const dotsHTML = CHECKLIST_STEPS.map(step => {
    const state = (s.checklist||{})[step.id] || "pending";
    let cls = "ck" + (state==="done"?" done":state==="skip"?" skip":"");
    const inner = state==="done"?`<i class="ti ti-check" style="font-size:11px"></i>`
                : state==="skip"?`<i class="ti ti-minus" style="font-size:11px"></i>`:step.short;
    return `<div class="${cls}" title="${step.label}" ${admin?"style='cursor:pointer'":""} onclick="${admin?`ckToggle('${s.id}',${step.id},'${state}',${step.skippable})`:''}">${inner}</div>`;
  }).join("");

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
    <div style="padding:14px 16px">
      <div class="card-row1">
        <div>
          <div class="card-title">${custLabel}${fullPort(s.port)}
            <span class="badge ${isAir?"badge-gray":"badge-blue"}">${s.container||"?"}</span>
          </div>
          <div class="card-meta">Đóng hàng: ${formatDate(s.stuffingDate)||"—"} · Ship: ${formatDate(s.shipDate)} · ${(s.orders||[]).length} đơn hàng</div>
        </div>
        <div class="card-right" style="display:flex;flex-direction:row;align-items:center;gap:10px">
          <span class="period-label" ${admin?`onclick="editPeriod('${s.id}')" style="cursor:pointer;font-size:12px;font-weight:500;color:var(--blue-text);border:0.5px dashed var(--blue-border);padding:3px 8px;border-radius:var(--radius-md)" title="Bấm để sửa tháng"`:`style="font-size:12px;font-weight:500;color:var(--blue-text)"`}>${periodLabel || (admin?"+ Gán tháng":"")}</span>
          <span class="badge ${status.cls}">${status.label}</span>
          <button class="btn btn-sm" onclick="toggleCard('${s.id}')" style="padding:4px 10px">
            <i class="ti ti-chevron-down chevron" id="cv-${s.id}"></i>
          </button>
        </div>
      </div>
      <div class="vessel-info" style="margin-top:6px">
        <span><i class="ti ti-${isAir?"plane":"ship"}"></i>${s.vessel||"Chưa có tàu"}</span>
        <span><i class="ti ti-calendar"></i>ETD ${formatDate(s.etd)||"—"}</span>
        <span><i class="ti ti-map-pin"></i>ETA ${formatDate(s.eta)||"—"}</span>
        <span><i class="ti ti-cut"></i>Cắt máng ${formatDate(s.cyCut)||"—"}${s.cyCutTime?` ${s.cyCutTime}`:""}</span>
        ${s.booking?`<span><i class="ti ti-bookmark"></i>Booking: ${s.booking}</span>`:""}
        ${(() => {
          const conts = (s.containers && s.containers.length) ? s.containers
                      : (s.contNo||s.sealNo) ? [{type:"",no:s.contNo,seal:s.sealNo}] : [];
          if (isAir || (s.container||"").toUpperCase().includes("LCL") || !conts.length) return "";
          return conts.map(c => `<span><i class="ti ti-box"></i>${c.type?c.type+" ":""}Cont: ${c.no||"—"} / Seal: ${c.seal||"—"}</span>`).join("");
        })()}
        ${s.invoiceNo?`<span><i class="ti ti-file-invoice"></i>INV: ${s.invoiceNo}</span>`:""}
        ${s.lcId?`<span><i class="ti ti-credit-card"></i>Đã gán LC</span>`:""}
      </div>
      <div class="checklist" style="margin-top:8px">${dotsHTML}</div>
      <div class="progress-wrap" style="margin-top:6px">
        <span class="prog-label">${done} / ${total} bước</span>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${progColor(pct)}"></div></div>
        <span class="prog-label">${pct}%</span>
      </div>
    </div>
    <div class="card-detail" id="detail-${s.id}">
      <div style="display:flex;align-items:stretch">
        <div style="flex:1;min-width:0;overflow-x:auto">
          <div class="detail-inner">
            ${buildReadonlyTable(s.orders||[])}
            <div class="action-row" style="margin-top:10px">
              ${admin ? `<button class="btn btn-sm btn-primary" onclick="openEditOrders('${s.id}')"><i class="ti ti-table"></i> Chỉnh sửa (Excel)</button>` : ""}
              <button class="btn btn-sm" onclick="openEmailModal('${s.id}')"><i class="ti ti-mail"></i> Generate email</button>
              <button class="btn btn-sm" onclick="openPackingList('${s.id}')"><i class="ti ti-file-text"></i> In Packing List</button>
              ${admin ? `<button class="btn btn-sm" onclick="openAssignLC('${s.id}')"><i class="ti ti-credit-card"></i> Gán LC</button>` : ""}
              ${admin ? `<button class="btn btn-sm" onclick="openEditShipment('${s.id}')"><i class="ti ti-edit"></i> Sửa lô hàng</button>` : ""}
              ${admin ? `<button class="btn btn-sm btn-danger" onclick="deleteShipment('${s.id}')"><i class="ti ti-trash"></i> Xóa lô</button>` : ""}
            </div>
          </div>
        </div>
        <div style="width:210px;flex-shrink:0;border-left:0.5px solid var(--border);padding:12px;background:var(--bg-secondary)">
          <div style="font-size:11px;font-weight:500;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">Tiến trình</div>
          <div class="ck-list">${listHTML}</div>
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
  const rows = orders.map(o => `<tr>
    <td>${o.customer||"—"}</td><td>${o.contract||"—"}</td><td>${o.index||"—"}</td><td>${o.items||"—"}</td>
    <td class="qty-pcs">${(parseFloat(o.qty)||0).toLocaleString()}</td><td>${parseFloat(o.ctns)||0}</td>
    <td>${parseFloat(o.kgTotal)||0}</td><td>${parseFloat(o.cbm)||0}</td>
    <td>${o.hsCode||"—"}</td><td>${o.coForm||"—"}</td><td style="font-size:11px;color:var(--text-muted)">${o.note||""}</td>
  </tr>`).join("");
  return `<table class="data-table">
    <colgroup><col style="width:90px"><col style="width:80px"><col style="width:85px"><col style="width:90px">
    <col style="width:65px"><col style="width:50px"><col style="width:60px"><col style="width:55px">
    <col style="width:65px"><col style="width:65px"><col style="width:auto"></colgroup>
    <thead><tr><th>Customer</th><th>Contract</th><th>Index</th><th>Items</th>
    <th>Qty PCS</th><th>CTNs</th><th>Qty Kgs</th><th>CBM</th><th>HS Code</th><th>C/O Form</th><th>Note</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4" style="color:var(--text-muted)">Tổng (${orders.length} đơn)</td>
    <td class="qty-pcs">${tPcs.toLocaleString()}</td><td>${tCtns}</td>
    <td>${Math.round(tKg*10)/10}</td><td>${Math.round(tCbm*100)/100}</td><td colspan="3"></td></tr></tfoot>
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
        <div class="form-group"><label class="form-label">Quy cách (Container)</label><input class="form-input" id="es-container" value="${s.container||""}" placeholder="1x20GP, 40HC, AIR..."></div>
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
    document.querySelectorAll("#es-cont-list .es-cont-row").forEach(row => {
      const type = row.querySelector(".ec-type").value;
      const no   = row.querySelector(".ec-no").value.trim();
      const seal = row.querySelector(".ec-seal").value.trim();
      if (no || seal) containers.push({ type, no, seal });
    });
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
  function addContRow(c = {}) {
    const row = document.createElement("div");
    row.className = "es-cont-row";
    row.style.cssText = "display:flex;gap:6px;margin-bottom:6px;align-items:center";
    row.innerHTML = `
      <select class="form-select ec-type" style="width:90px;flex-shrink:0">
        ${["20GP","40DC","40HC"].map(t=>`<option value="${t}" ${c.type===t?"selected":""}>${t}</option>`).join("")}
      </select>
      <input class="form-input ec-no" placeholder="Số cont" value="${c.no||""}" style="flex:1">
      <input class="form-input ec-seal" placeholder="Số seal" value="${c.seal||""}" style="flex:1">
      <button type="button" class="btn btn-sm btn-danger ec-del" style="flex-shrink:0;padding:6px 9px"><i class="ti ti-x"></i></button>`;
    row.querySelector(".ec-del").addEventListener("click", () => row.remove());
    contListEl.appendChild(row);
  }
  // Nạp dữ liệu cũ: ưu tiên mảng containers, fallback contNo/sealNo cũ
  const existing = (s.containers && s.containers.length) ? s.containers
                 : (s.contNo||s.sealNo) ? [{type:"20GP", no:s.contNo||"", seal:s.sealNo||""}] : [];
  if (existing.length) existing.forEach(addContRow); else addContRow();
  document.getElementById("es-add-cont").addEventListener("click", () => addContRow());
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
  await updateDoc(doc(db,"shipments",shipId), { lcId: lcId || null });
  closeModal("modal-assign-lc");
  showToast(lcId ? "Đã gán LC cho lô hàng!" : "Đã bỏ gán LC.");
};

// ====== PACKING LIST ======
window.openPackingList = function(shipId) {
  const s = allShipments.find(x=>x.id===shipId);
  if (!s) return;
  const isAir = (s.container||"").toUpperCase().includes("AIR");
  const isLcl = (s.container||"").toUpperCase().includes("LCL");
  const showCont = !isAir && !isLcl;

  document.getElementById("packing-form-body").innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">Điền thông tin cho lần in này.${showCont?" Container lấy tự động từ lô hàng (sửa ở 'Sửa lô hàng').":""}</div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Invoice No.</label><input class="form-input" id="pk-invoice" value="${s.invoiceNo||""}" placeholder="862/26 -NPT"></div>
      <div class="form-group"><label class="form-label">Invoice Date</label><input type="date" class="form-input" id="pk-invdate" value="${s.invoiceDate||s.etd||""}"></div>
    </div>
    <input type="hidden" id="pk-contno" value=""><input type="hidden" id="pk-sealno" value="">
    <div class="form-group">
      <label class="form-label">Tare thùng (kg/thùng) — để tính Net Weight</label>
      <div style="display:flex;gap:8px">
        ${[1,1.5,2,2.5].map((t,i) => `<label style="flex:1;display:flex;align-items:center;justify-content:center;gap:5px;padding:8px;border:0.5px solid var(--border-md);border-radius:var(--radius-md);cursor:pointer">
          <input type="radio" name="pk-tare" value="${t}" ${i===0?"checked":""}> ${t}kg
        </label>`).join("")}
      </div>
    </div>
    ${showCont ? `<div class="form-group"><label class="form-label">TARE (trọng lượng vỏ container, kg)</label><input type="number" class="form-input" id="pk-tarecont" placeholder="2120"></div>` : `<input type="hidden" id="pk-tarecont" value="0">`}
    <div class="form-footer">
      <button type="button" class="btn" onclick="closeModalById('modal-packing')">Hủy</button>
      <button type="button" class="btn btn-primary" onclick="generatePackingList('${shipId}')"><i class="ti ti-printer"></i> Tạo & In</button>
    </div>`;
  openModal("modal-packing");
};

window.generatePackingList = async function(shipId) {
  const s = allShipments.find(x=>x.id===shipId);
  if (!s) return;

  const invoice  = document.getElementById("pk-invoice").value.trim();
  const invDate  = document.getElementById("pk-invdate").value;
  const tarePerCtn = parseFloat(document.querySelector('input[name="pk-tare"]:checked')?.value)||0;
  const tareCont = parseFloat(document.getElementById("pk-tarecont").value)||0;

  // Lưu Invoice vào lô (cont/seal đã nhập ở form sửa lô)
  const invVal = document.getElementById("pk-invoice").value.trim();
  if (invVal && invVal !== s.invoiceNo) {
    await updateDoc(doc(db,"shipments",shipId), { invoiceNo: invVal, invoiceDate: invDate||null });
  }

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

  // Gộp đơn hàng theo Index (mã hàng) — hiển thị theo dòng
  const orders = s.orders || [];
  const totalCtns = orders.reduce((a,o)=>a+(parseFloat(o.ctns)||0),0);
  const totalPcs  = orders.reduce((a,o)=>a+(parseFloat(o.qty)||0),0);
  const totalGW   = orders.reduce((a,o)=>a+(parseFloat(o.kgTotal)||0),0);  // kgTotal = GW
  const totalNW   = totalGW - (tarePerCtn * totalCtns);
  const totalCBM  = orders.reduce((a,o)=>a+(parseFloat(o.cbm)||0),0);
  const vgm = Math.round(totalGW + tareCont);

  closeModal("modal-packing");
  renderPackingA4(s, cust, { invoice: invVal, invDate, tarePerCtn, tareCont,
    totalCtns, totalPcs, totalGW, totalNW, totalCBM, vgm });
};

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
      <td style="text-align:right;padding:2px 4px">${o.kgTotal?fmtNum((parseFloat(o.kgTotal)||0)-(p.tarePerCtn*(parseFloat(o.ctns)||0))):""}</td>
      <td style="text-align:right;padding:2px 4px">${o.kgTotal?fmtNum(o.kgTotal):""}</td>
      <td style="text-align:right;padding:2px 4px">${o.cbm?fmtNum(o.cbm):""}</td>
    </tr>`).join("");

  const conts = (s.containers && s.containers.length) ? s.containers
              : (s.contNo||s.sealNo) ? [{type:"",no:s.contNo,seal:s.sealNo}] : [];
  const contLine = conts.length
    ? conts.map(c => `${c.type||s.container||""} : ${c.no||""}/ ${c.seal||""}`).join("<br>")
    : `${s.container||""}`;

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
  <div class="company-info">LOT B1, LONG BINH TECHNO PARK(LOTECO)EPZ,LONG BINH WARD, DONG NAI PROVINCE, VIETNAM</div>
  <div class="company-info">TEL: 84 - 61 - 3992537&nbsp;&nbsp;&nbsp;&nbsp;FAX: 84 - 61 - 3992540&nbsp;&nbsp;&nbsp;&nbsp;E-MAIL: tos2@tosg.vnn.vn</div>
</div>

<div class="title">PACKING LIST/ WEIGHT LIST</div>

<table class="info">
  <tr>
    <td style="width:55%"><span class="label">MESSRS :</span><br><span style="white-space:pre-line">${cust.messrs||""}</span></td>
    <td><span class="label">INVOICE NO. AND DATE</span><br>${p.invoice||""} &nbsp;&nbsp;&nbsp; ${dateStr}<br><br><span class="label">TERM OF PAYMENT</span><br>T/T</td>
  </tr>
  <tr>
    <td><span class="label">CONSIGNEE:</span><br><span style="white-space:pre-line">${cust.consignee||""}</span></td>
    <td><span class="label">BOOKING NO.</span> &nbsp; ${s.booking||""}<br><br><span class="label">HDGC:</span> ${cust.hdgc||""}</td>
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
    <tr><td colspan="2" style="font-weight:bold;text-decoration:underline;padding:4px">${contLine}</td><td></td><td></td><td></td><td></td><td></td></tr>
    ${rows}
    <tr class="totals">
      <td colspan="2" style="padding:4px">TOTAL</td>
      <td style="text-align:right;padding:2px 4px">${fmtInt(p.totalCtns)}</td>
      <td style="text-align:right;padding:2px 4px">${fmtInt(p.totalPcs)}</td>
      <td style="text-align:right;padding:2px 4px">${fmtNum(p.totalNW)}</td>
      <td style="text-align:right;padding:2px 4px">${fmtNum(p.totalGW)}</td>
      <td style="text-align:right;padding:2px 4px">${fmtNum(p.totalCBM)}</td>
    </tr>
    <tr class="totals"><td colspan="2" style="padding:4px">TARE</td><td colspan="3"></td><td style="text-align:right;padding:2px 4px">${fmtNum(p.tareCont)}</td><td></td></tr>
    <tr class="totals"><td colspan="2" style="padding:4px">VGM</td><td colspan="3"></td><td style="text-align:right;padding:2px 4px">${fmtInt(p.vgm)}</td><td></td></tr>
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
  renderCalendar();
}
function showListView() {
  document.getElementById("calendar-view").style.display = "none";
  document.getElementById("list-view").style.display = "block";
  renderList();
}

document.getElementById("btn-home").addEventListener("click", showCalendar);
document.getElementById("btn-show-list").addEventListener("click", showListView);
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

  // Ô tháng trước
  for (let i=0; i<startDow; i++) {
    const d = prevDays - startDow + i + 1;
    cells += `<div class="cal-cell other"><div class="cal-daynum other">${d}</div></div>`;
  }
  // Ô trong tháng
  for (let d=1; d<=daysInMonth; d++) {
    const dateStr = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const dow = new Date(y, m-1, d).getDay();
    const isToday = dateStr === todayStr;
    const evs = events[dateStr] || [];
    const tags = evs.map(e => {
      const custs = [...new Set((e.s.orders||[]).map(o=>o.customer).filter(Boolean))].join(", ") || "—";
      const inv = e.s.invoiceNo || e.s.booking || "";
      const icon = e.type==="pack" ? "package" : "ship";
      return `<div class="cal-tag ${e.type}" onclick="openShipmentPopup('${e.s.id}')">
        <i class="ti ti-${icon}"></i> ${custs}${inv?`<br><span style="opacity:0.85">${inv}</span>`:""}
      </div>`;
    }).join("");
    const numHTML = isToday ? `<div class="cal-today-num">${d}</div>`
                  : `<div class="cal-daynum ${dow===0?'sun':''}">${d}</div>`;
    cells += `<div class="cal-cell ${isToday?'today':''}">${numHTML}${tags}</div>`;
  }
  // Ô tháng sau cho đủ lưới
  const totalCells = startDow + daysInMonth;
  const trailing = (7 - (totalCells % 7)) % 7;
  for (let i=1; i<=trailing; i++) {
    cells += `<div class="cal-cell other"><div class="cal-daynum other">${i}</div></div>`;
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

// ====== FIRESTORE REALTIME ======
const q = query(collection(db,"shipments"), orderBy("createdAt","desc"));
onSnapshot(q, snap => {
  allShipments = snap.docs.map(d => ({id:d.id, ...d.data()}));
  renderList();
  if (document.getElementById("calendar-view").style.display !== "none") renderCalendar();
});

updateAdminUI();
showCalendar();  // trang chủ là lịch
