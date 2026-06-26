// ====== ĐĂNG NHẬP BẰNG FIREBASE AUTHENTICATION (email + mật khẩu) ======
import { auth } from "./firebase-config.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

let _user = null;
let _resolved = false;
const _cbs = [];

// Lắng nghe trạng thái đăng nhập (Firebase tự khôi phục phiên khi tải lại trang)
onAuthStateChanged(auth, u => {
  _user = u;
  _resolved = true;
  _cbs.forEach(cb => { try { cb(u); } catch (e) {} });
});

export function currentUser() { return _user; }
export function isLoggedIn() { return !!_user; }
export function authResolved() { return _resolved; }

// Tạm thời: đã đăng nhập = toàn quyền (admin). Phân quyền chi tiết sẽ làm ở đợt sau.
export function isAdmin() { return !!_user; }

// Đăng ký callback chạy mỗi khi trạng thái đăng nhập đổi.
// Nếu trạng thái đã sẵn sàng thì gọi ngay luôn.
export function onAuthChange(cb) {
  _cbs.push(cb);
  if (_resolved) { try { cb(_user); } catch (e) {} }
}

export async function loginUser(email, password) {
  const cred = await signInWithEmailAndPassword(auth, (email || "").trim(), password);
  return cred.user;
}

export async function logout() {
  await signOut(auth);
}
