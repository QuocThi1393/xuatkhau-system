// ====== XUẤT CHỨNG TỪ (SI + CO) — tách từ main.js ======
import { db } from "./firebase-config.js";
import { isGuest, isAdmin } from "./auth.js";
import { showToast, fullPort, openModal, closeModal, pdfFileName, siCustomerName, normName, findCustomerByName, saveGuard } from "./utils.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Truy cập danh sách lô hàng do main.js quản lý
function shipments() { return (window.__getAllShipments ? window.__getAllShipments() : []); }

// ====== XUẤT SI (DRAFT B/L) ======
const SI_DEFAULT_SHIPPER = "TOMIYA SUMMIT GARMENT EXPORT CO., LTD.\nLOT B1, LONG BINH TECHNO PARK (LOTECO) EPZ,\nLONG BINH WARD, DONG NAI PROVINCE, VIET NAM\nTEL: 84-251-3992537       FAX: 84-251-3992540";
const SI_LC_CUSTOMERS = ["MITSUWA","SANMARINO","ACROS","HEMD"];

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
  if (isGuest()) { showToast("Tài khoản Khách chỉ được xem, không xuất chứng từ."); return; }

  const s = shipments().find(x=>x.id===shipId);
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
  const matchedFwd = allFwd.filter(f => (f.customers||[]).some(c => normName(c) === normName(custName)));

  // Thông tin khách hàng + SI mẫu đã lưu sẵn cho khách này
  const cust = await findCustomerByName(db, custName);
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
  const s = shipments().find(x=>x.id===shipId);
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
      // Ưu tiên số NHẬP TAY cho từng cont (ô "Chi tiết đóng" khi sửa lô).
      // Chưa nhập ô nào thì mới ước lượng theo tỉ lệ G.W.
      gwC = parseFloat(c.gw)||0;
      const ratio = totalGWv ? gwC/totalGWv : 0;
      ctnsC = (parseFloat(c.ctns)||0) || Math.round(totalCtns*ratio);
      nwC   = (parseFloat(c.nw)||0)   || Math.round(totalNW*ratio*100)/100;
      cbmC  = (parseFloat(c.cbm)||0)  || Math.round(totalCBMv*ratio*100)/100;
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
const CO_ROWS_PER_PAGE = 20;

function coShipperDefault(s) {
  const city = (s && s.lcId) ? "DONG NAI PROVINCE" : "DONG NAI CITY";
  return `TOMIYA SUMMIT GARMENT EXPORT CO., LTD\nLOT B1, LONG BINH TECHNO PARK (LOTECO) EPZ,\nLONG BINH WARD, ${city}, VIETNAM`;
}

function coChunk(arr, size) {
  const out = [];
  for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size));
  return out.length ? out : [[]];
}

// ====== MENU "CHỨNG TỪ" (gom 6 nút xuất file vào 1 nút xổ trên thẻ lô) ======
window.closeDocMenu = function() {
  document.getElementById("doc-floating-menu")?.remove();
  document.getElementById("co-floating-menu")?.remove();
};

