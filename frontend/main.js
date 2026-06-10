const API_BASE =
  window.location.protocol === "file:"
    ? "http://127.0.0.1:8000"
    : window.location.origin;

const USER_STORAGE_KEY = "blog_token";

const HOT_LIKE_THRESHOLD = 1;

let safeStorage = window.localStorage;

let blogPosts = [];

let currentUser = null;

let ownerUsername = "";

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")

    .replace(/</g, "&lt;")

    .replace(/>/g, "&gt;")

    .replace(/"/g, "&quot;")

    .replace(/'/g, "&#39;");
}

// ========== Markdown + LaTeX 渲染引擎 ==========
function renderMarkdown(text) {
  if (!text) return "";

  // Step 1: 保护代码块中的 $ 符号，避免被 LaTeX 正则误匹配
  const codeBlocks = [];
  let processed = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `@@CODEBLOCK${codeBlocks.length - 1}@@`;
  });

  // 保护行内代码 `...`
  processed = processed.replace(/`([^`]+)`/g, (match) => {
    codeBlocks.push(match);
    return `@@CODEBLOCK${codeBlocks.length - 1}@@`;
  });

  // Step 2: 保护块级 LaTeX $$...$$
  const latexItems = [];
  processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (match, formula) => {
    latexItems.push({ type: "block", formula: formula.trim() });
    return `@@LATEX${latexItems.length - 1}@@`;
  });

  // Step 3: 保护行内 LaTeX $...$ （不匹配 $$ 和 \$）
  processed = processed.replace(/(?<!\$)\$(?!\$)(.*?)(?<!\$)\$(?!\$)/g, (match, formula) => {
    latexItems.push({ type: "inline", formula: formula.trim() });
    return `@@LATEX${latexItems.length - 1}@@`;
  });

  // Step 4: Markdown → HTML
  marked.setOptions({ breaks: true, gfm: true });
  let html = marked.parse(processed);

  // Step 5: 还原 LaTeX
  latexItems.forEach((item, i) => {
    const placeholder = `@@LATEX${i}@@`;
    try {
      const rendered = katex.renderToString(item.formula, {
        displayMode: item.type === "block",
        throwOnError: false,
      });
      html = html.replace(placeholder, rendered);
    } catch (e) {
      html = html.replace(placeholder, escapeHtml(item.formula));
    }
  });

  // Step 6: 还原代码块
  html = html.replace(/<p>@@CODEBLOCK(\d+)@@<\/p>/g, "@@CODEBLOCK$1@@");
  codeBlocks.forEach((code, i) => {
    const placeholder = `@@CODEBLOCK${i}@@`;
    const escaped = code
      .replace(/^```(\w*)\n?/, "")
      .replace(/```$/, "")
      .trim();
    const lang = code.match(/^```(\w*)/)?.[1] || "";
    const langLabel = lang ? `<span class="code-lang">${lang}</span>` : "";
    html = html.replace(
      placeholder,
      `<pre>${langLabel}<code>${escapeHtml(escaped)}</code></pre>`
    );
  });

  return html;
}

// 提取纯文本摘要（用于卡片预览）
function plainTextSummary(markdown, maxLen) {
  maxLen = maxLen || 200;
  // 先渲染为 HTML，再去除标签得到纯文本
  const div = document.createElement("div");
  div.innerHTML = renderMarkdown(markdown);
  const plain = div.textContent || div.innerText || "";
  return plain.length > maxLen ? plain.slice(0, maxLen) + "..." : plain;
}

function loadUserSession() {
  try {
    const raw = safeStorage.getItem(USER_STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      currentUser = {
        token: data.token,
        user_id: data.user_id,
        username: data.username,
      };
    }
  } catch {
    currentUser = null;
  }
}

