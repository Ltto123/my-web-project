const API_BASE =
  window.location.protocol === "file:"
    ? "http://127.0.0.1:8000"
    : window.location.origin;

const USER_STORAGE_KEY = "blog_token";

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

// ========== JWT 鉴权 ==========

function loadUserSession() {
  try {
    const raw = safeStorage.getItem(USER_STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      currentUser = { token: data.token, user_id: data.user_id, username: data.username };
    }
  } catch {
    currentUser = null;
  }
}

function saveUserSession(user) {
  currentUser = { token: user.token, user_id: user.user_id, username: user.username };
  safeStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentUser));
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

function getAuthHeaders() {
  if (isLoggedIn() && currentUser.token) {
    return { "Authorization": "Bearer " + currentUser.token, "Content-Type": "application/json" };
  }
  return { "Content-Type": "application/json" };
}

function formatPostDate(dateValue) {
  if (!dateValue) return "未知";
  let normalized = dateValue;
  if (typeof normalized === "string" && !/[Zz]|[+-]\d{2}:\d{2}$/.test(normalized)) {
    normalized = normalized.replace(" ", "T") + "Z";
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return "未知";
  return parsed.toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

// ========== 资源列表 ==========

async function loadResources(category = "") {
  try {
    const params = category ? `?category=${encodeURIComponent(category)}` : "";
    const response = await fetch(`${API_BASE}/api/v1/resources${params}`, { headers: getAuthHeaders() });
    const result = await response.json();
    if (result.code === 0) {
      resources = result.data;
      renderResourceList();
    }
  } catch (e) {
    console.error("加载资源失败:", e);
  }
}

function getFileExtension(filename) {
  return (filename || "").split(".").pop().toLowerCase();
}

function isPreviewableType(filename) {
  const ext = getFileExtension(filename);
  const pdf = ["pdf"];
  const images = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"];
  const text = ["txt", "md", "csv", "json", "xml", "yaml", "yml", "log"];
  const html = ["html", "htm"];
  return {
    previewable: [...pdf, ...images, ...text, ...html].includes(ext),
    type: pdf.includes(ext) ? "pdf"
        : images.includes(ext) ? "image"
        : text.includes(ext) ? "text"
        : html.includes(ext) ? "html"
        : "other",
    ext: ext,
  };
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
    const previewInfo = isPreviewableType(r.file_name);
    const previewLabel = previewInfo.previewable ? "👁 预览" : "📥 下载";

    html += `
      <article class="blog-card resource-card" data-id="${r.id}">
        <span class="hot-badge" style="background-color:${badgeColor};">${escapeHtml(r.category)}</span>
        <h2>${escapeHtml(r.title)}</h2>
        ${r.description ? `<p class="card-content markdown-body">${renderMarkdownInline(r.description)}</p>` : ""}
        <div class="card-meta">
          <span>📅 ${formatPostDate(r.created_at)}</span>
          <span>✍️ ${escapeHtml(r.author)}</span>
          <span>📄 .${getFileExtension(r.file_name).toUpperCase()}</span>
          <span class="star-btn-card ${starClass}" data-id="${r.id}" data-action="star">${starText} <span class="star-count">${r.star_count || 0}</span></span>
        </div>
        <div class="card-footer" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <button class="toggle-btn preview-btn" data-id="${r.id}" data-action="preview" style="font-size:13px;">${previewLabel} ${escapeHtml(r.file_name)}</button>
          ${deleteBtnHtml}
        </div>
      </article>
    `;
  }

  listContainer.innerHTML = html;
}

// 轻量级 Markdown 渲染（仅行内，用于描述字段）
function renderMarkdownInline(text) {
  if (!text) return "";
  let html = escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/\n/g, "<br>");
  return html;
}

// ========== 资源预览弹窗 ==========

