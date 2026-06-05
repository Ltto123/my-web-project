const API_BASE =
  window.location.protocol === "file:"
    ? "http://127.0.0.1:8000"
    : window.location.origin;

const USER_STORAGE_KEY = "blog_current_user";

let safeStorage = window.localStorage;
let resources = [];
let currentUser = null;
let currentCategory = "";
let ownerUsername = "";

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loadUserSession() {
  try {
    const raw = safeStorage.getItem(USER_STORAGE_KEY);
    currentUser = raw ? JSON.parse(raw) : null;
  } catch {
    currentUser = null;
  }
}

function saveUserSession(user) {
  currentUser = user;
  safeStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

function clearUserSession() {
  currentUser = null;
  safeStorage.removeItem(USER_STORAGE_KEY);
}

function isLoggedIn() {
  return Boolean(currentUser && currentUser.user_id);
}

function isOwner() {
  return isLoggedIn() && ownerUsername && currentUser.username === ownerUsername;
}

function formatPostDate(dateValue) {
  if (!dateValue) return "未知";
  let normalized = dateValue;
  if (
    typeof normalized === "string" &&
    !/[Zz]|[+-]\d{2}:\d{2}$/.test(normalized)
  ) {
    normalized = normalized.replace(" ", "T") + "Z";
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return "未知";
  return parsed.toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

/* ========== 资源列表 ========== */

async function loadResources(category = "") {
  try {
    const params = category ? `?category=${encodeURIComponent(category)}` : "";
    const response = await fetch(`${API_BASE}/api/v1/resources${params}`);
    const result = await response.json();
    if (result.code === 0) {
      resources = result.data;
      renderResourceList();
    }
  } catch (e) {
    console.error("加载资源失败:", e);
  }
}

function renderResourceList() {
  const listContainer = document.querySelector("#resource-list");
  if (!listContainer) return;

  if (resources.length === 0) {
    listContainer.innerHTML = `<div class="empty-posts">📭 暂无资源</div>`;
    return;
  }

  const categoryColors = {
    "PPT": "#ef4444", "课件": "#f59e0b", "学习笔记": "#10b981",
    "电子书": "#3b82f6", "其他": "#6b7280",
  };

  let html = "";
  for (const r of resources) {
    const badgeColor = categoryColors[r.category] || "#6b7280";
    const deleteBtnHtml = isOwner()
      ? `<button class="delete-card-btn" data-id="${r.id}">🗑️ 删除</button>`
      : "";
    const starClass = r.starred ? "starred" : "";
    const starText = r.starred ? "⭐" : "☆";

    html += `
      <article class="blog-card resource-card" data-id="${r.id}">
        <span class="hot-badge" style="background-color:${badgeColor};">${escapeHtml(r.category)}</span>
        <h2>${escapeHtml(r.title)}</h2>
        ${r.description ? `<p class="card-content">${escapeHtml(r.description)}</p>` : ""}
        <div class="card-meta">
          <span>📅 ${formatPostDate(r.created_at)}</span>
          <span>✍️ ${escapeHtml(r.author)}</span>
          <span class="star-btn-card ${starClass}" data-id="${r.id}" data-action="star">${starText} <span class="star-count">${r.star_count || 0}</span></span>
        </div>
        <div class="card-footer" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <a href="${escapeHtml(r.file_url)}" class="toggle-btn" style="text-decoration:none;font-size:13px;" download>📥 ${escapeHtml(r.file_name)}</a>
          ${deleteBtnHtml}
        </div>
      </article>
    `;
  }

  listContainer.innerHTML = html;
}

/* ========== 分类筛选 ========== */

function initCategoryBar() {
  const bar = document.querySelector(".category-bar");
  if (!bar) return;
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".cat-btn");
    if (!btn) return;
    bar.querySelectorAll(".cat-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentCategory = btn.dataset.cat;
    loadResources(currentCategory);
  });
}

/* ========== 上传（仅博主） ========== */

async function uploadResourceFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE}/api/v1/upload?user_id=${currentUser.user_id}`, {
    method: "POST", body: formData,
  });
  const result = await response.json();
  if (result.detail) throw new Error(typeof result.detail === 'string' ? result.detail : JSON.stringify(result.detail));
  if (result.code !== 0) throw new Error(result.msg || "上传失败");
  return result.data.url;
}

async function submitResource(form) {
  const title = document.querySelector("#resource-title").value.trim();
  const description = document.querySelector("#resource-desc").value.trim();
  const category = document.querySelector("#resource-category").value;
  const fileInput = document.querySelector("#resource-file");
  const file = fileInput?.files[0];

  if (!title) { alert("请输入标题"); return; }
  if (!category) { alert("请选择分类"); return; }
  if (!file) { alert("请选择文件"); return; }

  try {
    const fileUrl = await uploadResourceFile(file);
    const response = await fetch(`${API_BASE}/api/v1/resources?user_id=${currentUser.user_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title, description, category,
        file_url: fileUrl, file_name: file.name,
      }),
    });
    const result = await response.json();
    if (result.code === 0) {
      form.reset();
      loadResources(currentCategory);
    } else {
      alert(result.msg);
    }
  } catch (err) {
    alert("上传失败: " + err.message);
  }
}

