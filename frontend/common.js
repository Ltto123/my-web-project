/**
 * common.js — 博客全局公共模块
 * 所有页面共享：常量、工具函数、认证、主题、文件上传
 */

/* ===================================================================
   A. 全局常量 & 状态
   =================================================================== */
const API_BASE =
  window.location.protocol === "file:"
    ? "http://127.0.0.1:8000"
    : window.location.origin;

const USER_STORAGE_KEY = "blog_token";
// 隐私模式或存储配额限制不能让整个站点失去交互能力。
const safeStorage = (() => {
  const fallback = new Map();
  const unsaved = new Set();
  return {
    getItem(key) { if (unsaved.has(key)) return fallback.get(key) ?? null; try { return window.localStorage.getItem(key); } catch { return fallback.get(key) ?? null; } },
    setItem(key, value) { fallback.set(key, String(value)); try { window.localStorage.setItem(key, String(value)); unsaved.delete(key); } catch { unsaved.add(key); } },
    removeItem(key) { fallback.delete(key); try { window.localStorage.removeItem(key); unsaved.delete(key); } catch { unsaved.add(key); } },
    sync(key) { if (key === null) { unsaved.clear(); fallback.clear(); } else { unsaved.delete(key); fallback.delete(key); } },
  };
})();
let currentUser = null;
let ownerUsername = "";
let logoutTimer = null;  // setTimeout ID for auto-logout on token expiry

/* ===================================================================
   B. HTML / 日期 工具函数
   =================================================================== */
function escapeHtml(text) {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPostDate(dateStr) {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

/* ===================================================================
   C. 用户会话 (localStorage + JWT)
   =================================================================== */
function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")), c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function loadUserSession() {
  currentUser = null;
  if (logoutTimer) clearTimeout(logoutTimer);
  logoutTimer = null;
  try {
    const raw = safeStorage.getItem(USER_STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && typeof data.token === "string") {
        const payload = decodeJwtPayload(data.token);
        const expiresAt = Number(payload?.exp) * 1000;
        // Check expiry before restoring session
        if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
          safeStorage.removeItem(USER_STORAGE_KEY);
          return; // token expired, don't restore
        }
        currentUser = { token: data.token, user_id: data.user_id, username: data.username };
        // Set auto-logout timer for the remaining time
        scheduleAutoLogout(expiresAt);
      }
    }
  } catch {
    currentUser = null;
  }
}

function scheduleAutoLogout(expiresAt) {
  if (logoutTimer) clearTimeout(logoutTimer);
  if (!expiresAt) return;
  const delay = expiresAt - Date.now();
  if (delay <= 0) {
    clearUserSession();
    updateAuthUI();
    return;
  }
  logoutTimer = setTimeout(() => {
    clearUserSession();
    updateAuthUI();
    showToast("登录已过期，请重新登录。", "info");
  }, delay);
}

function saveUserSession(user) {
  // Decode JWT to extract expiry time
  const payload = decodeJwtPayload(user.token);
  const expiresAt = payload && payload.exp ? payload.exp * 1000 : null; // JWT exp is in seconds

  currentUser = { token: user.token, user_id: user.user_id, username: user.username };
  safeStorage.setItem(USER_STORAGE_KEY, JSON.stringify({
    token: user.token,
    user_id: user.user_id,
    username: user.username,
    expires_at: expiresAt,
  }));
  scheduleAutoLogout(expiresAt);
}

function clearUserSession() {
  currentUser = null;
  safeStorage.removeItem(USER_STORAGE_KEY);
  if (logoutTimer) { clearTimeout(logoutTimer); logoutTimer = null; }
}

function isLoggedIn() {
  return Boolean(currentUser && typeof currentUser.token === "string" && currentUser.token.length > 0);
}

function isOwner() {
  return isLoggedIn() && ownerUsername && currentUser.username === ownerUsername;
}

function getAuthHeaders() {
  if (isLoggedIn()) {
    return { "Authorization": "Bearer " + currentUser.token, "Content-Type": "application/json" };
  }
  return { "Content-Type": "application/json" };
}

/* ===================================================================
   D. 认证弹窗 UI
   =================================================================== */
