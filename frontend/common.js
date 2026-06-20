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
let safeStorage = window.localStorage;
let currentUser = null;
let ownerUsername = "";

/* ===================================================================
   B. HTML / 日期 工具函数
   =================================================================== */
function escapeHtml(text) {
  if (!text) return "";
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
function loadUserSession() {
  try {
    const raw = safeStorage.getItem(USER_STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && data.token) {
        currentUser = { token: data.token, user_id: data.user_id, username: data.username };
      }
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
  return currentUser && typeof currentUser.token === "string" && currentUser.token.length > 0;
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
  try {
    const resp = await fetch(`${API_BASE}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const result = await resp.json();
    if (result.code === 0) {
      saveUserSession(result.data);
      updateAuthUI();
      closeAuthModal();
    } else {
      showAuthError("login", result.msg || "登录失败");
    }
  } catch {
    showAuthError("login", "网络请求失败");
  }
}

async function registerUser(username, password) {
  try {
    const resp = await fetch(`${API_BASE}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const result = await resp.json();
    if (result.code === 0) {
      openAuthModal("login");
    } else {
      showAuthError("register", result.msg || "注册失败");
    }
  } catch {
    showAuthError("register", "网络请求失败");
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
}

async function loadSiteConfig() {
  try {
    const resp = await fetch(`${API_BASE}/api/v1/site-config`);
    const result = await resp.json();
    if (result.code === 0 && result.data) ownerUsername = result.data.owner_username || "";
  } catch { /* non-critical */ }
}

/* ===================================================================
   G. 暗色主题
   =================================================================== */
function initThemeToggle() {
  const btn = document.querySelector("#theme-btn");
  if (safeStorage.getItem("dark_mode_active") === "true") {
    document.body.classList.add("dark-theme");
  }
  btn?.addEventListener("click", () => {
    document.body.classList.toggle("dark-theme");
    safeStorage.setItem("dark_mode_active", document.body.classList.contains("dark-theme"));
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
async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  const r = await fetch(`${API_BASE}/api/v1/upload`, {
    method: "POST",
    headers: { "Authorization": "Bearer " + currentUser.token },
    body: formData,
  });
  const result = await r.json();
  if (result.code !== 0) throw new Error(result.msg || "上传失败");
  return result.data.url;
}

/* ===================================================================
   J. Markdown 渲染（博客 / 个人主页共用）
   =================================================================== */
function renderMarkdown(text) {
  if (!text) return "";
  if (typeof marked === "undefined") return escapeHtml(text);
  const codeBlocks = [];
  let processed = text.replace(/```[\s\S]*?```/g, (m) => { codeBlocks.push(m); return `@@CB${codeBlocks.length - 1}@@`; });
  processed = processed.replace(/`([^`]+)`/g, (m) => { codeBlocks.push(m); return `@@CB${codeBlocks.length - 1}@@`; });
  const latexItems = [];
  processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (m, f) => { latexItems.push({ t: "block", f: f.trim() }); return `@@LX${latexItems.length - 1}@@`; });
  processed = processed.replace(/(?<!\$)\$(?!\$)(.*?)(?<!\$)\$(?!\$)/g, (m, f) => { latexItems.push({ t: "inline", f: f.trim() }); return `@@LX${latexItems.length - 1}@@`; });
  marked.setOptions({ breaks: true, gfm: true });
  let html = marked.parse(processed);
  latexItems.forEach((item, i) => {
    const ph = `@@LX${i}@@`;
    try {
      html = html.replace(ph, katex.renderToString(item.f, { displayMode: item.t === "block", throwOnError: false }));
    } catch { html = html.replace(ph, escapeHtml(item.f)); }
  });
  html = html.replace(/<p>@@CB(\d+)@@<\/p>/g, "@@CB$1@@");
  codeBlocks.forEach((code, i) => {
    const ph = `@@CB${i}@@`;
    const inner = code.replace(/^```\w*\n?/, "").replace(/```$/, "").trim();
    const lang = (code.match(/^```(\w*)/) || [])[1] || "";
    const label = lang ? `<span class="code-lang">${lang}</span>` : "";
    html = html.replace(ph, `<pre>${label}<code>${escapeHtml(inner)}</code></pre>`);
  });
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