function saveUserSession(user) {
  currentUser = {
    token: user.token,
    user_id: user.user_id,
    username: user.username,
  };
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

function canDeletePost(post) {
  if (!isLoggedIn()) return false;
  // 博主可以删除所有文章
  if (isOwner()) return true;
  // 作者可以删除自己的文章
  return currentUser.username === post.author;
}

function postsQueryParam(extraParams = "") {
  // JWT: user_id no longer needed in URL - token is in headers
  return extraParams ? `?${extraParams}` : "";
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

function updatePostInList(postId, updates) {
  const index = blogPosts.findIndex((p) => p.id === postId);

  if (index === -1) return;

  blogPosts[index] = { ...blogPosts[index], ...updates };
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

  loadPostsFromServer();
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

  document
    .querySelector("#auth-tab-login")
    ?.classList.toggle("active", isLogin);

  document
    .querySelector("#auth-tab-register")
    ?.classList.toggle("active", !isLogin);

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

async function loadPostsFromServer(searchTerm = "") {
  try {
    const trimmed = searchTerm.trim();
    const params = trimmed ? `search=${encodeURIComponent(trimmed)}` : "";
    const response = await fetch(
      `${API_BASE}/api/v1/posts${postsQueryParam(params)}`,
      { headers: getAuthHeaders() },
    );

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

async function fetchPostDetail(postId) {
  const response = await fetch(
    `${API_BASE}/api/v1/posts/${postId}${postsQueryParam()}`,
    { headers: getAuthHeaders() },
  );

  const result = await response.json();

  if (result.code !== 0) throw new Error(result.msg);

  return result.data;
}

async function fetchPostComments(postId) {
  const response = await fetch(`${API_BASE}/api/v1/posts/${postId}/comments`);

  const result = await response.json();

  if (result.code !== 0) throw new Error(result.msg);

  return result.data;
}

function renderBlogGrid() {
  const gridContainer = document.querySelector("#blog-grid");

  if (!gridContainer) return;

  if (blogPosts.length === 0) {
    gridContainer.innerHTML = `<div class="empty-posts">📭 暂无文章</div>`;

    return;
  }

  let snowballHtml = "";

  for (const post of blogPosts) {
    const hotBadge = post.is_hot ? `<span class="hot-badge">HOT</span>` : "";

    const deleteBtnHtml = canDeletePost(post)
      ? `<button class="delete-card-btn" data-id="${post.id}">🗑️ 删除博文</button>`
      : "";

    snowballHtml += `

      <article class="blog-card" data-id="${post.id}">

        ${hotBadge}

        <h2>${escapeHtml(post.title)}</h2>

        <div class="card-meta">

          <span>📅 ${formatPostDate(post.created_at)}</span>

          <span>✍️ ${escapeHtml(post.author)}</span>

          <span>👍 ${post.like_count || 0}</span>

          <span>💬 ${post.comment_count || 0}</span>

        </div>

        <div class="card-preview-area">
          <p class="card-content card-content-preview">${escapeHtml(plainTextSummary(post.content))}</p>
          <span class="read-more-hint">点击查看全文 →</span>
        </div>
        <div class="card-footer">
          ${deleteBtnHtml}
        </div>

      </article>

    `;
  }

  gridContainer.innerHTML = snowballHtml;
}

function renderCommentsList(comments) {
  if (!comments.length) {
    return `<p class="comments-empty">暂无评论，来抢沙发吧～</p>`;
  }

  return comments

    .map(
      (comment) => `

      <div class="comment-item">

        <div class="comment-meta">

          <strong>${escapeHtml(comment.author)}</strong>

          <span>${formatPostDate(comment.created_at)}</span>

        </div>

        <p class="comment-text markdown-body">${renderMarkdown(comment.content)}</p>

      </div>

    `,
    )

    .join("");
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

  document.querySelector("#logout-btn")?.addEventListener("click", () => {
    clearUserSession();

    updateAuthUI();
  });

  document.querySelector("#auth-tab-login")?.addEventListener("click", () => {
    switchAuthTab("login");
  });

  document
    .querySelector("#auth-tab-register")
    ?.addEventListener("click", () => {
      switchAuthTab("register");
    });

  document
    .querySelector("#login-form")
    ?.addEventListener("submit", async (e) => {
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

  document
    .querySelector("#register-form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();

      clearAuthErrors();

      const username = document
        .querySelector("#register-username")
        .value.trim();

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

function initInteractions() {
  const themeBtn = document.querySelector("#theme-btn");

  if (safeStorage.getItem("dark_mode_active") === "true") {
    document.body.classList.add("dark-theme");
  }

  themeBtn?.addEventListener("click", () => {
    document.body.classList.toggle("dark-theme");

    safeStorage.setItem(
      "dark_mode_active",

      document.body.classList.contains("dark-theme"),
    );
  });

  document.querySelector("#blog-grid")?.addEventListener("click", async (e) => {
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
        const response = await fetch(
          `${API_BASE}/api/v1/posts/${targetId}`,
          { method: "DELETE", headers: getAuthHeaders() },
        );

        const result = await response.json();

        if (result.code === 0) await loadPostsFromServer();
        else alert("删除失败：" + result.msg);
      } catch {
        alert("网络错误，删除失败。");
      }

      return;
    }

    const clickedCard = e.target.closest(".blog-card");

    if (clickedCard) {
      const postId = parseInt(clickedCard.getAttribute("data-id"), 10);

      await openDetailModal(postId);
    }
  });

  document
    .querySelector("#post-form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();

      if (!isLoggedIn()) {
        alert("请先登录后再发布文章。");

        openAuthModal("login");

        return;
      }

      const titleValue = document.querySelector("#post-title").value.trim();

      const contentValue = document.querySelector("#post-content").value.trim();

      try {
        const response = await fetch(`${API_BASE}/api/v1/posts`, {
          method: "POST",

          headers: { "Content-Type": "application/json" },

          body: JSON.stringify({
            title: titleValue,

            author: currentUser.username,

            content: contentValue,
          }),
        });

        const result = await response.json();

        if (result.code === 0) {
          await loadPostsFromServer();

          e.target.reset();

          document.querySelector("#post-author").value = currentUser.username;
        } else {
          alert("发布失败：" + result.msg);
        }
      } catch {
        alert("无法连接服务器。");
      }
    });

  // 搜索功能事件绑定
  const searchInput = document.querySelector("#search-input");
  const searchBtn = document.querySelector("#search-btn");
  let isSearchActive = false;

  function executeSearch() {
    isSearchActive = true;
    loadPostsFromServer(searchInput.value);
  }

  searchBtn?.addEventListener("click", executeSearch);

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      executeSearch();
    }
  });

  // 输入框清空时自动恢复全部文章列表（仅在之前有搜索时才触发，避免无意义请求）
  searchInput?.addEventListener("input", () => {
    if (!searchInput.value.trim() && isSearchActive) {
      isSearchActive = false;
      loadPostsFromServer();
    }
  });

  // ========== Markdown 工具栏 ==========
  const textarea = document.querySelector("#post-content");
  if (textarea) {
    document.querySelectorAll(".md-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const marker = btn.getAttribute("data-md");
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selected = textarea.value.substring(start, end);

        let replacement = "";
        let cursorOffset = 0;

        if (marker === "```") {
          replacement = `\n\`\`\`\n${selected || "code"}\n\`\`\`\n`;
        } else if (marker === "$$\n\n$$") {
          replacement = `\n\$\$\n${selected || "f(x)"}\n\$\$\n`;
        } else if (marker === "[text](url)") {
          replacement = `[${selected || "text"}](url)`;
        } else if (marker === "**" || marker === "*" || marker === "`" || marker === "$ ") {
          replacement = `${marker}${selected || marker}${marker}`;
          cursorOffset = marker.length;
        } else {
          replacement = `${marker}${selected || ""}`;
        }

        textarea.focus();
        document.execCommand("insertText", false, replacement);

        // 调整光标位置到替换文本中间（内联标记放在标记之间）
        const newPos = start + replacement.length;
        if (cursorOffset && !selected) {
          textarea.setSelectionRange(start + cursorOffset, newPos - cursorOffset);
        }
      });
    });

    // Ctrl+B 加粗, Ctrl+I 斜体 快捷键
    textarea.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        document.querySelector('.md-btn[data-md="**"]')?.click();
      }
      if (e.ctrlKey && e.key === "i") {
        e.preventDefault();
        document.querySelector('.md-btn[data-md="*"]')?.click();
      }
    });
  }
}