function openAuthModal(tab) {
  const modal = document.querySelector("#auth-modal");
  if (modal) modal.classList.remove("hidden");
  switchAuthTab(tab || "login");
}

function closeAuthModal() {
  const modal = document.querySelector("#auth-modal");
  if (modal) modal.classList.add("hidden");
  clearAuthErrors();
}

function switchAuthTab(tab) {
  const heading = document.querySelector('#auth-heading');
  if (heading) heading.textContent = tab === 'register' ? '从这里，开始。' : '好久不见。';
  const loginForm = document.querySelector("#login-form");
  const registerForm = document.querySelector("#register-form");
  const loginTab = document.querySelector("#auth-tab-login");
  const registerTab = document.querySelector("#auth-tab-register");
  if (tab === "register") {
    loginForm?.classList.add("hidden");
    registerForm?.classList.remove("hidden");
    loginTab?.classList.remove("active");
    registerTab?.classList.add("active");
  } else {
    loginForm?.classList.remove("hidden");
    registerForm?.classList.add("hidden");
    loginTab?.classList.add("active");
    registerTab?.classList.remove("active");
  }
  clearAuthErrors();
}

function clearAuthErrors() {
  ["#login-error", "#register-error"].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) { el.classList.add("hidden"); el.textContent = ""; }
  });
}

function showAuthError(formType, message) {
  const el = document.querySelector(formType === "login" ? "#login-error" : "#register-error");
  if (el) { el.textContent = message; el.classList.remove("hidden"); }
}

/* ===================================================================
   E. 登录 / 注册 API 调用
   =================================================================== */
