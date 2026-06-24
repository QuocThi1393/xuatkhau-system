const ADMIN_PASSWORD = "1Cvxr2cc";
const ADMIN_KEY = "xk_admin_session";

export function isAdmin() {
  return sessionStorage.getItem(ADMIN_KEY) === "true";
}

export function loginAdmin(password) {
  if (password === ADMIN_PASSWORD) {
    sessionStorage.setItem(ADMIN_KEY, "true");
    return true;
  }
  return false;
}

export function logoutAdmin() {
  sessionStorage.removeItem(ADMIN_KEY);
}

export function requireAdminUI(elements) {
  const admin = isAdmin();
  elements.forEach(el => {
    if (el) el.style.display = admin ? "" : "none";
  });
}
