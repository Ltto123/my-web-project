/**
 * main.js — 博客首页
 * 依赖 common.js：常量、工具函数、认证、主题、上传
 */

const HOT_LIKE_THRESHOLD = 1;
let blogPosts = [];

/* ===================================================================
   页面特有：博客列表 / 详情 / 评论 / 点赞 / 删除 / 发布 / 搜索
   =================================================================== */

function canDeletePost(post) {
  if (!isLoggedIn()) return false;
  if (isOwner()) return true;
  return currentUser.username === post.author;
}

function postsQueryParam() {
  const params = new URLSearchParams(window.location.search);
  params.delete("post");
  return params.toString() ? `?${params.toString()}` : "";
}

/* ---------- API ---------- */
async function loadPostsFromServer(search) {
  try {
    let url = `${API_BASE}/api/v1/posts`;
    if (search) url += `?search=${encodeURIComponent(search)}`;
    const response = await fetch(url, { headers: getAuthHeaders() });
    const result = await response.json();
    if (result.code === 0) { blogPosts = result.data; renderBlogGrid(); }
    else document.querySelector("#blog-grid").innerHTML = `<p class="empty-posts">加载失败：${result.msg}</p>`;
  } catch { document.querySelector("#blog-grid").innerHTML = '<p class="empty-posts">网络错误，无法加载文章。</p>'; }
}

async function fetchPostDetail(postId) {
  const resp = await fetch(`${API_BASE}/api/v1/posts/${postId}`, { headers: getAuthHeaders() });
  const result = await resp.json();
  return result.code === 0 ? result.data : null;
}

async function fetchPostComments(postId) {
  const resp = await fetch(`${API_BASE}/api/v1/posts/${postId}/comments`, { headers: getAuthHeaders() });
  const result = await resp.json();
  return result.code === 0 ? result.data : [];
}

function updatePostInList(postId, data) {
  const idx = blogPosts.findIndex((p) => p.id === postId);
  if (idx >= 0) Object.assign(blogPosts[idx], data);
}