window.toggleDocMenu = function(ev, shipId) {
  ev.stopPropagation();
  const existing = document.getElementById("doc-floating-menu");
  const wasForThisShip = existing && existing.dataset.ship === shipId;
  document.getElementById("co-floating-menu")?.remove();
  if (existing) existing.remove();
  if (wasForThisShip) return;

  const s = (window.__getAllShipments ? window.__getAllShipments() : []).find(x => x.id === shipId);
  const C = ((s && s.container) || "").toUpperCase();
  const noVGM = C.includes("AIR") || C.includes("CPN") || C.includes("KNQ");

  const btn = ev.currentTarget;
  const rect = btn.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.id = "doc-floating-menu";
  menu.dataset.ship = shipId;
  menu.style.cssText = "position:fixed;z-index:9999;background:var(--bg-card);border:0.5px solid var(--border);border-radius:var(--radius-md);box-shadow:0 4px 16px rgba(0,0,0,0.25);min-width:200px;overflow:hidden;font-size:13px;padding:4px 0";
  const mi = (icon, label, act) =>
    `<div class="doc-mi" onclick="closeDocMenu();${act}"><i class="ti ti-${icon}"></i><span>${label}</span></div>`;
  menu.innerHTML =
    mi("mail", "Generate email", `openEmailModal('${shipId}')`) +
    mi("file-text", "In Packing List", `openPackingList('${shipId}')`) +
    (noVGM ? "" : mi("scale", "Xuất VGM", `openVGM('${shipId}')`)) +
    mi("file-description", "Xuất SI (Draft B/L)", `openSI('${shipId}')`) +
    `<div class="doc-mi" onclick="toggleCoMenu(event,'${shipId}');document.getElementById('doc-floating-menu')?.remove()"><i class="ti ti-certificate"></i><span>Xuất Draft CO</span><i class="ti ti-chevron-right" style="margin-left:auto;font-size:13px"></i></div>` +
    mi("receipt", "Xuất Debit Note", `openDebitNote('${shipId}')`);
  document.body.appendChild(menu);

  const h = menu.offsetHeight || 210;
  if (window.innerHeight - rect.bottom < h + 12) menu.style.bottom = (window.innerHeight - rect.top + 4) + "px";
  else menu.style.top = (rect.bottom + 4) + "px";
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 216)) + "px";
};
document.addEventListener("click", (e) => {
  const m = document.getElementById("doc-floating-menu");
  if (m && !m.contains(e.target)) m.remove();
});

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
    <div style="padding:9px 14px;cursor:pointer;color:var(--text-muted)" onclick="showToast('CO Form D: đang chờ mẫu, sẽ cập nhật sau!')">CO Form D <span style="font-size:10px">(sắp có)</span></div>
    <div style="padding:9px 14px;cursor:pointer;color:var(--text-muted)" onclick="showToast('CO Form E: đang chờ mẫu, sẽ cập nhật sau!')">CO Form E <span style="font-size:10px">(sắp có)</span></div>
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
  if (isGuest()) { showToast("Tài khoản Khách chỉ được xem, không xuất chứng từ."); return; }

  const menu = document.getElementById("co-floating-menu");
  if (menu) menu.remove();
  const s = shipments().find(x=>x.id===shipId);
  if (!s) return;
  const lines = coFilterOrders(s, type);
  if (!lines.length) {
    showToast(`Lô hàng không có dòng hàng dùng CO ${CO_TYPE_LABEL[type]}!`);
    return;
  }
  const groups = coGroupByHsCode(lines);

  const custName = siCustomerName(s);
  const cust = await findCustomerByName(db, custName);
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
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Tên hàng (box 8)</label>
          <input class="form-input" id="cod-goods" value="${goodsDescription}">
        </div>
        <div class="form-group">
          <label class="form-label">8. Number and kind of packages — hiện cột nào</label>
          <div style="display:flex;gap:16px;padding-top:8px">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="cod-contract" checked> Contract</label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="cod-index" checked> Index</label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="cod-items" checked> Items</label>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">7. Marks and numbers on packages</label>
          <div style="display:flex;gap:16px;padding-top:8px">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="cod-rcep-shipmark"> Shipping Mark</label>
          </div>
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
  const s = shipments().find(x=>x.id===d.shipId);
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
      goodsDescription: document.getElementById("cod-goods").value,
      depDate: document.getElementById("cod-depdate").value,
      vessel: document.getElementById("cod-vessel").value,
      pod: document.getElementById("cod-pod").value,
      showContract: document.getElementById("cod-contract").checked,
      showIndex: document.getElementById("cod-index").checked,
      showItems: document.getElementById("cod-items").checked,
      showShipMark: document.getElementById("cod-rcep-shipmark").checked,
      backToBack: document.getElementById("cod-backtoback").checked,
      thirdParty: document.getElementById("cod-thirdparty").checked,
      retro: document.getElementById("cod-retro").checked,
    };
    closeModal("modal-co-draft");
    renderCOPrintRCEP(s, d.type, d.groups, overrides.goodsDescription || d.goodsDescription, overrides);
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

    const rows = pageOrders.map((o,i) => `<tr style="font-size:9px;height:18px">
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
<td style="border-right:1px solid #000;vertical-align:top;padding:2px 3px;font-size:8px;white-space:pre-line;word-break:break-word">${ov.showShipMark ? (s.shipMark||"").replace(/</g,"&lt;") : ""}</td>
<td style="border-right:1px solid #000;text-align:center;font-weight:bold">${Math.round(totalCtns).toLocaleString()} CTNS &nbsp;&nbsp; ${goodsDescription}</td>
<td style="border-right:1px solid #000"></td>
<td style="border-right:1px solid #000"></td>
<td style="border-right:1px solid #000"></td>
<td style="border-right:1px solid #000"></td>
<td rowspan="${rowSpanCount}" style="text-align:center;vertical-align:top;padding-top:4px">${s.invoiceNo||""}<br>DATE: ${s.invoiceDate||""}</td>
</tr>
${rows}
${coFillerRows(CO_ROWS_PER_PAGE - pageOrders.length, 8, 18)}
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

    const itemRows = pageOrders.map((o,i) => `<tr style="font-size:9px;height:18px">
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
${coFillerRows(CO_ROWS_PER_PAGE - pageOrders.length, 6, 18)}
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



// ====== PACKING LIST + VGM (chuyển từ main.js) ======
window.openPackingList = async function(shipId) {
  if (isGuest()) { showToast("Tài khoản Khách chỉ được xem, không xuất chứng từ."); return; }

  const s = shipments().find(x=>x.id===shipId);
  if (!s) return;

  // Lấy thông tin khách hàng
  const firstCust = (s.orders||[])[0]?.customer;
  const cust = await findCustomerByName(db, firstCust);

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
  if (isGuest()) { showToast("Tài khoản Khách chỉ được xem, không xuất chứng từ."); return; }

  const s = shipments().find(x=>x.id===shipId);
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


// ====================================================================
// XUẤT DEBIT NOTE (Commercial Invoice + Debit Note, 1 file PDF 2 trang)
// ====================================================================
const DN_BANK_TEXT = "MUFG Bank, Ltd., Ho Chi Minh City Branch\n\nAccount No: 237191 (USD)\nSwift: BOTKVNVX\nAccount Name: TOMIYA SUMMIT GARMENT EXPORT CO., LTD";
const DN_FCA_KEYS = ["AIR","OCS","DHL","FEDEX","EMS","UPS","TNT"];
const DN_SIGNER_FALLBACK = { signerName: "NGUYEN THI OANH", signerTitle: "IMP-EXP DEPT LEADER" };

function dnEsc(str) {
  return (str==null ? "" : String(str)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function dnNl2br(str) { return dnEsc(str).replace(/\n/g,"<br>"); }
function dnMoney(n) { return Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function dnInt(n) { return Math.round(n||0).toLocaleString("en-US"); }
function dnDate(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d)) return "";
  return `${d.toLocaleString("en-US",{month:"short"}).toUpperCase()} ${String(d.getDate()).padStart(2,"0")}, ${d.getFullYear()}`;
}
function dnTotalCartons(s) {
  return (s.orders||[]).reduce((a,o)=>a+(parseFloat(o.ctns)||0),0);
}
function dnDefaultPriceTerm(s) {
  const c = (s.container||"").toUpperCase();
  return DN_FCA_KEYS.some(k=>c.includes(k)) ? "(FCA)" : "(FOB)";
}

// Đổi số tiền USD ra chữ tiếng Anh, kiểu "THIRTY SEVEN THOUSAND EIGHT HUNDRED FORTY FOUR DOLLARS AND SEVENTY SIX CENTS"
function dnWordsUSD(amount) {
  const ones = ["","ONE","TWO","THREE","FOUR","FIVE","SIX","SEVEN","EIGHT","NINE","TEN",
    "ELEVEN","TWELVE","THIRTEEN","FOURTEEN","FIFTEEN","SIXTEEN","SEVENTEEN","EIGHTEEN","NINETEEN"];
  const tens = ["","","TWENTY","THIRTY","FORTY","FIFTY","SIXTY","SEVENTY","EIGHTY","NINETY"];
  function threeDigits(n) {
    let s = "";
    if (n >= 100) { s += ones[Math.floor(n/100)] + " HUNDRED "; n %= 100; }
    if (n >= 20) { s += tens[Math.floor(n/10)] + " "; n %= 10; if (n) s += ones[n] + " "; }
    else if (n > 0) { s += ones[n] + " "; }
    return s;
  }
  function intToWords(n) {
    if (n === 0) return "ZERO";
    let s = "";
    const billions = Math.floor(n / 1e9); n %= 1e9;
    const millions = Math.floor(n / 1e6); n %= 1e6;
    const thousands = Math.floor(n / 1e3); n %= 1e3;
    if (billions) s += threeDigits(billions) + "BILLION ";
    if (millions) s += threeDigits(millions) + "MILLION ";
    if (thousands) s += threeDigits(thousands) + "THOUSAND ";
    if (n) s += threeDigits(n);
    return s.trim();
  }
  const rounded = Math.round((parseFloat(amount)||0) * 100) / 100;
  const dollars = Math.floor(rounded);
  const cents = Math.round((rounded - dollars) * 100);
  let out = intToWords(dollars) + (dollars === 1 ? " DOLLAR" : " DOLLARS");
  if (cents > 0) out += " AND " + intToWords(cents) + (cents === 1 ? " CENT" : " CENTS");
  return out;
}

// Đo độ rộng chữ thật (dùng SVG ẩn) để tự giãn khung Shipping Mark theo đúng độ dài chữ
function dnMeasureTextWidth(text, fontSize) {
  try {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS,"svg");
    svg.style.position = "absolute"; svg.style.visibility = "hidden"; svg.style.pointerEvents = "none";
    svg.style.width = "0"; svg.style.height = "0";
    const t = document.createElementNS(svgNS,"text");
    t.setAttribute("font-family","Arial");
    t.setAttribute("font-size", fontSize);
    t.setAttribute("font-weight","bold");
    t.textContent = text;
    svg.appendChild(t);
    document.body.appendChild(svg);
    const w = t.getComputedTextLength() || (String(text).length * fontSize * 0.62);
    document.body.removeChild(svg);
    return w;
  } catch(e) {
    return String(text||"").length * fontSize * 0.62;
  }
}

// Dựng SVG khung Shipping Mark (hình thoi / tam giác / oval / không viền), tự giãn theo độ dài chữ,
// nhưng KHÔNG vượt quá bề rộng cột MARKS & NOS — nếu chữ dài quá thì tự giảm cỡ chữ cho vừa,
// thay vì để hình phình to hơn cột (đã xảy ra thực tế với "FLEX JAPAN CO.,LTD").
const DN_MARK_MAX_W = 145; // px — vừa cột 24% trang A4 (182mm khổ in), trừ đệm ô
const DN_MARK_MIN_FONT = 8;

function dnMarkGeometryAt(shape, useLines, fontSize) {
  const n = useLines.length;
  const lineHeight = fontSize + 4;
  const widths = useLines.map(l => Math.max(12, dnMeasureTextWidth(l, fontSize)));
  const textBlockH = n * lineHeight;

  let padTop, padBottom, minPad;
  if (shape === "none") { padTop=6; padBottom=6; minPad=5; }
  else if (shape === "triangle") { padTop=Math.round(fontSize*2.7); padBottom=8; minPad=11; }
  else if (shape === "oval") { padTop=14; padBottom=14; minPad=13; }
  else { padTop=16; padBottom=16; minPad=14; } // diamond

  const H = Math.max(46, textBlockH + padTop + padBottom);
  const cyDefault = H/2;
  const startYDefault = cyDefault - (n-1)*lineHeight/2;
  const dys = useLines.map((_,i) => (startYDefault + i*lineHeight) - cyDefault);

  let halfW = 26;
  if (shape === "oval") {
    const B = H/2 - 3;
    for (let i=0;i<n;i++){
      const dy = Math.abs(dys[i]);
      const factor = Math.max(0.22, Math.sqrt(Math.max(0.02, 1 - (dy/B)*(dy/B))));
      halfW = Math.max(halfW, (widths[i]/2 + minPad) / factor);
    }
  } else if (shape === "diamond") {
    const halfH = H/2 - 3;
    for (let i=0;i<n;i++){
      const dy = Math.abs(dys[i]);
      const factor = Math.max(0.22, 1 - dy/halfH);
      halfW = Math.max(halfW, (widths[i]/2 + minPad) / factor);
    }
  } else if (shape === "triangle") {
    const cy0 = H - padBottom - textBlockH/2;
    const startY0 = cy0 - (n-1)*lineHeight/2;
    for (let i=0;i<n;i++){
      const yFromApex = Math.max(4, (startY0 + i*lineHeight) - 4);
      const triH = H - 7;
      const factor = Math.max(0.25, yFromApex/triH);
      halfW = Math.max(halfW, (widths[i]/2 + minPad) / factor);
    }
  } else {
    for (let i=0;i<n;i++) halfW = Math.max(halfW, widths[i]/2 + minPad);
  }
  return { W: Math.round(halfW*2), H: Math.round(H), fontSize, lineHeight, padTop, padBottom, textBlockH };
}

function dnBuildMarkSvg(shape, insideText) {
  const lines = (insideText||"").split("\n").map(l=>l.trim()).filter(Boolean).slice(0,4);
  const useLines = lines.length ? lines : [""];
  const n = useLines.length;

  let fontSize = 13;
  let g = dnMarkGeometryAt(shape, useLines, fontSize);
  while (g.W > DN_MARK_MAX_W && fontSize > DN_MARK_MIN_FONT) {
    fontSize -= 1;
    g = dnMarkGeometryAt(shape, useLines, fontSize);
  }

  const { W, H, lineHeight, padBottom, textBlockH } = g;
  const cx = W/2;
  let cy, shapeEl = "";
  if (shape === "oval") {
    cy = H/2;
    shapeEl = `<ellipse cx="${cx}" cy="${H/2}" rx="${W/2-2}" ry="${H/2-2}" fill="none" stroke="#000" stroke-width="1.4"/>`;
  } else if (shape === "triangle") {
    cy = H - padBottom - textBlockH/2;
    shapeEl = `<polygon points="${cx},4 ${W-3},${H-3} 3,${H-3}" fill="none" stroke="#000" stroke-width="1.4"/>`;
  } else if (shape === "diamond") {
    cy = H/2;
    shapeEl = `<polygon points="${cx},2 ${W-2},${H/2} ${cx},${H-2} 2,${H/2}" fill="none" stroke="#000" stroke-width="1.4"/>`;
  } else {
    cy = H/2; shapeEl = "";
  }
  const startY = cy - (n-1)*lineHeight/2 + fontSize*0.35;
  const textEls = useLines.map((l,i) =>
    `<text x="${cx}" y="${startY+i*lineHeight}" text-anchor="middle" font-family="Arial" font-size="${fontSize}" font-weight="bold" fill="#000">${dnEsc(l)}</text>`
  ).join("");
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;margin:0 auto">${shapeEl}${textEls}</svg>`;
}

// Dựng nội dung 4 cột Description/Quantity/Unit Price/Amount.
// LƯU Ý: khối nhãn phụ ((PIECE) / CMPT... / (USD)) nằm ở 1 HÀNG RIÊNG của bảng, KHÔNG chèn
// dòng trống thủ công — vì nhãn dài (CMPT (PROCESSING ON COMMISSION)) tự xuống nhiều dòng trong
// cột hẹp, chèn cứng số dòng trống sẽ làm dữ liệu cột đó tụt xuống lệch so với 3 cột còn lại.
function dnPriceLabelHTML(label) {
  const raw = String(label || "");
  const i = raw.indexOf("(");
  let head = "", rest = "";
  if (i > 0) { head = raw.slice(0, i).trim(); rest = raw.slice(i).trim(); }
  else if (i === 0) { rest = raw.trim(); }
  else { head = raw.trim(); }
  // Dòng 1: phần trước ngoặc (VD "CMPT") — cỡ chữ bình thường, ngang với "SHIPMENT OF (GOODS)"
  const headHTML = head
    ? `<div style="text-align:center">${dnEsc(head)}</div>`
    : `<div>&nbsp;</div>`;
  // Dòng 2: phần trong ngoặc — nhỏ hơn NẾU chỉ là chú thích của phần đầu ("CMPT (PROCESSING...)"),
  // còn nếu nó chính là nhãn ("(FOB)" / "(FCA)") thì giữ cỡ chữ bình thường
  const restHTML = rest
    ? `<div style="text-align:center;${head ? "font-size:0.82em;line-height:1.3" : ""}">${dnEsc(rest)}</div>`
    : "";
  return headHTML + restHTML;
}

function dnGoodsCells(s, priceLabel, goodsDescription) {
  const orders = s.orders || [];
  const descLines = [], qtyLines = [], priceLines = [], amtLines = [];
  let totalQty = 0, totalAmt = 0;
  orders.forEach(o => {
    const qty = parseFloat(o.qty) || 0;
    // Làm tròn đơn giá 2 số lẻ TRƯỚC khi nhân (đúng như hàm ROUND trong file Excel gốc),
    // để trên chứng từ luôn đúng: đơn giá × số lượng = số tiền (khách tự tính lại không lệch)
    const price = Math.round((parseFloat(o.unitPrice) || 0) * 100) / 100;
    const amt = qty * price;
    totalQty += qty; totalAmt += amt;
    const idxTxt = [dnEsc(o.contract||""), dnEsc(o.index||""), dnEsc(o.items||"")].filter(Boolean).join("&nbsp;&nbsp;");
    descLines.push(`<div>${idxTxt}</div>`);
    qtyLines.push(`<div style="text-align:right">${dnInt(qty)}</div>`);
    priceLines.push(`<div style="text-align:right">US$${price.toFixed(2)}</div>`);
    amtLines.push(`<div style="text-align:right">US$${dnMoney(amt)}</div>`);
  });
  if (!orders.length) {
    descLines.push(`<div style="color:#999">(chưa có đơn hàng)</div>`);
  }
  return {
    descHTML: descLines.join(""),
    qtyHTML: qtyLines.join(""),
    priceHTML: priceLines.join(""),
    amtHTML: amtLines.join(""),
    totalQty, totalAmt
  };
}

// Tìm document khách hàng theo tên, có kèm ID (để ghi mẫu mặc định trở lại đúng khách)
async function dnFindCustomerDoc(custNameToFind) {
  if (!custNameToFind) return null;
  try {
    const { collection, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const snap = await getDocs(collection(db, "customers"));
    const target = normName(custNameToFind);
    const found = snap.docs.find(d => normName(d.data().name) === target);
    return found ? { id: found.id, data: found.data() } : null;
  } catch(e) { return null; }
}

function dnMarksNosCell(dn, totalCtns) {
  return `
    <div class="dn-marks-top">
      <div style="text-decoration:underline;margin-bottom:6px">SHIPPING MARKS:</div>
      ${dnBuildMarkSvg(dn.markShape||"none", dn.markInside||"")}
      <div style="margin-top:10px;white-space:pre-line;text-align:left">${dnNl2br(dn.markOutside||"")}</div>
    </div>
    <div class="dn-marks-total">TOTAL: ${dnInt(totalCtns)} CARTONS</div>`;
}

function dnGoodsTableHTML(s, dn, priceLabel, totalCtns) {
  const g = dnGoodsCells(s, priceLabel, dn.goodsDescription);
  // Khối nhãn của 4 cột bọc trong .dn-sub — script dnAlignSubHeaders() sẽ đo và canh đều chiều cao
  // 4 khối này sau khi trang tải xong, nên dòng hàng đầu tiên của 4 cột luôn bắt đầu cùng 1 vị trí,
  // bất kể nhãn "CMPT (PROCESSING ON COMMISSION)" tự xuống mấy dòng.
  return `
  <table class="dn-g-table">
    <tr>
      <th style="width:24%">MARKS &amp; NOS.</th>
      <th style="width:40%">DESCRIPTION</th>
      <th style="width:8%">Quantity</th>
      <th style="width:15%">Unit&nbsp;Price</th>
      <th style="width:13%">AMOUNT</th>
    </tr>
    <tr>
      <td class="dn-marks-cell" style="text-align:center">${dnMarksNosCell(dn, totalCtns)}</td>
      <td class="dn-desc-cell">
        <div class="dn-sub">
          <div style="text-align:center">SHIPMENT OF (GOODS)</div>
          <div style="font-weight:bold">${dnEsc(dn.goodsDescription||"SHIRTS")}</div>
          <div>&nbsp;</div>
        </div>
        ${g.descHTML}
      </td>
      <td>
        <div class="dn-sub"><div>&nbsp;</div><div style="text-align:center">(PIECE)</div><div>&nbsp;</div></div>
        ${g.qtyHTML}
      </td>
      <td>
        <div class="dn-sub">${dnPriceLabelHTML(priceLabel)}<div>&nbsp;</div></div>
        ${g.priceHTML}
      </td>
      <td>
        <div class="dn-sub"><div>&nbsp;</div><div style="text-align:center">(USD)</div><div>&nbsp;</div></div>
        ${g.amtHTML}
      </td>
    </tr>
    <tr class="dn-totrow">
      <td class="dn-tot-marks"></td>
      <td style="text-align:right;font-weight:bold;white-space:nowrap">TOTAL</td>
      <td style="text-align:right;font-weight:bold;white-space:nowrap">${dnInt(g.totalQty)}</td>
      <td></td>
      <td style="text-align:right;font-weight:bold;white-space:nowrap">US$${dnMoney(g.totalAmt)}</td>
    </tr>
  </table>`;
}

function dnSignatureHTML(dn, stampImageDataUrl) {
  if (dn.includeStamp && stampImageDataUrl) {
    return `<div style="text-align:right"><img src="${stampImageDataUrl}" style="width:61mm;height:auto" alt="Con dau va chu ky"></div>`;
  }
  if (dn.includeStamp && !stampImageDataUrl) {
    return `<div style="text-align:right;font-size:10px;color:#c00">(Chưa có ảnh con dấu — vào Admin ▸ Thông tin chức vụ và con dấu để thêm)</div>`;
  }
  return `<div style="font-weight:bold;margin-bottom:44px">TOMIYA SUMMIT GARMENT EXPORT CO., LTD</div>
    <div style="font-weight:bold;font-size:11px">${dnEsc(dn.signerName||DN_SIGNER_FALLBACK.signerName)}</div>
    <div style="font-size:11px">${dnEsc(dn.signerTitle||DN_SIGNER_FALLBACK.signerTitle)}</div>`;
}

const DN_PRINT_STYLE = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color:#000; font-size:11px; line-height:1.45; margin:0; }
  .dn-h-table { width:100%; border-collapse:collapse; font-size:11px; margin-bottom:14px; }
  .dn-h-table td { border:1px solid #000; padding:5px 7px; vertical-align:top; }
  .dn-g-table { width:100%; border-collapse:collapse; font-size:11px; table-layout:fixed; }
  .dn-g-table td { border-left:1px solid #000; border-right:1px solid #000; padding:5px 6px; vertical-align:top; overflow:hidden; }
  .dn-g-table th { font-size:11px; text-align:center; border:1px solid #000; border-top:2.5px solid #000; border-bottom:2.5px solid #000; padding:2px 6px; overflow:hidden; }
  .dn-g-table tr.dn-totrow td { border-top:2.5px solid #000; border-bottom:2.5px solid #000; padding:2px 6px; }
  .dn-g-table td.dn-marks-cell { position:relative; padding-bottom:20px; }
  .dn-marks-total { position:absolute; left:6px; right:6px; bottom:3px; font-weight:bold; text-align:left; }
  /* Ô đệm cột Marks ở dòng TOTAL: KHÔNG kẻ ngang phía trên (đúng mẫu gốc — cột Marks liền mạch),
     chỉ đóng đáy bảng. Nhờ vậy dòng TOTAL cao đúng 1 dòng, không bị rowspan làm phình ra. */
  .dn-g-table tr.dn-totrow td.dn-tot-marks { border-top:none; border-bottom:2.5px solid #000; }
  /* Chiều cao tối thiểu thân bảng: đo từ file mẫu thật (86mm / 99mm với 5 dòng hàng) */
  .dn-g-table td.dn-desc-cell { height:90mm; }
  .lbl { display:inline-block; width:78px; vertical-align:top; }
  .pagebreak { page-break-after: always; }
  .noprint { text-align:center; padding:10px; }
  @media print { .noprint { display:none; } }
`;

function dnLetterheadHTML() {
  return `<div style="text-align:center;margin-bottom:12px">
    <div style="font-weight:bold;font-size:15px;font-style:italic">TOMIYA SUMMIT GARMENT EXPORT CO. , LTD</div>
    <div style="font-size:11px;margin-top:2px">LOT B-1, LONG BINH TECHNO PARK (LOTECO) EPZ, LONG BINH WARD, DONG NAI CITY, VIETNAM</div>
    <div style="font-size:11px">Tel: 84-251.3992537&nbsp;&nbsp;&nbsp;Fax: 84-251.3992540</div>
  </div>`;
}

function dnMessrsBlockHTML(dn, underline) {
  const lblStyle = underline ? " style=\"text-decoration:underline\"" : "";
  const messrsLines = (dn.messrsText||"").split("\n").filter(Boolean);
  const firstLine = messrsLines[0] || "";
  const restLines = messrsLines.slice(1);
  let out = `<span class="lbl"${lblStyle}>MESSRS.</span><b>${dnEsc(firstLine)}</b>`;
  restLines.forEach(l => { out += `<br><span class="lbl">&nbsp;</span>${dnEsc(l)}`; });
  if ((dn.consigneeText||"").trim()) {
    const cLines = dn.consigneeText.split("\n").filter(Boolean);
    out += `<br><br><span class="lbl"${lblStyle}>CONSIGNEE:</span><b>${dnEsc(cLines[0]||"")}</b>`;
    cLines.slice(1).forEach(l => { out += `<br><span class="lbl">&nbsp;</span>${dnEsc(l)}`; });
  }
  return out;
}

// ---- TRANG 1: COMMERCIAL INVOICE ----
function dnRenderInvoicePage(s, dn, priceLabel, totalCtns) {
  return `<div class="pagebreak dn-page-wrap">
    ${dnLetterheadHTML()}
    <table class="dn-h-table">
      <tr>
        <td colspan="2">
          <div style="display:flex;justify-content:space-between">
            <span style="font-style:italic;font-weight:bold">COMMERCIAL INVOICE</span>
            <span>DATE&nbsp;&nbsp;<b>${dnDate(s.invoiceDate)}</b></span>
          </div>
        </td>
      </tr>
      <tr>
        <td style="width:64%">${dnMessrsBlockHTML(dn)}</td>
        <td>INVOICE NO.<br><b>${dnEsc(s.invoiceNo)}</b><br><br>CONFIRMATION</td>
      </tr>
      <tr>
        <td colspan="2"><span class="lbl">SHIPMENT</span>from<br><span class="lbl">Sailing</span><b>HOCHIMINH CITY, VIETNAM</b></td>
      </tr>
      <tr>
        <td colspan="2"><span class="lbl">PAYMENT BY</span><b>T/T REMITTANCE</b><br><span class="lbl">Date of issue</span><br><span class="lbl">Issuing bank</span></td>
      </tr>
    </table>
    ${dnGoodsTableHTML(s, dn, priceLabel, totalCtns)}
    <div style="margin-top:20px;text-align:right;min-height:100px">${dnSignatureHTML(dn, s._stampImageDataUrl)}</div>
  </div>`;
}

// ---- TRANG 2: DEBIT NOTE ----
function dnRenderDebitNotePage(s, dn, priceLabel, totalCtns) {
  return `<div class="dn-page-wrap">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px">
      <div style="font-weight:bold;font-style:italic;font-size:19px">TOSGAMEX</div>
      <div style="text-align:center;flex:1">
        <div style="font-weight:bold;font-size:13px">TOMIYA SUMMIT GARMENT EXPORT CO., LTD</div>
        <div style="font-size:10px;margin-top:2px;white-space:nowrap">LOT B-1, LONG BINH TECHNO PARK (LOTECO) EPZ, LONG BINH WARD, DONG NAI CITY, VIETNAM</div>
        <div style="font-size:10px">Tel: 84-251.3992537&nbsp;&nbsp;&nbsp;Fax: 84-251.3992540</div>
      </div>
      <div style="width:66px"></div>
    </div>
    <div style="border-top:1px solid #000;margin:8px 0 12px"></div>
    <div>${dnMessrsBlockHTML(dn, true)}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:6px">
      <div style="text-align:right">DEBIT NOTE NO.: <b>${dnEsc(s.invoiceNo)}</b><br>DATE: <b>${dnDate(new Date())}</b></div>
    </div>
    <div style="text-align:center;font-weight:bold;font-size:18px;margin:12px 0 8px">DEBIT NOTE</div>
    <div style="display:flex;justify-content:space-between;border-top:1px solid #000;border-bottom:1px solid #000;padding:4px 2px;margin-bottom:10px">
      <div>INVOICE NO.: <b>${dnEsc(s.invoiceNo)}</b></div>
      <div>DATE OF INVOICE: <b>${dnDate(s.invoiceDate)}</b></div>
    </div>
    ${dnGoodsTableHTML(s, dn, priceLabel, totalCtns)}
    <div style="margin-top:10px"><b>AMOUNT IN WORD:</b> ${dnWordsUSD(dnGoodsCells(s, priceLabel, dn.goodsDescription).totalAmt)}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:14px">
      <div>Please kindly arrange to pay this amount for us to:<br>${dnNl2br(DN_BANK_TEXT)}</div>
      <div style="flex-shrink:0">${dnSignatureHTML(dn, s._stampImageDataUrl)}</div>
    </div>
  </div>`;
}

function renderDebitNotePrint(s) {
  const dn = s.debitNote || {};
  const priceLabel = dn.priceTerm || "FOB";
  const totalCtns = dnTotalCartons(s);
  const adjustScript = `
    function dnAutoFitPage(){
      var TARGET_H = 950; // px ~ chiều cao 1 trang A4 trong khổ in, đã trừ lề + biên an toàn
      var MIN_FONT = 7;
      document.querySelectorAll('.dn-page-wrap').forEach(function(pageEl){
        var table = pageEl.querySelector('.dn-g-table');
        if (!table) return;
        var fontSize = 11;
        var guard = 0;
        while (pageEl.scrollHeight > TARGET_H && fontSize > MIN_FONT && guard < 40) {
          fontSize -= 0.5;
          table.style.fontSize = fontSize + 'px';
          guard++;
        }
      });
    }
    // Canh đều chiều cao khối nhãn của 4 cột: đo khối cao nhất rồi set cả 4 bằng đúng số đó,
    // để dòng hàng đầu tiên của 4 cột luôn bắt đầu cùng vị trí (nhãn CMPT dài mấy dòng cũng không lệch)
    function dnAlignSubHeaders(){
      document.querySelectorAll('.dn-g-table').forEach(function(table){
        var subs = table.querySelectorAll('.dn-sub');
        if (!subs.length) return;
        var i, maxH = 0;
        for (i = 0; i < subs.length; i++) { subs[i].style.height = ''; }
        for (i = 0; i < subs.length; i++) { if (subs[i].offsetHeight > maxH) maxH = subs[i].offsetHeight; }
        for (i = 0; i < subs.length; i++) { subs[i].style.height = maxH + 'px'; }
      });
    }
    function dnRunLayoutFixups(){ dnAutoFitPage(); dnAlignSubHeaders(); }
    if (document.readyState === 'complete') { dnRunLayoutFixups(); }
    else { window.addEventListener('load', dnRunLayoutFixups); }
  `;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Debit Note</title>
    <style>${DN_PRINT_STYLE}</style></head><body>
    <div class="noprint"><button onclick="window.print()">🖨 In / Lưu PDF</button></div>
    ${dnRenderInvoicePage(s, dn, priceLabel, totalCtns)}
    ${dnRenderDebitNotePage(s, dn, priceLabel, totalCtns)}
    <script>${adjustScript}<\/script>
    </body></html>`;
  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
  w.document.title = pdfFileName("Debit Note", s.invoiceNo);
}

// ---- MODAL: mở form nhập liệu Debit Note ----
window.openDebitNote = async function(shipId) {
  if (isGuest()) { showToast("Tài khoản Khách chỉ được xem, không xuất chứng từ."); return; }

  const s = shipments().find(x=>x.id===shipId);
  if (!s) return;
  if (!s.invoiceNo || !s.invoiceDate) {
    showToast("⚠ Lô hàng chưa có Số hóa đơn / Ngày hóa đơn — vào 'Sửa lô hàng' để nhập trước khi xuất Debit Note.");
    return;
  }

  const custName = siCustomerName(s);
  const existing = s.debitNote || {};
  const cust = await findCustomerByName(db, custName);
  const tpl = cust.debitNoteTemplate || {};

  const def = {
    messrsText: existing.messrsText || cust.consignee || "",
    consigneeText: existing.consigneeText || "",
    goodsDescription: existing.goodsDescription || tpl.goodsDescription || cust.description || "SHIRTS",
    priceTerm: existing.priceTerm || tpl.priceTerm || dnDefaultPriceTerm(s),
    markShape: existing.markShape || tpl.markShape || "none",
    markInside: existing.markInside != null ? existing.markInside : (tpl.markInside || ""),
    markOutside: existing.markOutside != null ? existing.markOutside : (s.shipMark || ""),
    includeStamp: existing.includeStamp != null ? existing.includeStamp : true,
  };

  const priceOptions = ["(FOB)","(FCA)","CMPT (PROCESSING ON COMMISSION)"];
  const priceOptionsHTML = priceOptions.map(p =>
    `<option value="${p.replace(/"/g,"&quot;")}" ${def.priceTerm===p?"selected":""}>${p}</option>`
  ).join("") + (priceOptions.includes(def.priceTerm) ? "" : `<option value="${(def.priceTerm||"").replace(/"/g,"&quot;")}" selected>${def.priceTerm}</option>`);

  const shapeLabels = { diamond:"Hình thoi", triangle:"Hình tam giác", oval:"Hình oval", none:"Không viền" };
  const shapeOptionsHTML = Object.keys(shapeLabels).map(k =>
    `<option value="${k}" ${def.markShape===k?"selected":""}>${shapeLabels[k]}</option>`
  ).join("");

  document.getElementById("debitnote-form-body").innerHTML = `
    <div class="form-group">
      <label class="form-label">MESSRS (bên mua)</label>
      <textarea class="form-textarea" id="dn-messrs" rows="3">${dnEsc(def.messrsText)}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">CONSIGNEE (để trống nếu giao thẳng cho MESSRS)</label>
      <textarea class="form-textarea" id="dn-consignee" rows="2" placeholder="Để trống nếu không có">${dnEsc(def.consigneeText)}</textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Tên hàng (Goods Description)</label>
        <input class="form-input" id="dn-goods" value="${(def.goodsDescription||"").replace(/"/g,"&quot;")}">
      </div>
      <div class="form-group">
        <label class="form-label">Đơn giá ghi là</label>
        <select class="form-select" id="dn-priceterm">${priceOptionsHTML}</select>
      </div>
    </div>
    <div class="form-group" style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:10px">Shipping Mark trên Debit Note</div>
    <div style="display:flex;gap:14px;margin-bottom:6px">
      <div style="width:40%;display:flex;flex-direction:column;gap:8px">
        <div>
          <label class="form-label">Chữ trong hình</label>
          <textarea class="form-textarea" id="dn-inside" rows="2" placeholder="Cắt (Ctrl+X) từ ô bên phải" oninput="updateDnMarkPreview()" style="font-size:12px">${dnEsc(def.markInside)}</textarea>
        </div>
        <div>
          <label class="form-label">Hình dạng</label>
          <select class="form-select" id="dn-shape" onchange="updateDnMarkPreview()">${shapeOptionsHTML}</select>
        </div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column">
        <label class="form-label">Chữ ngoài hình</label>
        <textarea class="form-textarea" id="dn-outside" rows="10" style="font-size:12px;flex:1">${dnEsc(def.markOutside)}</textarea>
      </div>
    </div>
    <div class="form-label" style="margin-top:6px">Xem trước</div>
    <div style="border:1px solid var(--border);border-radius:8px;min-height:70px;padding:12px;display:flex;align-items:center;justify-content:center;margin-bottom:16px" id="dn-preview-box"></div>
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;margin-bottom:16px">
      <input type="checkbox" id="dn-stamp" ${def.includeStamp?"checked":""}> Chèn con dấu và chữ ký
      <span style="color:var(--text-muted);font-weight:400">(đổi ảnh/tên người ký ở Admin ▸ Thông tin chức vụ và con dấu)</span>
    </label>
    <div class="form-footer">
      <button type="button" class="btn" onclick="closeModalById('modal-debitnote')">Hủy</button>
      <button type="button" class="btn btn-primary" onclick="saveDebitNoteAndExport('${shipId}')"><i class="ti ti-file-export"></i> Lưu &amp; Xuất Debit Note</button>
    </div>`;
  openModal("modal-debitnote");
  updateDnMarkPreview();
};

// Cập nhật khung xem trước Shipping Mark ngay trong modal (dùng chung công thức với bản in thật)
window.updateDnMarkPreview = function() {
  const shapeEl = document.getElementById("dn-shape");
  const insideEl = document.getElementById("dn-inside");
  const box = document.getElementById("dn-preview-box");
  if (!shapeEl || !insideEl || !box) return;
  box.innerHTML = dnBuildMarkSvg(shapeEl.value, insideEl.value);
};

window.saveDebitNoteAndExport = async function(shipId) {
  const s = shipments().find(x=>x.id===shipId);
  if (!s) return;

  const existing = s.debitNote || {};
  let dnSettings = { signerName: DN_SIGNER_FALLBACK.signerName, signerTitle: DN_SIGNER_FALLBACK.signerTitle, stampImageDataUrl: "" };
  try {
    const { doc: d2, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const snap = await getDoc(d2(db, "settings", "debitNote"));
    if (snap.exists()) {
      const data = snap.data();
      dnSettings = {
        signerName: data.signerName || DN_SIGNER_FALLBACK.signerName,
        signerTitle: data.signerTitle || DN_SIGNER_FALLBACK.signerTitle,
        stampImageDataUrl: data.stampImageDataUrl || "",
      };
    }
  } catch(e) { console.warn("Không đọc được cài đặt Người ký/Con dấu (Admin ▸ Thông tin chức vụ và con dấu):", e); }

  const debitNote = {
    messrsText: document.getElementById("dn-messrs").value,
    consigneeText: document.getElementById("dn-consignee").value,
    goodsDescription: document.getElementById("dn-goods").value.trim() || "SHIRTS",
    priceTerm: document.getElementById("dn-priceterm").value,
    markShape: document.getElementById("dn-shape").value,
    markInside: document.getElementById("dn-inside").value,
    markOutside: document.getElementById("dn-outside").value,
    // Người ký/Chức vụ: giữ nguyên giá trị đã lưu từ lần xuất trước (đúng lịch sử), lô mới thì lấy mặc định hiện hành
    signerName: existing.signerName || dnSettings.signerName,
    signerTitle: existing.signerTitle || dnSettings.signerTitle,
    includeStamp: document.getElementById("dn-stamp").checked,
  };

  if (!(await saveGuard(updateDoc(doc(db,"shipments",shipId), { debitNote }), "Đã lưu Debit Note!"))) return;

  // Lưu lại làm mẫu mặc định cho khách này (không chặn luồng chính nếu lỗi)
  try {
    const custName = siCustomerName(s);
    const custDoc = await dnFindCustomerDoc(custName);
    if (custDoc) {
      const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      await setDoc(doc(db,"customers",custDoc.id), {
        debitNoteTemplate: {
          goodsDescription: debitNote.goodsDescription,
          priceTerm: debitNote.priceTerm,
          markShape: debitNote.markShape,
          markInside: debitNote.markInside,
        }
      }, { merge: true });
    }
  } catch(e) { console.warn("Không lưu được mẫu Debit Note theo khách:", e); }

  closeModal("modal-debitnote");
  // Ảnh con dấu luôn lấy bản MỚI NHẤT trong Cài đặt lúc in (không lưu cứng theo từng lô)
  renderDebitNotePrint({ ...s, debitNote, _stampImageDataUrl: dnSettings.stampImageDataUrl });
};

// ---- CÀI ĐẶT CHUNG: Người ký / Chức vụ / Ảnh con dấu (Admin ▸ Thông tin chức vụ và con dấu) ----
window.openDebitNoteSettings = async function() {
  if (!isAdmin()) { showToast("Chỉ Admin mới chỉnh được mục này."); return; }

  let cur = { signerName: DN_SIGNER_FALLBACK.signerName, signerTitle: DN_SIGNER_FALLBACK.signerTitle, stampImageDataUrl: "" };
  try {
    const { doc: d2, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const snap = await getDoc(d2(db, "settings", "debitNote"));
    if (snap.exists()) {
      const data = snap.data();
      cur = {
        signerName: data.signerName || cur.signerName,
        signerTitle: data.signerTitle || cur.signerTitle,
        stampImageDataUrl: data.stampImageDataUrl || "",
      };
    }
  } catch(e) {
    showToast("⚠ Chưa đọc được cài đặt — kiểm tra đã deploy firestore.rules (collection settings) chưa.");
    console.warn(e);
  }

  window.__dnNewStampDataUrl = null;

  document.getElementById("debitnote-settings-body").innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Người ký</label>
        <input class="form-input" id="dns-signer-name" value="${dnEsc(cur.signerName).replace(/"/g,"&quot;")}">
      </div>
      <div class="form-group">
        <label class="form-label">Chức vụ</label>
        <input class="form-input" id="dns-signer-title" value="${dnEsc(cur.signerTitle).replace(/"/g,"&quot;")}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Ảnh con dấu + chữ ký</label>
      <div style="display:flex;align-items:center;gap:14px">
        <div id="dns-stamp-preview" style="width:110px;height:78px;border:1px dashed var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text-muted);text-align:center;overflow:hidden;flex-shrink:0">
          ${cur.stampImageDataUrl ? `<img src="${cur.stampImageDataUrl}" style="max-width:100%;max-height:100%;object-fit:contain">` : "Chưa có ảnh"}
        </div>
        <div style="flex:1">
          <button type="button" class="btn" onclick="document.getElementById('dns-stamp-file').click()"><i class="ti ti-upload"></i> Đổi ảnh</button>
          <input type="file" id="dns-stamp-file" accept="image/png,image/jpeg" style="display:none">
          <div id="dns-stamp-info" style="font-size:11px;color:var(--text-muted);margin-top:6px"></div>
        </div>
      </div>
    </div>
    <div class="form-footer">
      <button type="button" class="btn" onclick="closeModalById('modal-debitnote-settings')">Hủy</button>
      <button type="button" class="btn btn-primary" onclick="saveDebitNoteSettings()"><i class="ti ti-device-floppy"></i> Lưu</button>
    </div>`;

  document.getElementById("dns-stamp-file").addEventListener("change", function(e){
    const file = e.target.files[0];
    if (!file) return;
    const info = document.getElementById("dns-stamp-info");
    const sizeKb = Math.round(file.size/1024);
    const reader = new FileReader();
    reader.onload = function(ev){
      window.__dnNewStampDataUrl = ev.target.result;
      document.getElementById("dns-stamp-preview").innerHTML = `<img src="${ev.target.result}" style="max-width:100%;max-height:100%;object-fit:contain">`;
      const big = sizeKb > 700;
      info.textContent = file.name + " — " + sizeKb + " KB" + (big ? " (khá nặng, nên nén nhỏ lại)" : "");
      info.style.color = big ? "#c0392b" : "";
    };
    reader.readAsDataURL(file);
  });

  openModal("modal-debitnote-settings");
};

window.saveDebitNoteSettings = async function() {
  const signerName = document.getElementById("dns-signer-name").value.trim() || DN_SIGNER_FALLBACK.signerName;
  const signerTitle = document.getElementById("dns-signer-title").value.trim() || DN_SIGNER_FALLBACK.signerTitle;
  const payload = { signerName, signerTitle };
  if (window.__dnNewStampDataUrl) payload.stampImageDataUrl = window.__dnNewStampDataUrl;

  try {
    const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await setDoc(doc(db,"settings","debitNote"), payload, { merge: true });
    showToast("Đã lưu Thông tin chức vụ và con dấu!");
    window.__dnNewStampDataUrl = null;
    closeModal("modal-debitnote-settings");
  } catch(e) {
    showToast("⚠ Lưu thất bại — kiểm tra đã deploy firestore.rules (collection settings) chưa.");
    console.warn(e);
  }
};

window.showToast = window.showToast || showToast;
