const API_BASE =
  window.location.protocol === "file:"
    ? "http://127.0.0.1:8000"
    : window.location.origin;

const USER_STORAGE_KEY = "blog_current_user";

let safeStorage = window.localStorage;

let personalPosts = [];

let currentUser = null;

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
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function updateAuthUI() {
  const userArea = document.querySelector("#auth-user-area");
  const guestArea = document.querySelector("#auth-guest-area");
  const welcomeEl = document.querySelector("#auth-welcome");
  const publishSection = document.querySelector("#publish-section");
  const loginPromptSection = document.querySelector("#login-prompt-section");

  if (isLoggedIn()) {
    userArea?.classList.remove("hidden");
    guestArea?.classList.add("hidden");
    publishSection?.classList.remove("hidden");
    loginPromptSection?.classList.add("hidden");
    if (welcomeEl) welcomeEl.textContent = `欢迎，${currentUser.username}`;
  } else {
    userArea?.classList.add("hidden");
    guestArea?.classList.remove("hidden");
    publishSection?.classList.add("hidden");
    loginPromptSection?.classList.remove("hidden");
  }

  loadPersonalPosts();
}

async function loadPersonalPosts() {
  try {
    const response = await fetch(`${API_BASE}/api/v1/personal`);
    const result = await response.json();
    if (result.code === 0) {
      personalPosts = result.data;
      renderPersonalList();
    }
  } catch (e) {
    console.error("加载个人内容失败:", e);
  }
}

function renderPersonalList() {
  const listContainer = document.querySelector("#personal-list");
  if (!listContainer) return;

  if (personalPosts.length === 0) {
    listContainer.innerHTML = `<div class="empty-posts">📝 博主还没有发布任何内容</div>`;
    return;
  }

  let html = "";
  for (const post of personalPosts) {
    const deleteBtnHtml = isLoggedIn()
      ? `<button class="delete-card-btn" data-id="${post.id}">🗑️ 删除</button>`
      : "";

    // 图片缩略图
    let imagesHtml = "";
    if (post.image_urls && post.image_urls.length > 0) {
      imagesHtml = '<div class="image-grid">';
      for (const imgUrl of post.image_urls) {
        imagesHtml += `<a href="${escapeHtml(imgUrl)}" target="_blank"><img src="${escapeHtml(imgUrl)}" class="post-thumb" alt="图片" /></a>`;
      }
      imagesHtml += "</div>";
    }

    // 文件下载链接
    let filesHtml = "";
    if (post.file_urls && post.file_urls.length > 0) {
      filesHtml = '<div class="file-list">';
      for (const fileUrl of post.file_urls) {
        const fileName = fileUrl.split("/").pop();
        filesHtml += `<a href="${escapeHtml(fileUrl)}" class="file-link" download>📎 ${escapeHtml(fileName)}</a>`;
      }
      filesHtml += "</div>";
    }

    html += `
      <article class="blog-card" data-id="${post.id}">
        <div class="card-meta">
          <span>📅 ${formatPostDate(post.created_at)}</span>
          <span>✍️ ${escapeHtml(post.author)}</span>
        </div>
        <div class="card-content">${escapeHtml(post.content).replace(/\n/g, "<br>")}</div>
        ${imagesHtml}
        ${filesHtml}
        <div class="card-footer">${deleteBtnHtml}</div>
      </article>
    `;
  }

  listContainer.innerHTML = html;
}

/* ========== 认证弹窗 ========== */

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
    if (el) {
      el.textContent = "";
      el.classList.add("hidden");
    }
  }
}

function showAuthError(formType, message) {
  const el = document.querySelector(`#${formType}-error`);
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
}

async function loginUser(username, password) {
  const response = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return response.json();
}

