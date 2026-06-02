const API_BASE = window.location.protocol === "file:"
  ? "http://127.0.0.1:8000"
  : window.location.origin;
const USER_STORAGE_KEY = "blog_current_user";

let safeStorage = window.localStorage;
let blogPosts = [];
let currentUser = null;

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
  const authorInput = document.querySelector("#post-author");

  if (isLoggedIn()) {
    userArea?.classList.remove("hidden");
    guestArea?.classList.add("hidden");
    publishSection?.classList.remove("hidden");
    loginPromptSection?.classList.add("hidden");
    if (welcomeEl) welcomeEl.textContent = `欢迎，${currentUser.username}`;
    if (authorInput) authorInput.value = currentUser.username;
  } else {
    userArea?.classList.add("hidden");
    guestArea?.classList.remove("hidden");
    publishSection?.classList.add("hidden");
    loginPromptSection?.classList.remove("hidden");
    if (authorInput) authorInput.value = "";
  }

  renderBlogGrid();
}

function openAuthModal(tab = "login") {
  const modal = document.querySelector("#auth-modal");
  modal?.classList.remove("hidden");
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
  const loginTab = document.querySelector("#auth-tab-login");
  const registerTab = document.querySelector("#auth-tab-register");
  const loginForm = document.querySelector("#login-form");
  const registerForm = document.querySelector("#register-form");

  const isLogin = tab === "login";
  loginTab?.classList.toggle("active", isLogin);
  registerTab?.classList.toggle("active", !isLogin);
  loginForm?.classList.toggle("hidden", !isLogin);
  registerForm?.classList.toggle("hidden", isLogin);
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

async function loadPostsFromServer() {
  try {
    const response = await fetch(`${API_BASE}/api/v1/posts`);
    const result = await response.json();
    if (result.code === 0) {
      blogPosts = result.data;
      renderBlogGrid();
    } else {
      alert("获取文章失败：" + result.msg);
    }
  } catch (e) {
    console.error("API connection failed:", e);
  }
}

// 动态渲染卡片列表
function renderBlogGrid() {
  const gridContainer = document.querySelector("#blog-grid");
  if (!gridContainer) return;

  if (blogPosts.length === 0) {
    gridContainer.innerHTML = `<div class="empty-posts">📭 暂无文章</div>`;
    return;
  }

  let snowballHtml = "";
  for (const post of blogPosts) {
    const deleteBtnHtml = isLoggedIn()
      ? `<button class="delete-card-btn" data-id="${post.id}">🗑️ 删除博文</button>`
      : "";

    snowballHtml += `
            <article class="blog-card" data-id="${post.id}">
                <h2>${post.title}</h2>
                <div class="card-meta">
                    <span>📅 时间: ${formatPostDate(post.created_at)}</span>
                    <span>✍️ 作者: ${post.author}</span>
                </div>
                <p class="card-content">${post.content}</p>
                ${deleteBtnHtml}
            </article>
        `;
  }
  gridContainer.innerHTML = snowballHtml;
}

function initAuthInteractions() {
  document
    .querySelector("#login-open-btn")
    ?.addEventListener("click", () => openAuthModal("login"));
  document
    .querySelector("#register-open-btn")
    ?.addEventListener("click", () => openAuthModal("register"));
  document
    .querySelector("#login-prompt-btn")
    ?.addEventListener("click", () => openAuthModal("login"));
  document
    .querySelector("#auth-modal-close")
    ?.addEventListener("click", closeAuthModal);
  document.querySelector("#auth-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "auth-modal") closeAuthModal();
  });
  document
    .querySelector("#logout-btn")
    ?.addEventListener("click", () => {
      clearUserSession();
      updateAuthUI();
    });

  document.querySelector("#auth-tab-login")?.addEventListener("click", () => {
    switchAuthTab("login");
  });
  document.querySelector("#auth-tab-register")?.addEventListener("click", () => {
    switchAuthTab("register");
  });

  const loginForm = document.querySelector("#login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
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
  }

  const registerForm = document.querySelector("#register-form");
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
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
          registerForm.reset();
        } else {
          showAuthError("register", result.msg);
        }
      } catch {
        showAuthError("register", "无法连接服务器，请确认后端已启动。");
      }
    });
  }
}

function initInteractions() {
  const themeBtn = document.querySelector("#theme-btn");
  if (safeStorage.getItem("dark_mode_active") === "true") {
    document.body.classList.add("dark-theme");
  }
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      document.body.classList.toggle("dark-theme");
      safeStorage.setItem(
        "dark_mode_active",
        document.body.classList.contains("dark-theme"),
      );
    });
  }

  const gridContainer = document.querySelector("#blog-grid");
  if (gridContainer) {
    gridContainer.addEventListener("click", async (e) => {
      if (e.target.classList.contains("delete-card-btn")) {
        e.stopPropagation();
        if (!isLoggedIn()) {
          alert("请先登录后再删除文章。");
          openAuthModal("login");
          return;
        }

        const targetId = e.target.getAttribute("data-id");
        if (!confirm("确定要永久删除这篇文章吗？")) return;

        try {
          const response = await fetch(`${API_BASE}/api/v1/posts/${targetId}`, {
            method: "DELETE",
          });
          const result = await response.json();
          if (result.code === 0) {
            await loadPostsFromServer();
          } else {
            alert("删除失败：" + result.msg);
          }
        } catch {
          alert("网络错误，删除失败。");
        }
        return;
      }

      const clickedCard = e.target.closest(".blog-card");
      if (clickedCard) {
        const postId = parseInt(clickedCard.getAttribute("data-id"), 10);
        const matchedPost = blogPosts.find((p) => p.id === postId);
        if (matchedPost) openDetailModal(matchedPost);
      }
    });
  }

  const postForm = document.querySelector("#post-form");
  if (postForm) {
    postForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (!isLoggedIn()) {
        alert("请先登录后再发布文章。");
        openAuthModal("login");
        return;
      }

      const titleValue = document.querySelector("#post-title").value.trim();
      const authorValue = currentUser.username;
      const contentValue = document.querySelector("#post-content").value.trim();

      try {
        const response = await fetch(`${API_BASE}/api/v1/posts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: titleValue,
            author: authorValue,
            content: contentValue,
          }),
        });
        const result = await response.json();
        if (result.code === 0) {
          await loadPostsFromServer();
          postForm.reset();
          document.querySelector("#post-author").value = currentUser.username;
        } else {
          alert("发布失败：" + result.msg);
        }
      } catch {
        alert("无法连接服务器。");
      }
    });
  }
}

function openDetailModal(post) {
  const modalOverlay = document.createElement("div");
  modalOverlay.className = "custom-modal-overlay";

  modalOverlay.innerHTML = `
        <div class="custom-modal-content">
            <span class="custom-modal-close">×</span>
            <h1 class="modal-title">${post.title}</h1>
            <div class="modal-meta">📅 ${formatPostDate(post.created_at)}  |  ✍️ 作者: ${post.author}  |  🛡️ ID: ${post.id}</div>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
            <div class="modal-body-text">${post.content.replace(/\n/g, "<br>")}</div>
        </div>
    `;

  document.body.appendChild(modalOverlay);

  const closeBtn = modalOverlay.querySelector(".custom-modal-close");
  closeBtn.addEventListener("click", () => modalOverlay.remove());
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) modalOverlay.remove();
  });
}

loadUserSession();
loadPostsFromServer();
initAuthInteractions();
initInteractions();
updateAuthUI();
