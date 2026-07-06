// ====== ĐĂNG NHẬP + PHÂN QUYỀN (Firebase Authentication) ======
import { auth, db, firebaseConfig } from "./firebase-config.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail, getAuth, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  doc, getDoc, setDoc, deleteDoc, collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Admin gốc: ai đăng nhập bằng đúng email này luôn là admin (không ai đổi được)
const ADMIN_EMAIL = "nguyenquocthitpiuh@gmail.com";

// Mỗi vai trò = một tập quyền. Thêm vai trò mới sau này chỉ cần thêm 1 dòng ở đây.
const ROLE_PERMS = {
  admin:     { view:true, addDelete:true,  manageMaster:true,  manageUsers:true,  editCols:"all" },
  price:     { view:true, addDelete:false, manageMaster:false, manageUsers:false, editCols:["unitPrice"] },
  dimension: { view:true, addDelete:false, manageMaster:false, manageUsers:false, editCols:["dimension","tareCtn"] },
  viewer:    { view:true, addDelete:false, manageMaster:false, manageUsers:false, editCols:[] },
  guest:     { view:true, addDelete:false, manageMaster:false, manageUsers:false, editCols:[] },
};
export const ROLE_LABELS = {
  admin:"Admin (toàn quyền)", price:"Sửa giá", dimension:"Sửa Dimension", viewer:"Chỉ xem", guest:"Khách (chỉ xem, không xuất)"
};

let _user = null, _role = null, _nick = "", _resolved = false;
const _cbs = [];

async function resolveProfile(u) {
  if (!u) { _role = null; _nick = ""; return; }
  const email = (u.email || "").toLowerCase();
  if (email === ADMIN_EMAIL) {
    _role = "admin"; _nick = "Admin";
    try { const s = await getDoc(doc(db,"users",u.uid)); if (s.exists() && s.data().nickname) _nick = s.data().nickname; } catch (e) {}
    return;
  }
  try {
    const s = await getDoc(doc(db,"users",u.uid));
    if (s.exists()) { _role = s.data().role || "viewer"; _nick = s.data().nickname || u.email; }
    else { _role = "viewer"; _nick = u.email; }
  } catch (e) { _role = "viewer"; _nick = u.email; }
}

onAuthStateChanged(auth, async u => {
  _user = u;
  await resolveProfile(u);
  _resolved = true;
  _cbs.forEach(cb => { try { cb(u); } catch (e) {} });
});

export function currentUser() { return _user; }
export function isLoggedIn() { return !!_user; }
export function authResolved() { return _resolved; }
export function role() { return _role; }
export function nickname() { return _nick; }
export function perms() { return ROLE_PERMS[_role] || ROLE_PERMS.viewer; }
export function isAdmin() { return _role === "admin"; }
export function isGuest() { return _role === "guest"; }
// Có được sửa ít nhất 1 cột không (để hiện nút "Chỉnh sửa Excel")
export function canEditAnyCol() {
  const p = perms();
  return p.editCols === "all" || (Array.isArray(p.editCols) && p.editCols.length > 0);
}

export function onAuthChange(cb) {
  _cbs.push(cb);
  if (_resolved) { try { cb(_user); } catch (e) {} }
}

export async function loginUser(email, password) {
  const cred = await signInWithEmailAndPassword(auth, (email || "").trim(), password);
  return cred.user;
}
export async function logout() { await signOut(auth); }
export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, (email || "").trim());
}

// ====== QUẢN LÝ TÀI KHOẢN (chỉ admin dùng) ======
// Tạo tài khoản bằng app phụ để KHÔNG đăng xuất admin hiện tại.
export async function createAccount(email, password) {
  let secApp;
  try { secApp = getApp("secondary"); } catch (e) { secApp = initializeApp(firebaseConfig, "secondary"); }
  const secAuth = getAuth(secApp);
  const cred = await createUserWithEmailAndPassword(secAuth, (email || "").trim(), password);
  const uid = cred.user.uid;
  await signOut(secAuth);
  return uid;
}
export async function saveUserProfile(uid, data) {
  await setDoc(doc(db,"users",uid), data, { merge:true });
}
export async function getAllUsers() {
  const s = await getDocs(collection(db,"users"));
  return s.docs.map(d => ({ uid:d.id, ...d.data() }));
}
export async function deleteUserProfile(uid) {
  await deleteDoc(doc(db,"users",uid));
}