async function loginUser(username, password) {
  const button = document.querySelector('#login-form button[type="submit"]');
  if (button?.disabled) return;
  if (button) { button.disabled = true; button.textContent = "正在登录…"; }
  try {
    const result = await requestJson(`${API_BASE}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (result.code === 0) {
      saveUserSession(result.data);
      updateAuthUI();
      closeAuthModal();
    } else {
      showAuthError("login", result.msg || "登录失败");
    }
  } catch (error) {
    showAuthError("login", error.message || "网络请求失败");
  } finally {
    if (button) { button.disabled = false; button.textContent = "登录"; }
  }
}

async function registerUser(username, password) {
  const button = document.querySelector('#register-form button[type="submit"]');
  if (button?.disabled) return;
  if (button) { button.disabled = true; button.textContent = "正在注册…"; }
  try {
    const result = await requestJson(`${API_BASE}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (result.code === 0) {
      openAuthModal("login");
    } else {
      showAuthError("register", result.msg || "注册失败");
    }
  } catch (error) {
    showAuthError("register", error.message || "网络请求失败");
  } finally {
    if (button) { button.disabled = false; button.textContent = "注册"; }
  }
}

/* ===================================================================
   F. 认证 UI 状态 & 站点配置
   =================================================================== */
function updateAuthUI() {
  const userArea = document.querySelector("#auth-user-area");
  const guestArea = document.querySelector("#auth-guest-area");
  const welcome = document.querySelector("#auth-welcome");
  if (isLoggedIn()) {
    userArea?.classList.remove("hidden");
    guestArea?.classList.add("hidden");
    if (welcome && currentUser.username) welcome.textContent = "👋 " + currentUser.username;
  } else {
    userArea?.classList.add("hidden");
    guestArea?.classList.remove("hidden");
  }
  // Notify all page scripts that auth state changed (they should re-render)
  document.dispatchEvent(new CustomEvent("auth-changed"));
}

// Cross-tab auth sync: when user logs in/out on another tab, update this tab too
window.addEventListener("storage", (e) => {
  if (e.key === USER_STORAGE_KEY || e.key === null) {
    safeStorage.sync(e.key);
    loadUserSession();
    updateAuthUI();
  }
});

async function loadSiteConfig() {
  try {
    const result = await requestJson(`${API_BASE}/api/v1/site-config`);
    if (result.data) ownerUsername = result.data.owner_username || "";
  } catch { /* non-critical */ }
}

/* ===================================================================
   G. 公共导航
   =================================================================== */
const NAV_ITEMS = [
  { href: "/", label: "博客", icon: "📝" },
  { href: "/personal", label: "个人主页", icon: "👤" },
  { href: "/library", label: "资源库", icon: "📚" },
  { href: "/vocab", label: "不背单词", icon: "📖" },
  { href: "/herb", label: "中药识别", icon: "🌿" },
];

function renderMainNav() {
  const container = document.querySelector("#main-nav");
  if (!container) return;
  const currentPath = window.location.pathname;
  let html = "";
  for (const item of NAV_ITEMS) {
    const isActive = (currentPath === item.href) ? "active" : "";
    html += `<a href="${item.href}" class="nav-link ${isActive}"${isActive ? ' aria-current="page"' : ''}>${item.label}</a>`;
  }
  container.innerHTML = html;
}

/* ===================================================================
   H. 暗色主题
   =================================================================== */
function initThemeToggle() {
  const btn = document.querySelector("#theme-btn");
  if (btn?.dataset.themeBound === "true") return;
  const applyTone = (dark) => {
    document.body.classList.toggle("dark-theme", dark);
    document.documentElement.dataset.tone = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    if (btn) { btn.textContent = dark ? "浅色" : "深色"; btn.setAttribute("aria-label", dark ? "切换至浅色主题" : "切换至深色主题"); btn.setAttribute("aria-pressed", String(dark)); }
    document.dispatchEvent(new CustomEvent("tone-changed", { detail: { tone: dark ? "dark" : "light" } }));
  };
  const restoreTone = () => {
    const stored = safeStorage.getItem("dark_mode_active");
    applyTone(stored === "true" || (stored !== "false" && (document.body.dataset?.defaultTheme === "dark" || window.matchMedia?.("(prefers-color-scheme: dark)").matches)));
  };
  restoreTone();
  if (btn) btn.dataset.themeBound = "true";
  btn?.addEventListener("click", () => {
    const dark = !document.body.classList.contains("dark-theme");
    safeStorage.setItem("dark_mode_active", dark);
    applyTone(dark);
  });
  window.addEventListener("storage", event => {
    if (event.key !== "dark_mode_active" && event.key !== null) return;
    safeStorage.sync("dark_mode_active");
    restoreTone();
  });
  window.addEventListener("pageshow", event => {
    if (event.persisted) restoreTone();
  });
}

/* ===================================================================
   H. 认证交互绑定
   =================================================================== */
function initAuthInteractions() {
  document.querySelector("#login-open-btn")?.addEventListener("click", () => openAuthModal("login"));
  document.querySelector("#register-open-btn")?.addEventListener("click", () => openAuthModal("register"));
  document.querySelector("#auth-modal-close")?.addEventListener("click", closeAuthModal);
  document.querySelector("#auth-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "auth-modal") closeAuthModal();
  });
  document.querySelector("#auth-tab-login")?.addEventListener("click", () => switchAuthTab("login"));
  document.querySelector("#auth-tab-register")?.addEventListener("click", () => switchAuthTab("register"));
  document.querySelector("#logout-btn")?.addEventListener("click", () => {
    clearUserSession();
    updateAuthUI();
  });
  document.querySelector("#login-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    loginUser(
      document.querySelector("#login-username").value.trim(),
      document.querySelector("#login-password").value
    );
  });
  document.querySelector("#register-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    registerUser(
      document.querySelector("#register-username").value.trim(),
      document.querySelector("#register-password").value
    );
  });
}

/* ===================================================================
   I. 文件上传
   =================================================================== */
async function requestJson(url, options = {}) {
  const { timeout = 20000, signal, ...fetchOptions } = options;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeout);
  document.dispatchEvent(new CustomEvent("request-start"));
  try {
    const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
    let result;
    try { result = await response.json(); } catch { throw new Error("服务器返回了无法读取的响应，请稍后重试。"); }
    if (!response.ok || result.code !== 0) {
      const detail = Array.isArray(result.detail) ? result.detail.map(item => item.msg).join("；") : result.detail;
      throw new Error(result.msg || detail || `请求失败（${response.status}）`);
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error("请求超时，请检查网络后重试。");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    document.dispatchEvent(new CustomEvent("request-end"));
  }
}