function openResourcePreview(resource) {
  const fileUrl = resource.file_url;
  const fileName = resource.file_name;
  const info = isPreviewableType(fileName);

  const modalOverlay = document.createElement("div");
  modalOverlay.className = "custom-modal-overlay preview-modal-overlay";

  const closeModal = () => modalOverlay.remove();
  modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });

  let previewBody = "";
  if (info.type === "pdf") {
    // PDF 用 iframe 内嵌预览（浏览器原生支持）
    previewBody = `<iframe src="${escapeHtml(fileUrl)}" class="preview-frame" title="PDF预览"></iframe>`;
  } else if (info.type === "image") {
    // 图片直接展示
    previewBody = `<div class="preview-image-wrap"><img src="${escapeHtml(fileUrl)}" alt="${escapeHtml(fileName)}" class="preview-image" /></div>`;
  } else if (info.type === "text") {
    // 文本文件异步加载展示
    previewBody = `<div class="preview-text-wrap"><pre id="preview-text-content" class="preview-text">加载中...</pre></div>`;
  } else if (info.type === "html") {
    previewBody = `<iframe src="${escapeHtml(fileUrl)}" class="preview-frame" title="HTML预览"></iframe>`;
  } else {
    // 不支持预览的文件类型（docx, pptx, zip 等）
    previewBody = `
      <div class="preview-unsupported">
        <div class="preview-unsupported-icon">📦</div>
        <p>此文件类型（<strong>.${info.ext.toUpperCase()}</strong>）暂不支持在线预览</p>
        <p class="preview-hint">请下载到本地后查看</p>
      </div>`;
  }

  modalOverlay.innerHTML = `
    <div class="custom-modal-content preview-modal-content">
      <span class="custom-modal-close">×</span>
      <div class="preview-header">
        <h2 class="preview-title">${escapeHtml(resource.title)}</h2>
        <div class="preview-meta">
          <span>📅 ${formatPostDate(resource.created_at)}</span>
          <span>✍️ ${escapeHtml(resource.author)}</span>
          <span>📄 ${escapeHtml(fileName)}</span>
        </div>
      </div>
      <div class="preview-body">${previewBody}</div>
      <div class="preview-footer">
        <a href="${escapeHtml(fileUrl)}" class="toggle-btn" download style="text-decoration:none;">📥 下载文件</a>
        <span class="preview-file-info">${escapeHtml(fileName)}</span>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);
  modalOverlay.querySelector(".custom-modal-close").addEventListener("click", closeModal);

  // 异步加载文本文件内容
  if (info.type === "text") {
    fetch(fileUrl)
      .then(r => r.text())
      .then(text => {
        const el = modalOverlay.querySelector("#preview-text-content");
        if (el) el.textContent = text;
      })
      .catch(() => {
        const el = modalOverlay.querySelector("#preview-text-content");
        if (el) el.textContent = "加载失败，请下载后查看。";
      });
  }
}

// ========== 分类筛选 ==========

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

// ========== 上传（仅博主） ==========

async function uploadResourceFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE}/api/v1/upload`, {
    method: "POST",
    headers: { "Authorization": "Bearer " + currentUser.token },
    body: formData,
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
    const response = await fetch(`${API_BASE}/api/v1/resources`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ title, description, category, file_url: fileUrl, file_name: file.name }),
    });
    const result = await response.json();
    if (result.code === 0) { form.reset(); loadResources(currentCategory); }
    else { alert(result.msg); }
  } catch (err) {
    alert("上传失败: " + err.message);
  }
}

// ========== Auth UI ==========

function updateAuthUI() {
  const userArea = document.querySelector("#auth-user-area");
  const guestArea = document.querySelector("#auth-guest-area");
  const welcomeEl = document.querySelector("#auth-welcome");
  const uploadSection = document.querySelector("#upload-section");

  if (isLoggedIn()) {
    userArea?.classList.remove("hidden");
    guestArea?.classList.add("hidden");
    if (welcomeEl) welcomeEl.textContent = `欢迎，${currentUser.username}`;
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

// ========== 星标 ==========

async function toggleResourceStar(resourceId) {
  if (!isLoggedIn()) { alert("请先登录"); openAuthModal("login"); return; }
  try {
    const r = await fetch(`${API_BASE}/api/v1/resources/${resourceId}/star`, {
      method: "POST",
      headers: getAuthHeaders(),
    });
    const result = await r.json();
    if (result.code === 0) {
      const resource = resources.find(r => r.id === resourceId);
      if (resource) { resource.star_count = result.data.star_count; resource.starred = result.data.starred; }
      renderResourceList();
    }
  } catch { /* ignore */ }
}

// ========== Init ==========

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
    // 删除按钮
    if (e.target.classList.contains("delete-card-btn")) {
      e.stopPropagation();
      if (!isOwner()) return;
      const id = e.target.getAttribute("data-id");
      if (!confirm("确定删除？")) return;
      try {
        const r = await fetch(`${API_BASE}/api/v1/resources/${id}`, {
          method: "DELETE",
          headers: getAuthHeaders(),
        });
        const result = await r.json();
        if (result.code === 0) loadResources(currentCategory);
        else alert(result.msg);
      } catch { alert("网络错误"); }
      return;
    }

    // 星标按钮
    const starBtn = e.target.closest("[data-action='star']");
    if (starBtn) {
      e.stopPropagation();
      const id = parseInt(starBtn.getAttribute("data-id"));
      await toggleResourceStar(id);
      return;
    }

    // 预览按钮
    const previewBtn = e.target.closest("[data-action='preview']");
    if (previewBtn) {
      e.stopPropagation();
      const id = parseInt(previewBtn.getAttribute("data-id"));
      const resource = resources.find(r => r.id === id);
      if (resource) openResourcePreview(resource);
      return;
    }

    // 点击整张卡片也打开预览
    const card = e.target.closest(".resource-card");
    if (card) {
      const id = parseInt(card.getAttribute("data-id"));
      const resource = resources.find(r => r.id === id);
      if (resource) openResourcePreview(resource);
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
