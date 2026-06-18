export function showToast(msg, duration = 2500) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), duration);
}

export const PORT_FULLNAME = {
  "YOKO": "YOKOHAMA",
  "OSAKA": "OSAKA",
  "KOBE": "KOBE",
  "TOKYO": "TOKYO",
  "NAGOYA": "NAGOYA",
  "HAKATA": "HAKATA",
  "SHIMIZU": "SHIMIZU",
  "MOJI": "MOJI",
  "THAILAND": "THAILAND",
};

export function fullPort(port) {
  if (!port) return "—";
  const up = port.toUpperCase().trim();
  return PORT_FULLNAME[up] || up;
}

export function formatDate(str) {
  if (!str) return "—";
  const d = new Date(str);
  if (isNaN(d)) return str;
  return (d.getMonth()+1).toString().padStart(2,"0") + "/" + d.getDate().toString().padStart(2,"0");
}

export function calcCBM(d, w, h) {
  const v = (parseFloat(d)||0) * (parseFloat(w)||0) * (parseFloat(h)||0) / 1000000;
  return Math.round(v * 100) / 100;
}

export const CHECKLIST_STEPS = [
  { id: 1,  label: "Nhập đơn hàng",         short: "1",  skippable: false },
  { id: 2,  label: "Kích thước + KG",        short: "2",  skippable: false },
  { id: 3,  label: "Booking / Email",         short: "3",  skippable: false },
  { id: 4,  label: "Thông tin tàu",          short: "4",  skippable: false },
  { id: 5,  label: "HS Code + C/O Form",     short: "5",  skippable: false },
  { id: 6,  label: "Tạo định mức",           short: "6",  skippable: false },
  { id: 7,  label: "Bill of Lading",         short: "7",  skippable: false },
  { id: 8,  label: "Tờ khai Hải quan",       short: "8",  skippable: false },
  { id: 9,  label: "Gửi chứng từ nháp",      short: "9",  skippable: false },
  { id: 10, label: "CO + chứng từ còn lại",  short: "10", skippable: true  },
  { id: 11, label: "Gửi chứng từ hoàn chỉnh",short: "11",skippable: false },
];

export function getProgress(checklist = {}) {
  let done = 0;
  CHECKLIST_STEPS.forEach(s => {
    if (checklist[s.id] === "done" || checklist[s.id] === "skip") done++;
  });
  return { done, total: CHECKLIST_STEPS.length, pct: Math.round(done / CHECKLIST_STEPS.length * 100) };
}

export function getStatus(checklist = {}) {
  const { done, total } = getProgress(checklist);
  if (done === 0) return { label: "Chờ xử lý", cls: "badge-gray" };
  if (done === total) return { label: "Hoàn tất", cls: "badge-green" };
  const step3 = checklist[3];
  if (!step3 || step3 === "pending") return { label: "Chờ booking", cls: "badge-blue" };
  return { label: "Đang xử lý", cls: "badge-amber" };
}

export function progColor(pct) {
  if (pct === 100) return "#639922";
  if (pct >= 50)  return "#EF9F27";
  return "#378ADD";
}

export function openModal(id) {
  document.getElementById(id)?.classList.add("open");
}
export function closeModal(id) {
  document.getElementById(id)?.classList.remove("open");
}

export function renderChecklist(container, checklist = {}, onChange) {
  container.innerHTML = "";
  container.className = "checklist";
  CHECKLIST_STEPS.forEach(s => {
    const state = checklist[s.id] || "pending";
    const dot = document.createElement("div");
    dot.className = "ck" + (state === "done" ? " done" : state === "skip" ? " skip" : state === "active" ? " active" : "");
    dot.title = s.label + (s.skippable ? " (có thể bỏ qua)" : "");
    dot.innerHTML = state === "done" ? '<i class="ti ti-check" style="font-size:11px"></i>' : s.short;

    if (onChange) {
      dot.addEventListener("click", () => {
        let next;
        if (state === "pending") next = "done";
        else if (state === "done" && s.skippable) next = "skip";
        else if (state === "done") next = "pending";
        else next = "pending";
        onChange(s.id, next);
      });
    }
    container.appendChild(dot);
  });
}