function renderLoadError(container, message, retry) {
  if (!container) return;
  const state = document.createElement("div");
  state.className = "empty-posts load-error";
  state.setAttribute("role", "alert");
  const text = document.createElement("p");
  text.textContent = message;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "toggle-btn toggle-btn-outline";
  button.textContent = "重新加载";
  button.addEventListener("click", retry, { once: true });
  state.append(text, button);
  container.replaceChildren(state);
}

function safeFileUrl(value) {
  try {
    const url = new URL(value, API_BASE);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

async function uploadFile(file) {
  if (!isLoggedIn()) { showToast("请先登录后再上传。"); openAuthModal("login"); throw new Error("未登录"); }
  const formData = new FormData();
  formData.append("file", file);
  const result = await requestJson(`${API_BASE}/api/v1/upload`, {
    method: "POST",
    headers: { "Authorization": "Bearer " + currentUser.token },
    body: formData,
    timeout: 300000,
  });
  return result.data.url;
}

/* ===================================================================
   J. Markdown 渲染（博客 / 个人主页共用）
   =================================================================== */
function renderMarkdown(text) {
  if (!text) return "";
  if (typeof marked === "undefined" || typeof DOMPurify === "undefined") return escapeHtml(text);
  const codeBlocks = [];
  let processed = text.replace(/```[\s\S]*?```/g, (m) => { codeBlocks.push(m); return `@@CB${codeBlocks.length - 1}@@`; });
  processed = processed.replace(/`([^`]+)`/g, (m) => { codeBlocks.push(m); return `@@CB${codeBlocks.length - 1}@@`; });
  const latexItems = [];
  processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (m, f) => { latexItems.push({ t: "block", f: f.trim() }); return `@@LX${latexItems.length - 1}@@`; });
  processed = processed.replace(/(?<!\$)\$(?!\$)(.*?)(?<!\$)\$(?!\$)/g, (m, f) => { latexItems.push({ t: "inline", f: f.trim() }); return `@@LX${latexItems.length - 1}@@`; });
  marked.setOptions({ breaks: true, gfm: true });
  // 用户 HTML 不能借用应用 class/data 属性伪造弹窗或操作按钮。
  // 先清理用户标记，再加入可信的 KaTeX 样式，最后再次消毒完整结果。
  let html = DOMPurify.sanitize(marked.parse(processed), {
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe"],
    FORBID_ATTR: ["id", "name", "class", "style"],
    ALLOW_DATA_ATTR: false,
  });
  latexItems.forEach((item, i) => {
    const ph = `@@LX${i}@@`;
    try {
      html = html.replace(ph, katex.renderToString(item.f, { displayMode: item.t === "block", throwOnError: false }));
    } catch { html = html.replace(ph, escapeHtml(item.f)); }
  });
  html = html.replace(/<p>@@CB(\d+)@@<\/p>/g, "@@CB$1@@");
  codeBlocks.forEach((code, i) => {
    const ph = `@@CB${i}@@`;
    if (!code.startsWith("```")) {
      html = html.replace(ph, () => `<code>${escapeHtml(code.slice(1, -1))}</code>`);
      return;
    }
    const inner = code.replace(/^```\w*\n?/, "").replace(/```$/, "").trim();
    const lang = (code.match(/^```(\w*)/) || [])[1] || "";
    const label = lang ? `<span class="code-lang">${lang}</span>` : "";
    html = html.replace(ph, () => `<pre>${label}<code>${escapeHtml(inner)}</code></pre>`);
  });
  return DOMPurify.sanitize(html, { FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe"], FORBID_ATTR: ["id", "name"] });
}

function renderCommentsList(comments) {
  if (!comments.length) return '<p class="comments-empty">暂无评论，来抢沙发吧～</p>';
  return comments
    .map(
      (comment) => `
      <div class="comment-item">
        <div class="comment-meta">
          <strong>${escapeHtml(comment.author)}</strong>
          <span>${formatPostDate(comment.created_at)}</span>
        </div>
        <div class="comment-text markdown-body">${renderMarkdown(comment.content)}</div>
      </div>`
    )
    .join("");
}

function convertForPreview(markdown) {
  // Render full markdown, strip heavy blocks, let CSS line-clamp handle truncation
  let html = renderMarkdown(markdown);
  html = html.replace(/<pre[\s\S]*?<\/pre>/g, "");
  html = html.replace(/<img[\s\S]*?>/g, "");
  html = html.replace(/<table[\s\S]*?<\/table>/g, "");
  // Keep h1-h6 as bold text instead of removing
  html = html.replace(/<\/?h[1-6][^>]*>/g, "");
  return html;
}

function plainTextSummary(markdown, maxLen) {
  maxLen = maxLen || 200;
  const div = document.createElement("div");
  div.innerHTML = renderMarkdown(markdown);
  const plain = div.textContent || div.innerText || "";
  return plain.length > maxLen ? plain.slice(0, maxLen) + "..." : plain;
}

/* ===================================================================
   K. Markdown 工具栏（博客 / 个人主页共用）
   =================================================================== */
function initMarkdownToolbar(textareaId) {
  const ta = document.querySelector(textareaId);
  if (!ta) return;
  document.querySelectorAll(".md-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const marker = btn.getAttribute("data-md");
      if (!marker) return;
      const start = ta.selectionStart, end = ta.selectionEnd;
      const text = ta.value;
      if (marker.includes("\n")) {
        ta.value = text.slice(0, start) + marker + text.slice(end);
      } else {
        const sel = text.slice(start, end);
        ta.value = text.slice(0, start) + marker + sel + marker + text.slice(end);
      }
      ta.focus();
    });
  });
  ta.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "b") { e.preventDefault(); wrapSelection(ta, "**"); }
    if (e.ctrlKey && e.key === "i") { e.preventDefault(); wrapSelection(ta, "*"); }
  });
}

function wrapSelection(ta, marker) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  const t = ta.value;
  ta.value = t.slice(0, s) + marker + t.slice(s, e) + marker + t.slice(e);
}

/* ===================================================================
   L. Toast 轻通知
   =================================================================== */
function showToast(message, type) {
  type = type || "error";
  // Remove existing toasts to prevent stacking
  document.querySelectorAll(".toast").forEach(t => { t.classList.remove("toast-show"); setTimeout(() => t.remove(), 300); });
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const icons = { success: "✅", error: "❌", info: "ℹ️" };
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = icons[type] || icons.info;
  toast.append(icon, document.createTextNode(" " + String(message)));
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast-show"));
  setTimeout(() => {
    toast.classList.remove("toast-show");
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

/* ===================================================================
   M. 回到顶部
   =================================================================== */
function initBackToTop() {
  const btn = document.createElement("button");
  btn.id = "back-to-top";
  btn.innerHTML = "⬆";
  btn.title = "回到顶部";
  document.body.appendChild(btn);

  let ticking = false;
  window.addEventListener("scroll", () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        btn.classList.toggle("visible", window.scrollY > 500);
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });

  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
}

/* ===================================================================
   N. 骨架屏
   =================================================================== */
function skeletonCards(count, gridSelector) {
  const grid = document.querySelector(gridSelector);
  if (!grid) return;
  let html = "";
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-card">
        <div class="skeleton-line title w60"></div>
        <div class="skeleton-line w80"></div>
        <div class="skeleton-line w80"></div>
        <div class="skeleton-line w40"></div>
      </div>`;
  }
  grid.innerHTML = html;
}

/* ===================================================================
   O. 编辑器粘贴图片上传
   =================================================================== */
function initEditorPaste() {
  document.addEventListener("paste", async (e) => {
    const ta = e.target;
    if (!ta || !["TEXTAREA"].includes(ta.tagName)) return;
    // Only for markdown textareas (has placeholder with markdown hints or id containing 'content')
    if (!ta.placeholder || !ta.placeholder.includes("Markdown")) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        const start = ta.selectionStart;
        const placeholder = `![上传中...]()`;
        ta.value = ta.value.slice(0, start) + placeholder + ta.value.slice(ta.selectionEnd);
        ta.focus();
        try {
          const url = await uploadFile(file);
          ta.value = ta.value.replace(placeholder, `![](${url})`);
          showToast("图片已插入", "success");
        } catch (err) {
          ta.value = ta.value.replace(placeholder, "");
          showToast("图片上传失败: " + err.message);
        }
        break;
      }
    }
  });
}

// 页面加载时自动渲染公共导航 & 初始化回到顶部 & 编辑器粘贴
renderMainNav();
initBackToTop();
initEditorPaste();