async function registerUser(username, password) {
  const response = await fetch(`${API_BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return response.json();
}

function initAuthInteractions() {
  document.querySelector("#login-open-btn")?.addEventListener("click", () => openAuthModal("login"));
  document.querySelector("#register-open-btn")?.addEventListener("click", () => openAuthModal("register"));
  document.querySelector("#login-prompt-btn")?.addEventListener("click", () => openAuthModal("login"));
  document.querySelector("#auth-modal-close")?.addEventListener("click", closeAuthModal);

  document.querySelector("#auth-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "auth-modal") closeAuthModal();
  });

  document.querySelector("#logout-btn")?.addEventListener("click", () => {
    clearUserSession();
    updateAuthUI();
  });

  document.querySelector("#auth-tab-login")?.addEventListener("click", () => switchAuthTab("login"));
  document.querySelector("#auth-tab-register")?.addEventListener("click", () => switchAuthTab("register"));

  document.querySelector("#login-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAuthErrors();
    const username = document.querySelector("#login-username").value.trim();
    const password = document.querySelector("#login-password").value;
    try {
      const result = await loginUser(username, password);
      if (result.code === 0) {
        saveUserSession(result.data);
        closeAuthModal();
        updateAuthUI();
      } else {
        showAuthError("login", result.msg);
      }
    } catch {
      showAuthError("login", "无法连接服务器，请确认后端已启动。");
    }
  });

  document.querySelector("#register-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAuthErrors();
    const username = document.querySelector("#register-username").value.trim();
    const password = document.querySelector("#register-password").value;
    try {
      const result = await registerUser(username, password);
      if (result.code === 0) {
        alert("注册成功，请登录。");
        switchAuthTab("login");
        document.querySelector("#login-username").value = username;
        document.querySelector("#register-form").reset();
      } else {
        showAuthError("register", result.msg);
      }
    } catch {
      showAuthError("register", "无法连接服务器，请确认后端已启动。");
    }
  });
}

/* ========== 文件上传 ========== */

async function uploadFile(file) {
  if (!isLoggedIn()) {
    throw new Error("请先登录");
  }
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE}/api/v1/upload?user_id=${currentUser.user_id}`, {
    method: "POST",
    body: formData,
  });
  const result = await response.json();
  // 处理 FastAPI 参数校验错误（如 user_id 不是整数）
  if (result.detail) {
    throw new Error(typeof result.detail === 'string' ? result.detail : JSON.stringify(result.detail));
  }
  if (result.code !== 0) {
    throw new Error(result.msg || '上传失败');
  }
  return result.data.url;
}

async function uploadAllFiles(files) {
  const urls = [];
  for (const file of files) {
    try {
      const url = await uploadFile(file);
      urls.push(url);
      console.log(`✓ ${file.name} 上传成功`);
    } catch (err) {
      console.error(`✗ ${file.name} 上传失败:`, err.message);
      alert(`上传 ${file.name} 失败: ${err.message}`);
    }
  }
  return urls;
}

/* ========== 发布与删除 ========== */

function initPersonalInteractions() {
  const themeBtn = document.querySelector("#theme-btn");
  if (safeStorage.getItem("dark_mode_active") === "true") {
    document.body.classList.add("dark-theme");
  }
  themeBtn?.addEventListener("click", () => {
    document.body.classList.toggle("dark-theme");
    safeStorage.setItem("dark_mode_active", document.body.classList.contains("dark-theme"));
  });

  // 发布表单
  document.querySelector("#personal-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isLoggedIn()) {
      alert("请先登录后再发布。");
      openAuthModal("login");
      return;
    }

    const contentValue = document.querySelector("#personal-content").value.trim();
    if (!contentValue) return;

    const imageInput = document.querySelector("#image-input");
    const fileInput = document.querySelector("#file-input");
    const imageFiles = imageInput?.files || [];
    const otherFiles = fileInput?.files || [];

    // 上传所有图片和文件
    const imageUrls = imageFiles.length > 0 ? await uploadAllFiles(imageFiles) : [];
    const fileUrls = otherFiles.length > 0 ? await uploadAllFiles(otherFiles) : [];

    try {
      const response = await fetch(`${API_BASE}/api/v1/personal?user_id=${currentUser.user_id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: contentValue,
          image_urls: imageUrls,
          file_urls: fileUrls,
        }),
      });
      const result = await response.json();
      if (result.code === 0) {
        e.target.reset();
        // 清空预览
        const imagePreview = document.querySelector("#image-preview");
        const filePreview = document.querySelector("#file-preview");
        if (imagePreview) imagePreview.innerHTML = "";
        if (filePreview) filePreview.innerHTML = "";
        await loadPersonalPosts();
      } else {
        alert(result.msg);
      }
    } catch {
      alert("无法连接服务器。");
    }
  });

  // 删除按钮
  document.querySelector("#personal-list")?.addEventListener("click", async (e) => {
    if (e.target.classList.contains("delete-card-btn")) {
      e.stopPropagation();
      if (!isLoggedIn()) {
        alert("请先登录后再删除。");
        openAuthModal("login");
        return;
      }
      const targetId = e.target.getAttribute("data-id");
      if (!confirm("确定要删除这条内容吗？")) return;

      try {
        const response = await fetch(
          `${API_BASE}/api/v1/personal/${targetId}?user_id=${currentUser.user_id}`,
          { method: "DELETE" },
        );
        const result = await response.json();
        if (result.code === 0) {
          await loadPersonalPosts();
        } else {
          alert(result.msg);
        }
      } catch {
        alert("网络错误，删除失败。");
      }
    }
  });
}

/* ========== 启动 ========== */
loadUserSession();
initAuthInteractions();
initPersonalInteractions();
updateAuthUI();
