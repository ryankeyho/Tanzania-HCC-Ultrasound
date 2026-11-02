/* Shared API client. Every page that needs auth state or server calls
   includes this first. CSRF token is kept in memory (sessionStorage as a
   fallback across page navigations within the same tab), never in a
   place a script on another origin could read it, since it is only ever
   sent as a custom header, which browsers block cross-origin without an
   explicit CORS allow. */

const Api = (() => {
  let csrf = sessionStorage.getItem("csrf") || null;
  let user = null;

  function setCsrf(token) {
    csrf = token;
    if (token) sessionStorage.setItem("csrf", token);
    else sessionStorage.removeItem("csrf");
  }

  async function call(path, { method = "GET", body } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (csrf && method !== "GET") headers["X-CSRF-Token"] = csrf;
    const res = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function refreshMe() {
    const data = await call("/api/me");
    user = data.user;
    if (data.csrf) setCsrf(data.csrf);
    return user;
  }

  async function login(email, password) {
    const data = await call("/api/login", { method: "POST", body: { email, password } });
    user = data.user;
    setCsrf(data.csrf);
    return user;
  }

  async function register(name, email, password, cohort) {
    return call("/api/register", { method: "POST", body: { name, email, password, cohort } });
  }

  async function guestLogin() {
    const data = await call("/api/guest-login", { method: "POST" });
    user = data.user;
    setCsrf(data.csrf);
    return user;
  }

  async function logout() {
    try { await call("/api/logout", { method: "POST" }); } finally {
      user = null;
      setCsrf(null);
      window.location.href = "/login.html";
    }
  }

  /** Call at the top of every protected page. Redirects to login if not
   * authenticated, and injects the shared header once confirmed. */
  async function requireAuth() {
    try {
      const u = await refreshMe();
      if (!u) throw new Error("not authenticated");
      renderHeader(u);
      return u;
    } catch (e) {
      window.location.href = "/login.html?next=" + encodeURIComponent(window.location.pathname);
      throw e;
    }
  }

  function renderHeader(u) {
    const el = document.getElementById("site-header");
    if (!el) return;
    const dashLink = (u.role === "admin" || u.role === "instructor")
      ? `<a href="/admin.html">Instructor Dashboard</a><a href="/review-comments.html">Reviewer Comments</a>` : "";
    el.innerHTML = `
      <div class="site-nav-links">
        <span class="site-brand"><img src="/static/branding/logo-icon.png" alt="" onerror="this.style.display='none'"> Tanzania HCC</span>
        <a href="/index.html">Course Home</a>
        <a href="/progress.html">My Progress</a>
        ${dashLink}
      </div>
      <div class="site-user">
        <span>${u.name} (${u.role})</span>
        <button class="site-logout" id="site-logout-btn">Log out</button>
      </div>`;
    document.getElementById("site-logout-btn").addEventListener("click", () => Api.logout());
  }

  return { call, refreshMe, login, register, guestLogin, logout, requireAuth, get user() { return user; } };
})();
