/**
 * 中药识别页面 - 前端逻辑
 * 支持：图片上传预览、AI 识别、结果展示、登录/注册、暗色主题
 */
const API_BASE =
  window.location.protocol === "file:"
    ? "http://127.0.0.1:8000"
    : window.location.origin;

const USER_STORAGE_KEY = "blog_token";
let safeStorage = window.localStorage;
let currentUser = null;
let ownerUsername = "";

/* ===================================================================
   工具函数
   =================================================================== */
function escapeHtml(text) {
  if (!text) return "";
  text = String(text);
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPostDate(dateStr) {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("zh-CN", {
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
   用户会话管理
   =================================================================== */
function loadUserSession() {
  try {
    const serialized = safeStorage.getItem(USER_STORAGE_KEY);
    if (serialized) {
      const parsed = JSON.parse(serialized);
      if (parsed && parsed.token) {
        currentUser = parsed;
      } else {
        currentUser = null;
      }
    }
  } catch (e) {
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
  return (
    currentUser !== null &&
    currentUser !== undefined &&
    typeof currentUser.token === "string" &&
    currentUser.token.length > 0
  );
}

function getAuthHeaders() {
  if (isLoggedIn() && currentUser.token) {
    return {
      Authorization: "Bearer " + currentUser.token,
      "Content-Type": "application/json",
    };
  }
  return { "Content-Type": "application/json" };
}

/* ===================================================================
   认证 UI
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
  const loginErr = document.querySelector("#login-error");
  const registerErr = document.querySelector("#register-error");
  if (loginErr) {
    loginErr.classList.add("hidden");
    loginErr.textContent = "";
  }
  if (registerErr) {
    registerErr.classList.add("hidden");
    registerErr.textContent = "";
  }
}

function showAuthError(formType, message) {
  const el = document.querySelector(
    formType === "login" ? "#login-error" : "#register-error"
  );
  if (el) {
    el.textContent = message;
    el.classList.remove("hidden");
  }
}

async function loginUser(username, password) {
  try {
    const resp = await fetch(`${API_BASE}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const result = await resp.json();
    if (result.code === 0) {
      saveUserSession({
        token: result.data.token,
        userId: result.data.user_id,
        username: result.data.username,
      });
      updateAuthUI();
      closeAuthModal();
    } else {
      showAuthError("login", result.msg || "登录失败");
    }
  } catch (e) {
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
  } catch (e) {
    showAuthError("register", "网络请求失败");
  }
}

function updateAuthUI() {
  const userArea = document.querySelector("#auth-user-area");
  const guestArea = document.querySelector("#auth-guest-area");
  const welcome = document.querySelector("#auth-welcome");

  if (isLoggedIn()) {
    userArea?.classList.remove("hidden");
    guestArea?.classList.add("hidden");
    if (welcome && currentUser.username) {
      welcome.textContent = "👋 " + currentUser.username;
    }
  } else {
    userArea?.classList.add("hidden");
    guestArea?.classList.remove("hidden");
  }
}

async function loadSiteConfig() {
  try {
    const resp = await fetch(`${API_BASE}/api/v1/site-config`);
    const result = await resp.json();
    if (result.code === 0 && result.data) {
      ownerUsername = result.data.owner_username || "";
    }
  } catch (e) {
    /* ignore - not critical for herb page */
  }
}

function initAuthInteractions() {
  document.querySelector("#login-open-btn")?.addEventListener("click", () =>
    openAuthModal("login")
  );
  document
    .querySelector("#register-open-btn")
    ?.addEventListener("click", () => openAuthModal("register"));
  document
    .querySelector("#auth-modal-close")
    ?.addEventListener("click", closeAuthModal);
  document.querySelector("#auth-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "auth-modal") closeAuthModal();
  });
  document.querySelector("#auth-tab-login")?.addEventListener("click", () =>
    switchAuthTab("login")
  );
  document
    .querySelector("#auth-tab-register")
    ?.addEventListener("click", () => switchAuthTab("register"));
  document.querySelector("#logout-btn")?.addEventListener("click", () => {
    clearUserSession();
    updateAuthUI();
  });

  document.querySelector("#login-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const username = document.querySelector("#login-username").value.trim();
    const password = document.querySelector("#login-password").value;
    loginUser(username, password);
  });

  document.querySelector("#register-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const username = document.querySelector("#register-username").value.trim();
    const password = document.querySelector("#register-password").value;
    registerUser(username, password);
  });
}

/* ===================================================================
   暗色主题切换
   =================================================================== */
function initThemeToggle() {
  const themeBtn = document.querySelector("#theme-btn");
  if (safeStorage.getItem("dark_mode_active") === "true") {
    document.body.classList.add("dark-theme");
  }
  themeBtn?.addEventListener("click", () => {
    document.body.classList.toggle("dark-theme");
    safeStorage.setItem(
      "dark_mode_active",
      document.body.classList.contains("dark-theme")
    );
  });
}

/* ===================================================================
   中药识别核心逻辑
   =================================================================== */

/** 20 种中药硬编码列表（作为 fallback） */
const HERB_CLASSES = [
  "僵蚕", "党参", "天南星", "枸杞", "槐花", "牛蒡子", "牡丹皮",
  "猪苓", "甘草", "百合", "百部", "竹叶", "竹茹", "紫草",
  "红藤", "艾叶", "荆芥", "金银花", "黄柏", "黄芪",
];

