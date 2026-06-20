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
  // Bảng import có thêm cột "Quy cách" ở đầu để đánh dấu dòng tổng
  const importCols = [
    { data: "packing", title: "Quy cách (dòng tổng)", width: 130 },
    ...COLS
  ];
  if (importHot) { importHot.destroy(); importHot = null; }
  importHot = new Handsontable(cont, {
    data: emptyRows(60),
    columns: importCols,
    colHeaders: importCols.map(c => c.title),
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
      // Tự tính kgTotal & cbm
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
  // dd-mm hoặc dd/mm
  let m = str.match(/^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?$/);
  if (m) {
    const y = m[3] ? (m[3].length===2 ? "20"+m[3] : m[3]) : new Date().getFullYear();
    return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
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
    const packing = (row.packing || "").toString().trim();
    const hasItem = (row.items || "").toString().trim() || (row.customer || "").toString().trim();

    // Dòng tổng = có quy cách, không có item/customer
    if (packing && !hasItem) {
      if (current && current.orders.length) {
        current.container = packing;
        shipments.push(current);
        current = null;
      }
      continue;
    }
    if (!hasItem) continue;

    if (row.stuffingDate) ctxStuff = parseDate2(row.stuffingDate);
    if (row.etd)          ctxEtd   = parseDate2(row.etd);
    if (row.pod)          ctxPod   = String(row.pod).toUpperCase();

    if (!current) current = { stuffingDate: ctxStuff, etd: ctxEtd, pod: ctxPod, container: "", orders: [] };
    if (row.stuffingDate) current.stuffingDate = ctxStuff;
    if (row.etd)          current.etd = ctxEtd;
    if (row.pod)          current.pod = ctxPod;

    const o = computeRow({
      pod: row.pod ? String(row.pod).toUpperCase() : ctxPod,
      customer: row.customer||"", contract: row.contract||"",
      index: row.index||"", items: row.items||"",
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
  const container = document.getElementById("shipment-list");
  const admin = isAdmin();

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
  const card = document.createElement("div");
  card.className = "shipment-card";
  card.id = "card-"+s.id;

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

  card.innerHTML = `
    <div style="padding:14px 16px">
      <div class="card-row1">
        <div>
          <div class="card-title">${custLabel}${fullPort(s.port)}
            <span class="badge ${isAir?"badge-gray":"badge-blue"}">${s.container||"?"}</span>
          </div>
          <div class="card-meta">Đóng hàng: ${formatDate(s.stuffingDate)||"—"} · Ship: ${formatDate(s.shipDate)} · ${(s.orders||[]).length} đơn hàng</div>
        </div>
        <div class="card-right">
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
        <span><i class="ti ti-cut"></i>Cắt máng ${formatDate(s.cyCut)||"—"}</span>
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
      columns: COLS,
      colHeaders: COLS.map(c=>c.title),
      rowHeaders: true,
      height: 440,
      width: "100%",
      stretchH: "none",
      minSpareRows: 3,
      contextMenu: true,
      licenseKey: "non-commercial-and-evaluation",
      cells: (row, col) => {
        const cp = COLS[col];
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
        <div class="form-group"><label class="form-label">Ship Date *</label><input type="date" class="form-input" id="es-ship" value="${s.shipDate||""}" required></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Cảng (POD)</label><input class="form-input" id="es-port" value="${s.port||""}"></div>
        <div class="form-group"><label class="form-label">Quy cách (Container)</label><input class="form-input" id="es-container" value="${s.container||""}" placeholder="1x20GP, 40HC, AIR..."></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Tên tàu / Hãng bay</label><input class="form-input" id="es-vessel" value="${s.vessel||""}"></div>
        <div class="form-group"><label class="form-label">Ngày cắt máng</label><input type="date" class="form-input" id="es-cycut" value="${s.cyCut||""}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">ETD</label><input type="date" class="form-input" id="es-etd" value="${s.etd||""}"></div>
        <div class="form-group"><label class="form-label">ETA</label><input type="date" class="form-input" id="es-eta" value="${s.eta||""}"></div>
      </div>
      <div class="form-footer">
        <button type="button" class="btn" onclick="closeModalById('modal-edit-shipment')">Hủy</button>
        <button type="submit" class="btn btn-primary"><i class="ti ti-check"></i> Lưu</button>
      </div>
    </form>`;
  document.getElementById("form-edit-ship").addEventListener("submit", async e => {
    e.preventDefault();
    if (!confirm("Lưu thay đổi?")) return;
    await updateDoc(doc(db,"shipments",id), {
      stuffingDate: document.getElementById("es-stuffing").value||null,
      shipDate: document.getElementById("es-ship").value,
      port: document.getElementById("es-port").value.trim().toUpperCase(),
      container: document.getElementById("es-container").value.trim(),
      vessel: document.getElementById("es-vessel").value.trim()||null,
      cyCut: document.getElementById("es-cycut").value||null,
      etd: document.getElementById("es-etd").value||null,
      eta: document.getElementById("es-eta").value||null,
    });
    closeModal("modal-edit-shipment");
    showToast("Đã cập nhật lô hàng!");
  });
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
  let contact="—", consigneeName="—", consigneeAddr="—", description="SHIRTS", note="";
  const first = (s.orders||[])[0];
  if (first?.customer) {
    try {
      const { collection:col, query:q, where, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const snap = await getDocs(q(col(db,"customers"), where("name","==",first.customer)));
      if (!snap.empty) {
        const c = snap.docs[0].data();
        contact=c.contactPerson||"—"; consigneeName=c.consigneeName||"—";
        consigneeAddr=c.consigneeAddr||"—"; description=c.description||"SHIRTS"; note=c.note||"";
      }
    } catch(e){}
  }
  const contracts = [...new Set((s.orders||[]).map(o=>o.contract).filter(Boolean))].join(", ");
  const tPcs = (s.orders||[]).reduce((a,o)=>a+(parseFloat(o.qty)||0),0);
  const tCtns= (s.orders||[]).reduce((a,o)=>a+(parseFloat(o.ctns)||0),0);
  const tKg  = Math.round((s.orders||[]).reduce((a,o)=>a+(parseFloat(o.kgTotal)||0),0));
  const tCbm = Math.round((s.orders||[]).reduce((a,o)=>a+(parseFloat(o.cbm)||0),0)*100)/100;
  const etdStr = s.etd ? new Date(s.etd).toLocaleDateString("en-US",{month:"short",day:"2-digit",year:"numeric"}).toUpperCase() : "???";

  const txt = `Dear ${contact},

Please arrange for our NEW FCL BOOKING as follows!

${s.container||"???"} TO ${fullPort(s.port)}, JAPAN:

ETD: ~ ${etdStr}  TO: ${fullPort(s.port)}: ETA:???  VESSEL: AS YOUR ARRANGEMENT

Description: ${description}
Contract number: ${contracts}
Quantity: ${tPcs.toLocaleString()} pcs = (about) ${tCtns} cartons = (about) ${tKg} kgs = (about) ${tCbm} cbm

Consignee: ${consigneeName}
           ${consigneeAddr}
${note ? "\nNote: "+note : ""}

Best regards,`;
  document.getElementById("email-body").textContent = txt;
  openModal("modal-email");
};
document.getElementById("btn-copy-email").addEventListener("click", () => {
  navigator.clipboard.writeText(document.getElementById("email-body").textContent);
  showToast("Đã copy email!");
});

document.getElementById("filter-status").addEventListener("change", renderList);

// ====== FIRESTORE REALTIME ======
const q = query(collection(db,"shipments"), orderBy("createdAt","desc"));
onSnapshot(q, snap => {
  allShipments = snap.docs.map(d => ({id:d.id, ...d.data()}));
  renderList();
});

updateAdminUI();