async function openDetailModal(postId) {
  let post;

  let comments;

  try {
    post = await fetchPostDetail(postId);

    comments = await fetchPostComments(postId);

    updatePostInList(postId, post);

    renderBlogGrid();
  } catch {
    alert("加载文章详情失败。");

    return;
  }

  const modalOverlay = document.createElement("div");

  modalOverlay.className = "custom-modal-overlay";

  modalOverlay.innerHTML = `

    <div class="custom-modal-content">

      <span class="custom-modal-close">×</span>

      ${post.is_hot ? '<span class="hot-badge modal-hot-badge">HOT</span>' : ""}

      <h1 class="modal-title">${escapeHtml(post.title)}</h1>

      <div class="modal-meta">

        📅 ${formatPostDate(post.created_at)}

        | ✍️ ${escapeHtml(post.author)}

        | 👍 <span id="modal-like-count">${post.like_count || 0}</span>

        | 💬 <span id="modal-comment-count">${post.comment_count || 0}</span>

      </div>

      <div class="modal-actions">

        <button id="modal-like-btn" class="like-btn ${post.liked ? "liked" : ""}" type="button">

          ${post.liked ? "❤️ 已点赞" : "🤍 点赞"}

        </button>

      </div>

      <hr class="modal-divider">

      <div class="modal-body-text markdown-body">${renderMarkdown(post.content)}</div>

      <section class="comments-section">

        <h3 class="comments-title">评论 (${comments.length})</h3>

        <div id="comments-list" class="comments-list">${renderCommentsList(comments)}</div>

        <form id="comment-form" class="comment-form">

          <textarea

            id="comment-input"

            class="form-input form-textarea"

            placeholder="${isLoggedIn() ? "写下你的评论..." : "登录后可评论"}"

            rows="3"

            ${isLoggedIn() ? "" : "disabled"}

          ></textarea>

          <button type="submit" class="toggle-btn comment-submit-btn" ${isLoggedIn() ? "" : "disabled"}>

            发表评论

          </button>

        </form>

      </section>

    </div>

  `;

  document.body.appendChild(modalOverlay);

  const closeModal = () => modalOverlay.remove();

  modalOverlay
    .querySelector(".custom-modal-close")
    .addEventListener("click", closeModal);

  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  const likeBtn = modalOverlay.querySelector("#modal-like-btn");

  likeBtn.addEventListener("click", async () => {
    if (!isLoggedIn()) {
      alert("请先登录后再点赞。");

      openAuthModal("login");

      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/v1/posts/${postId}/like`, {
        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ user_id: currentUser.user_id }),
      });

      const result = await response.json();

      if (result.code !== 0) {
        alert(result.msg);

        return;
      }

      const { like_count, liked, is_hot } = result.data;

      modalOverlay.querySelector("#modal-like-count").textContent = like_count;

      likeBtn.classList.toggle("liked", liked);

      likeBtn.textContent = liked ? "❤️ 已点赞" : "🤍 点赞";

      updatePostInList(postId, {
        like_count,

        liked,

        is_hot,
      });

      renderBlogGrid();
    } catch {
      alert("点赞失败，请稍后重试。");
    }
  });

  modalOverlay
    .querySelector("#comment-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();

      if (!isLoggedIn()) {
        alert("请先登录后再评论。");

        openAuthModal("login");

        return;
      }

      const input = modalOverlay.querySelector("#comment-input");

      const content = input.value.trim();

      if (!content) return;

      try {
        const response = await fetch(
          `${API_BASE}/api/v1/posts/${postId}/comments`,
          {
            method: "POST",

            headers: { "Content-Type": "application/json" },

            body: JSON.stringify({ user_id: currentUser.user_id, content }),
          },
        );

        const result = await response.json();

        if (result.code !== 0) {
          alert(result.msg);

          return;
        }

        comments.push(result.data);

        modalOverlay.querySelector("#comments-list").innerHTML =
          renderCommentsList(comments);

        modalOverlay.querySelector("#modal-comment-count").textContent =
          comments.length;

        modalOverlay.querySelector(".comments-title").textContent =
          `评论 (${comments.length})`;

        input.value = "";

        updatePostInList(postId, { comment_count: comments.length });

        renderBlogGrid();
      } catch {
        alert("评论失败，请稍后重试。");
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
  initInteractions();
  await loadSiteConfig();
  updateAuthUI();
}

init();