async function loadHerbClasses() {
  try {
    const resp = await fetch(`${API_BASE}/api/v1/herb/classes`);
    const result = await resp.json();
    if (result.code === 0 && Array.isArray(result.data)) {
      return result.data;
    }
  } catch (e) {
    /* fallback to hardcoded list */
  }
  return HERB_CLASSES;
}

async function renderClassGrid() {
  const classes = await loadHerbClasses();
  const grid = document.querySelector("#class-grid");
  if (!grid) return;
  grid.innerHTML = classes
    .map((name) => `<span class="herb-class-tag">${escapeHtml(name)}</span>`)
    .join("");
}

function initFilePreview() {
  const fileInput = document.querySelector("#herb-file");
  const dropZone = document.querySelector("#herb-drop-zone");
  const placeholder = document.querySelector("#herb-drop-placeholder");
  const previewImg = document.querySelector("#preview-img");

  if (!dropZone || !fileInput) return;

  // 点击 drop zone 触发文件选择
  dropZone.addEventListener("click", () => fileInput.click());

  // 文件选择变化
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) showPreview(file, placeholder, previewImg);
  });

  // 拖入
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add("drag-over");
  });

  // 拖出
  dropZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 只在真正离开 drop zone 时移除样式
    if (!dropZone.contains(e.relatedTarget)) {
      dropZone.classList.remove("drag-over");
    }
  });

  // 放下
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("drag-over");

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      // 同步到 file input
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      showPreview(file, placeholder, previewImg);
    }
  });

  // 阻止页面级别拖放导致的浏览器跳转
  document.addEventListener("dragover", (e) => {
    if (!dropZone.contains(e.target)) e.preventDefault();
  });
  document.addEventListener("drop", (e) => {
    if (!dropZone.contains(e.target)) e.preventDefault();
  });
}

function showPreview(file, placeholder, previewImg) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    if (previewImg) {
      previewImg.src = e.target.result;
      previewImg.classList.remove("hidden");
    }
    if (placeholder) placeholder.classList.add("hidden");
  };
  reader.readAsDataURL(file);
}

async function handlePredict() {
  const fileInput = document.querySelector("#herb-file");
  const file = fileInput?.files[0];
  const loadingArea = document.querySelector("#loading-area");
  const resultSection = document.querySelector("#result-section");

  if (!file) {
    alert("请先选择一张中药图片");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert("图片大小不能超过 10MB");
    return;
  }

  // 显示加载状态
  loadingArea?.classList.remove("hidden");
  resultSection?.classList.add("hidden");

  const modelSelect = document.querySelector("#herb-model");
  const modelName = modelSelect?.value || "MobileNetV3-Large";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", modelName);

  try {
    const resp = await fetch(`${API_BASE}/api/v1/herb/predict`, {
      method: "POST",
      body: formData,
    });
    const result = await resp.json();
    loadingArea?.classList.add("hidden");

    if (result.code === 0) {
      renderResult(result.data);
      resultSection?.classList.remove("hidden");
    } else {
      alert("识别失败：" + (result.msg || "未知错误"));
    }
  } catch (e) {
    loadingArea?.classList.add("hidden");
    alert("网络请求失败：" + e.message);
  }
}

function renderResult(data) {
  const container = document.querySelector("#result-content");
  if (!container) return;

  const { prediction, confidence, top3, model_used } = data;

  const rankEmoji = ["🥇", "🥈", "🥉"];
  const barColors = ["#16a34a", "#2563eb", "#9333ea"];

  // 主要预测
  let html = `
    <div class="herb-result-primary">
      <div class="herb-name">🔮 ${escapeHtml(prediction)}</div>
      <div class="herb-confidence">置信度：${confidence}% · 模型：${escapeHtml(model_used || "")}</div>
      <div class="herb-confidence-bar">
        <div class="herb-confidence-fill" style="width:${confidence}%"></div>
      </div>
    </div>
  `;

  // Top-3 列表
  if (top3 && top3.length > 0) {
    html += '<ul class="herb-top3-list">';
    for (let i = 0; i < top3.length; i++) {
      const item = top3[i];
      html += `
        <li class="herb-top3-item">
          <span class="herb-top3-rank">${rankEmoji[item.rank - 1] || ""}</span>
          <span class="herb-top3-name">${escapeHtml(item.class)}</span>
          <span class="herb-top3-bar-wrap">
            <span class="herb-top3-bar">
              <span class="herb-top3-fill" style="width:${item.confidence}%; background:${barColors[item.rank - 1] || barColors[0]};"></span>
            </span>
            <span class="herb-top3-percent">${item.confidence}%</span>
          </span>
        </li>`;
    }
    html += "</ul>";
  }

  container.innerHTML = html;
}

/* ===================================================================
   页面初始化
   =================================================================== */
async function init() {
  loadUserSession();
  initAuthInteractions();
  initThemeToggle();
  await loadSiteConfig();
  updateAuthUI();

  initFilePreview();

  document
    .querySelector("#predict-btn")
    ?.addEventListener("click", handlePredict);

  await renderClassGrid();
}

init();