/* ========== Auth UI ========== */

function updateAuthUI() {
  const userArea = document.querySelector("#auth-user-area");
  const guestArea = document.querySelector("#auth-guest-area");
  const welcomeEl = document.querySelector("#auth-welcome");
  const uploadSection = document.querySelector("#upload-section");

  if (isLoggedIn()) {
    userArea?.classList.remove("hidden");
    guestArea?.classList.add("hidden");
    if (welcomeEl) welcomeEl.textContent = `欢迎，${currentUser.username}`;
    // 只有博主能看到上传表单
    uploadSection?.classList.toggle("hidden", !isOwner());
  } else {
    userArea?.classList.add("hidden");
    guestArea?.classList.remove("hidden");
    uploadSection?.classList.add("hidden");
  }
  loadResources(currentCategory);
}

function openAuthModal(tab = "login") {
  document.querySelector("#auth-modal")?.classList.remove("hidden");
  switchAuthTab(tab);
  clearAuthErrors();
}

function closeAuthModal() {
  document.querySelector("#auth-modal")?.classList.add("hidden");
  document.querySelector("#login-form")?.reset();
  document.querySelector("#register-form")?.reset();
  clearAuthErrors();
}

function switchAuthTab(tab) {
  const isLogin = tab === "login";
  document.querySelector("#auth-tab-login")?.classList.toggle("active", isLogin);
  document.querySelector("#auth-tab-register")?.classList.toggle("active", !isLogin);
  document.querySelector("#login-form")?.classList.toggle("hidden", !isLogin);
  document.querySelector("#register-form")?.classList.toggle("hidden", isLogin);
  clearAuthErrors();
}

function clearAuthErrors() {
  for (const id of ["login-error", "register-error"]) {
    const el = document.querySelector(`#${id}`);
    if (el) { el.textContent = ""; el.classList.add("hidden"); }
  }
}

function showAuthError(formType, message) {
  const el = document.querySelector(`#${formType}-error`);
  if (el) { el.textContent = message; el.classList.remove("hidden"); }
}

async function loginUser(username, password) {
  const r = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return r.json();
}