/* ---------- 渲染 ---------- */
function renderBlogGrid() {
  const grid = document.querySelector("#blog-grid");
  if (!grid) return;
  if (!blogPosts.length) { grid.innerHTML = '<p class="empty-posts">还没有文章，博主快写点吧！</p>'; return; }
  let html = "";
  for (const post of blogPosts) {
    const summary = plainTextSummary(post.content, 150);
    const hotBadge = post.is_hot ? '<span class="hot-badge">🔥 HOT</span>' : "";
    const deleteBtnHtml = canDeletePost(post)
      ? `<button class="delete-card-btn" data-id="${post.id}">🗑️ 删除</button>`
      : "";
    html += `
      <article class="blog-card" data-id="${post.id}">
        ${hotBadge}
        <div class="card-meta">
          <span class="card-author">${escapeHtml(post.author)}</span>
          <span class="card-date">${formatPostDate(post.created_at)}</span>
        </div>
        <h2 class="card-title">${escapeHtml(post.title)}</h2>
        <p class="card-content">${escapeHtml(summary)}</p>
        <div class="card-footer">
          <span class="card-stats">
            <span>👍 ${post.like_count || 0}</span>
            <span>💬 ${post.comment_count || 0}</span>
          </span>
          ${deleteBtnHtml}
        </div>
      </article>`;
  }
  grid.innerHTML = html;
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
        <p class="comment-text markdown-body">${renderMarkdown(comment.content)}</p>
      </div>`
    )
    .join("");
}

/* ---------- 详情弹窗 ---------- */
async function openDetailModal(postId) {
  const post = await fetchPostDetail(postId);
  if (!post) return;
  let comments;
  try { comments = await fetchPostComments(postId); } catch { comments = []; }
  updatePostInList(postId, post);
  renderBlogGrid();

  const modal = document.createElement("div");
  modal.className = "custom-modal-overlay";
  modal.innerHTML = `
    <div class="custom-modal-content">
      <span class="custom-modal-close">×</span>
      <article>
        <div class="modal-meta">
          <span class="card-author">${escapeHtml(post.author)}</span>
          <span class="card-date">${formatPostDate(post.created_at)}</span>
        </div>
        <h1 class="modal-title">${escapeHtml(post.title)}</h1>
        <div class="modal-body markdown-body">${renderMarkdown(post.content)}</div>
        <div class="modal-stats">
          | 👍 <span id="modal-like-count">${post.like_count || 0}</span>
          | 💬 <span id="modal-comment-count">${post.comment_count || 0}</span>
        </div>
      </article>
      <div class="modal-actions">
        <button id="modal-like-btn" class="like-btn ${post.liked ? "liked" : ""}" type="button">
          ${post.liked ? "❤️ 已点赞" : "🤍 点赞"}
        </button>
      </div>
      <section class="comments-section">
        <h3 class="comments-title">评论 (${comments.length})</h3>
        <div id="comments-list" class="comments-list">${renderCommentsList(comments)}</div>
        <form id="comment-form" class="comment-form">
          <textarea
            id="comment-input"
            class="form-input form-textarea"
            rows="3"
            maxlength="500"
            placeholder="${isLoggedIn() ? "写下你的评论..." : "登录后可评论"}"
            ${isLoggedIn() ? "" : "disabled"}
          ></textarea>
          <button type="submit" class="toggle-btn comment-submit-btn" ${isLoggedIn() ? "" : "disabled"}>
            发布评论
          </button>
        </form>
      </section>
    </div>`;
  document.body.appendChild(modal);

  modal.querySelector(".custom-modal-close").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

  const likeBtn = modal.querySelector("#modal-like-btn");
  likeBtn.addEventListener("click", async () => {
    if (!isLoggedIn()) { alert("请先登录后再点赞。"); openAuthModal("login"); return; }
    try {
      const response = await fetch(`${API_BASE}/api/v1/posts/${postId}/like`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const result = await response.json();
      if (result.code !== 0) { alert(result.msg); return; }
      const { like_count, liked, is_hot } = result.data;
      modal.querySelector("#modal-like-count").textContent = like_count;
      likeBtn.classList.toggle("liked", liked);
      likeBtn.textContent = liked ? "❤️ 已点赞" : "🤍 点赞";
      updatePostInList(postId, { like_count, liked, is_hot });
      renderBlogGrid();
    } catch { alert("网络错误"); }
  });

  modal.querySelector("#comment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isLoggedIn()) { alert("请先登录后再评论。"); openAuthModal("login"); return; }
    const input = modal.querySelector("#comment-input");
    const content = input.value.trim();
    if (!content) return;
    try {
      const response = await fetch(`${API_BASE}/api/v1/posts/${postId}/comments`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ content }),
      });
      const result = await response.json();
      if (result.code !== 0) { alert(result.msg); return; }
      comments.push(result.data);
      modal.querySelector("#comments-list").innerHTML = renderCommentsList(comments);
      modal.querySelector("#modal-comment-count").textContent = comments.length;
      modal.querySelector(".comments-title").textContent = `评论 (${comments.length})`;
      input.value = "";
      updatePostInList(postId, { comment_count: comments.length });
      renderBlogGrid();
    } catch { alert("网络错误"); }
  });
}

/* ---------- 交互 ---------- */
function initInteractions() {
  document.querySelector("#blog-grid")?.addEventListener("click", async (e) => {
    const deleteBtn = e.target.closest(".delete-card-btn");
    if (deleteBtn) {
      e.stopPropagation();
      if (!isLoggedIn()) { alert("请先登录后再删除文章。"); openAuthModal("login"); return; }
      const targetId = deleteBtn.getAttribute("data-id");
      if (!confirm("确定要永久删除这篇文章吗？")) return;
      try {
        const response = await fetch(`${API_BASE}/api/v1/posts/${targetId}`, { method: "DELETE", headers: getAuthHeaders() });
        const result = await response.json();
        if (result.code === 0) await loadPostsFromServer();
        else alert("删除失败：" + result.msg);
      } catch { alert("网络错误，删除失败。"); }
      return;
    }
    const clickedCard = e.target.closest(".blog-card");
    if (clickedCard) openDetailModal(parseInt(clickedCard.getAttribute("data-id")));
  });

  document.querySelector("#publish-section")?.classList.toggle("hidden", !isOwner());
  document.querySelector("#login-prompt-section")?.classList.toggle("hidden", isOwner());

  document.querySelector("#post-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.querySelector("#post-title").value.trim();
    const content = document.querySelector("#post-content").value.trim();
    if (!title || !content) return;
    try {
      const response = await fetch(`${API_BASE}/api/v1/posts`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ title, content, author: currentUser.username }),
      });
      const result = await response.json();
      if (result.code === 0) { e.target.reset(); await loadPostsFromServer(); }
      else alert("发布失败：" + result.msg);
    } catch { alert("网络错误"); }
  });

  document.querySelector("#login-prompt-btn")?.addEventListener("click", () => openAuthModal("login"));
  document.querySelector("#search-btn")?.addEventListener("click", () => loadPostsFromServer(document.querySelector("#search-input")?.value.trim() || undefined));
  document.querySelector("#search-input")?.addEventListener("keydown", (e) => { if (e.key === "Enter") loadPostsFromServer(e.target.value.trim() || undefined); });

  initMarkdownToolbar("#post-content");
}

/* ---------- 初始化 ---------- */
async function init() {
  loadUserSession();
  initAuthInteractions();
  initThemeToggle();
  initInteractions();
  await loadSiteConfig();
  updateAuthUI();
  document.querySelector("#publish-section")?.classList.toggle("hidden", !isOwner());
  document.querySelector("#login-prompt-section")?.classList.toggle("hidden", isOwner());
  await loadPostsFromServer();
}

init();