async function registerUser(username, password) {
  const r = await fetch(`${API_BASE}/api/v1/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return r.json();
}

function initAuthInteractions() {
  document.querySelector("#login-open-btn")?.addEventListener("click", () => openAuthModal("login"));
  document.querySelector("#register-open-btn")?.addEventListener("click", () => openAuthModal("register"));
  document.querySelector("#auth-modal-close")?.addEventListener("click", closeAuthModal);
  document.querySelector("#auth-modal")?.addEventListener("click", (e) => { if (e.target.id === "auth-modal") closeAuthModal(); });
  document.querySelector("#logout-btn")?.addEventListener("click", () => { clearUserSession(); updateAuthUI(); });
  document.querySelector("#auth-tab-login")?.addEventListener("click", () => switchAuthTab("login"));
  document.querySelector("#auth-tab-register")?.addEventListener("click", () => switchAuthTab("register"));
  document.querySelector("#login-form")?.addEventListener("submit", async (e) => {
    e.preventDefault(); clearAuthErrors();
    const u = document.querySelector("#login-username").value.trim();
    const p = document.querySelector("#login-password").value;
    try {
      const r = await loginUser(u, p);
      if (r.code === 0) { saveUserSession(r.data); closeAuthModal(); updateAuthUI(); }
      else showAuthError("login", r.msg);
    } catch { showAuthError("login", "无法连接服务器"); }
  });
  document.querySelector("#register-form")?.addEventListener("submit", async (e) => {
    e.preventDefault(); clearAuthErrors();
    const u = document.querySelector("#register-username").value.trim();
    const p = document.querySelector("#register-password").value;
    try {
      const r = await registerUser(u, p);
      if (r.code === 0) { alert("注册成功，请登录。"); switchAuthTab("login"); document.querySelector("#login-username").value = u; document.querySelector("#register-form").reset(); }
      else showAuthError("register", r.msg);
    } catch { showAuthError("register", "无法连接服务器"); }
  });
}

/* ========== 星标 ========== */

async function toggleResourceStar(resourceId) {
  if (!isLoggedIn()) { alert("请先登录"); openAuthModal("login"); return; }
  try {
    const r = await fetch(`${API_BASE}/api/v1/resources/${resourceId}/star`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: currentUser.user_id }),
    });
    const result = await r.json();
    if (result.code === 0) {
      const resource = resources.find(r => r.id === resourceId);
      if (resource) { resource.star_count = result.data.star_count; resource.starred = result.data.starred; }
      renderResourceList();
    }
  } catch { /* ignore */ }
}

/* ========== Init ========== */

function initInteractions() {
  const themeBtn = document.querySelector("#theme-btn");
  if (safeStorage.getItem("dark_mode_active") === "true") document.body.classList.add("dark-theme");
  themeBtn?.addEventListener("click", () => {
    document.body.classList.toggle("dark-theme");
    safeStorage.setItem("dark_mode_active", document.body.classList.contains("dark-theme"));
  });

  document.querySelector("#resource-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isOwner()) return;
    await submitResource(e.target);
  });

  document.querySelector("#resource-list")?.addEventListener("click", async (e) => {
    if (e.target.classList.contains("delete-card-btn")) {
      e.stopPropagation();
      if (!isOwner()) return;
      const id = e.target.getAttribute("data-id");
      if (!confirm("确定删除？")) return;
      try {
        const r = await fetch(`${API_BASE}/api/v1/resources/${id}?user_id=${currentUser.user_id}`, { method: "DELETE" });
        const result = await r.json();
        if (result.code === 0) loadResources(currentCategory);
        else alert(result.msg);
      } catch { alert("网络错误"); }
      return;
    }

    const starBtn = e.target.closest("[data-action='star']");
    if (starBtn) {
      e.stopPropagation();
      const id = parseInt(starBtn.getAttribute("data-id"));
      await toggleResourceStar(id);
    }
  });
}

async function loadSiteConfig() {
  try {
    const response = await fetch(`${API_BASE}/api/v1/site-config`);
    const result = await response.json();
    if (result.code === 0 && result.data) {
      ownerUsername = result.data.owner_username || "";
    }
  } catch (e) {
    console.error("加载站点配置失败:", e);
  }
}

async function init() {
  loadUserSession();
  initAuthInteractions();
  initCategoryBar();
  initInteractions();
  await loadSiteConfig();
  updateAuthUI();
}

init();
