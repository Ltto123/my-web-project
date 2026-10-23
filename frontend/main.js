/**
 * main.js — 博客首页
 * 依赖 common.js：常量、工具函数、认证、主题、上传
 */

const HOT_LIKE_THRESHOLD = 1;
let blogPosts = [];
let pagination = { page: 1, total_pages: 1, total: 0, search: "" };
let postsRequest = 0;
let postsController;

/* ===================================================================
   页面特有：博客列表 / 详情 / 评论 / 点赞 / 删除 / 发布 / 搜索
   =================================================================== */

function canDeletePost(post) {
  if (!isLoggedIn()) return false;
  if (isOwner()) return true;
  return currentUser.username === post.author;
}

/* ---------- API ---------- */
async function loadPostsFromServer(search, page) {
  page = page || 1;
  const grid = document.querySelector("#blog-grid");
  document.querySelector("#post-load-feedback")?.remove();
  const request = ++postsRequest;
  postsController?.abort();
  postsController = new AbortController();
  if (!blogPosts.length) skeletonCards(3, "#blog-grid");
  else grid.classList.add("is-refreshing");
  grid.setAttribute("aria-busy", "true");
  try {
    let url = `${API_BASE}/api/v1/posts?page=${page}&page_size=15`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    const result = await requestJson(url, { headers: getAuthHeaders(), signal: postsController.signal });
    if (request !== postsRequest) return;
    if (result.code === 0) {
      // New paginated format: data.posts + data.total + data.page + data.total_pages
      blogPosts = result.data.posts || result.data;
      pagination = {
        page: result.data.page || 1,
        total_pages: result.data.total_pages || 1,
        total: result.data.total || 0,
        search: search || "",
      };
      renderBlogGrid();
      renderPagination();
      const count = document.querySelector("#post-count");
      if (count) count.textContent = search ? `找到 ${pagination.total} 篇` : `${pagination.total} 篇记录`;
    } else {
      renderLoadError(grid, "加载失败，请重试。", () => loadPostsFromServer(search, page));
    }
  } catch (error) {
    if (request !== postsRequest) return;
    let feedback = grid;
    if (blogPosts.length && grid.querySelector(".blog-card")) {
      feedback = document.createElement("div");
      feedback.id = "post-load-feedback";
      grid.insertAdjacentElement("beforebegin", feedback);
    } else document.querySelector(".pagination")?.remove();
    renderLoadError(feedback, error.message || "网络错误，无法加载文章。", () => loadPostsFromServer(search, page));
  } finally {
    if (request === postsRequest) { grid.classList.remove("is-refreshing"); grid.setAttribute("aria-busy", "false"); }
  }
}

async function fetchPostDetail(postId) {
  const result = await requestJson(`${API_BASE}/api/v1/posts/${postId}`, { headers: getAuthHeaders() });
  return result.data;
}

async function fetchPostComments(postId) {
  const result = await requestJson(`${API_BASE}/api/v1/posts/${postId}/comments`, { headers: getAuthHeaders() });
  return result.data;
}

function updatePostInList(postId, data) {
  const idx = blogPosts.findIndex((p) => p.id === postId);
  if (idx >= 0) Object.assign(blogPosts[idx], data);
}

/* ---------- 渲染 ---------- */
function renderBlogGrid() {
  const grid = document.querySelector("#blog-grid");
  if (!grid) return;
  if (!blogPosts.length) { grid.innerHTML = `<p class="empty-posts">${pagination.search ? "没有找到相关文章，试试其他关键词。" : "还没有文章，第一篇记录正在路上。"}</p>`; return; }
  let html = "";
  for (const post of blogPosts) {
    const preview = typeof convertForPreview === "function" ? convertForPreview(post.content) : plainTextSummary(post.content, 150);
    const hotBadge = post.is_hot ? '<span class="hot-badge">读者关注 / IN FOCUS</span>' : "";
    const deleteBtnHtml = canDeletePost(post)
      ? `<button class="delete-card-btn" data-id="${post.id}">删除文章</button>`
      : "";
    html += `
      <article class="blog-card" data-id="${post.id}">
        ${hotBadge}
        <div class="card-meta">
          <span class="card-author">${escapeHtml(post.author)}</span>
          <span class="card-date">${formatPostDate(post.created_at)}</span>
        </div>
        <h2 class="card-title"><button type="button" class="card-open-btn" data-id="${post.id}" aria-haspopup="dialog">${escapeHtml(post.title)}</button></h2>
        <div class="card-content markdown-body card-content-preview">${preview}</div>
        <div class="card-footer">
          <span class="card-stats">
            <span>${post.like_count || 0} 次共鸣</span>
            <span>${post.comment_count || 0} 条回响</span>
          </span>
          ${deleteBtnHtml}
        </div>
      </article>`;
  }
  grid.innerHTML = html;
}

function renderPagination() {
  const container = document.querySelector("#blog-grid");
  if (!container || pagination.total_pages <= 1) {
    // Remove existing pagination
    const old = document.querySelector(".pagination");
    if (old) old.remove();
    return;
  }
  let old = document.querySelector(".pagination");
  if (old) old.remove();

  const nav = document.createElement("div");
  nav.className = "pagination";
  const p = pagination;

  // Prev
  nav.innerHTML += `<button class="page-btn" ${p.page <= 1 ? "disabled" : ""}>‹ 上一页</button>`;

  // Page numbers
  const start = Math.max(1, p.page - 2);
  const end = Math.min(p.total_pages, p.page + 2);
  for (let i = start; i <= end; i++) {
    nav.innerHTML += `<button class="page-btn${i === p.page ? ' active' : ''}" data-page="${i}"${i === p.page ? ' aria-current="page"' : ''}>${i}</button>`;
  }

  // Next
  nav.innerHTML += `<button class="page-btn" ${p.page >= p.total_pages ? "disabled" : ""}>下一页 ›</button>`;
  nav.innerHTML += `<span class="page-info">共 ${p.total} 篇</span>`;

  nav.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled) return;
    if (btn.textContent.includes("上一页")) loadPostsFromServer(p.search, p.page - 1);
    else if (btn.textContent.includes("下一页")) loadPostsFromServer(p.search, p.page + 1);
    else {
      const pg = parseInt(btn.getAttribute("data-page"));
      if (pg) loadPostsFromServer(p.search, pg);
    }
  });

  container.insertAdjacentElement("afterend", nav);
}

/* ---------- 详情弹窗 ---------- */
async function openDetailModal(postId) {
  document.querySelector('[data-blog-detail]')?.remove();
  const modal = document.createElement("div");
  modal.className = "custom-modal-overlay reader-overlay";
  modal.dataset.blogDetail = String(postId);
  modal.restoreFocusTarget = () => document.querySelector(`.blog-card[data-id="${postId}"] .card-open-btn`);
  modal.innerHTML = '<div class="custom-modal-content"><div class="reader-bar"><span>LTTO / FIELD NOTES</span><button class="custom-modal-close" type="button" aria-label="关闭文章">×</button></div><div class="detail-loading" role="status">正在打开文章…</div></div>';
  modal.addEventListener("click", event => {
    if (event.target === modal || event.target.closest(".custom-modal-close")) modal.remove();
  });
  document.body.appendChild(modal);
  let post;
  let comments = [];
  let commentsFailed = false;
  try {
    const results = await Promise.allSettled([fetchPostDetail(postId), fetchPostComments(postId)]);
    if (!modal.isConnected) return;
    if (results[0].status === "rejected") throw results[0].reason;
    post = results[0].value;
    if (!post) throw new Error("文章不存在或已被删除。");
    if (results[1].status === "fulfilled") comments = results[1].value;
    else commentsFailed = true;
  } catch (error) {
    if (modal.isConnected) renderLoadError(modal.querySelector(".detail-loading"), error.message, () => openDetailModal(postId));
    return;
  }
  updatePostInList(postId, post);
  modal.innerHTML = `
    <div class="custom-modal-content">
      <div class="reader-bar"><span>LTTO / FIELD NOTES</span><button class="custom-modal-close" type="button" aria-label="关闭文章">×</button></div>
      <article>
        <div class="modal-meta">
          <span class="card-author">${escapeHtml(post.author)}</span>
          <span class="card-date">${formatPostDate(post.created_at)}</span>
        </div>
        <h1 class="modal-title">${escapeHtml(post.title)}</h1>
        <div class="modal-body markdown-body">${renderMarkdown(post.content)}</div>
        <div class="modal-stats">
          <span><span id="modal-like-count">${post.like_count || 0}</span> 次共鸣</span>
          <span><span id="modal-comment-count">${post.comment_count || 0}</span> 条回响</span>
        </div>
      </article>
      <div class="modal-actions">
        <button id="modal-like-btn" class="like-btn ${post.liked ? "liked" : ""}" type="button">
          ${post.liked ? "已共鸣 · ♥" : "与我共鸣 ♡"}
        </button>
      </div>
      <section class="comments-section">
        <h3 class="comments-title">评论 (${comments.length})</h3>
        <div id="comments-list" class="comments-list">${commentsFailed ? '<p role="status">评论暂时未能加载。<button class="retry-comments toggle-btn toggle-btn-outline" type="button">重试</button></p>' : renderCommentsList(comments)}</div>
        <div class="comment-login ${isLoggedIn() ? 'hidden' : ''}" data-comment-login><span>一个念头，也许会引出另一个。</span><button type="button" class="studio-secondary">登录后回应 ↗</button></div>
        <form id="comment-form" class="comment-form">
          <textarea
            id="comment-input"
            class="form-input form-textarea"
            rows="3" aria-label="评论内容"
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
  const panel = modal.querySelector(".custom-modal-content");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", post.title);
  panel.tabIndex = -1;
  panel.focus({ preventScroll: true });
  modal.querySelector(".retry-comments")?.addEventListener("click", () => openDetailModal(postId));

  const likeBtn = modal.querySelector("#modal-like-btn");
  likeBtn.addEventListener("click", async () => {
    if (likeBtn.disabled) return;
    if (!isLoggedIn()) { showToast("请先登录后再点赞。"); openAuthModal("login"); return; }
    likeBtn.disabled = true;
    const sessionToken = currentUser.token;
    try {
      const result = await requestJson(`${API_BASE}/api/v1/posts/${postId}/like`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (sessionToken !== currentUser?.token || !modal.isConnected) return;
      const { like_count, liked, is_hot } = result.data;
      modal.querySelector("#modal-like-count").textContent = like_count;
      likeBtn.classList.toggle("liked", liked);
      likeBtn.textContent = liked ? "已共鸣 · ♥" : "与我共鸣 ♡";
      updatePostInList(postId, { like_count, liked, is_hot });
      renderBlogGrid();
      showToast(liked ? "已点赞" : "已取消点赞", "success");
    } catch (error) { showToast(error.message || "网络错误"); }
    finally { likeBtn.disabled = false; }
  });

  let commentSubmitting = false;
  modal.querySelector("#comment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (commentSubmitting) return;
    if (!isLoggedIn()) { showToast("请先登录后再评论。"); openAuthModal("login"); return; }
    const input = modal.querySelector("#comment-input");
    const content = input.value.trim();
    if (!content) return;
    const submit = e.target.querySelector('button[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    commentSubmitting = true;
    e.target.dataset.submitting = "true";
    const submittedValue = input.value;
    const sessionToken = currentUser.token;
    try {
      const result = await requestJson(`${API_BASE}/api/v1/posts/${postId}/comments`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ content }),
      });
      if (sessionToken !== currentUser?.token || !modal.isConnected) return;
      comments.push(result.data);
      modal.querySelector("#comments-list").innerHTML = renderCommentsList(comments);
      const commentCount = commentsFailed ? (post.comment_count || 0) + 1 : comments.length;
      post.comment_count = commentCount;
      modal.querySelector("#modal-comment-count").textContent = commentCount;
      modal.querySelector(".comments-title").textContent = `评论 (${commentCount})`;
      if (input.value === submittedValue) input.value = "";
      updatePostInList(postId, { comment_count: commentCount });
      renderBlogGrid();
      showToast("评论成功！", "success");
    } catch (error) { showToast(error.message || "网络错误"); }
    finally { commentSubmitting = false; delete e.target.dataset.submitting; submit.disabled = !isLoggedIn(); }
  });
}

/* ---------- 交互 ---------- */
function initInteractions() {
  document.querySelector("#blog-grid")?.addEventListener("click", async (e) => {
    if (e.target.closest("a")) return;
    const deleteBtn = e.target.closest(".delete-card-btn");
    if (deleteBtn) {
      e.stopPropagation();
      if (deleteBtn.disabled) return;
      if (!isLoggedIn()) { showToast("请先登录后再删除文章。"); openAuthModal("login"); return; }
      const targetId = deleteBtn.getAttribute("data-id");
      if (!await (typeof GardenUI !== "undefined" ? GardenUI.confirm({title:"让这篇文字离开？",message:"文章及其评论会被永久删除。",confirmText:"删除文章",danger:true}) : confirm("确定要永久删除这篇文章吗？"))) return;
      deleteBtn.disabled = true;
      try {
        const result = await requestJson(`${API_BASE}/api/v1/posts/${targetId}`, { method: "DELETE", headers: getAuthHeaders() });
        if (result.code === 0) await loadPostsFromServer();
        else showToast("删除失败：" + result.msg);
      } catch (error) { showToast(error.message || "网络错误，删除失败。"); }
      finally { deleteBtn.disabled = false; }
      return;
    }
    const clickedCard = e.target.closest(".blog-card");
    if (clickedCard) openDetailModal(parseInt(clickedCard.getAttribute("data-id")));
  });

  document.querySelector("#publish-section")?.classList.toggle("hidden", !isLoggedIn());
  document.querySelector("#login-prompt-section")?.classList.toggle("hidden", isLoggedIn());

  document.querySelector("#post-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isLoggedIn()) { openAuthModal("login"); return; }
    const title = document.querySelector("#post-title").value.trim();
    const content = document.querySelector("#post-content").value.trim();
    if (!title || !content) return;
    const submit = e.target.querySelector('button[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    submit.textContent = "正在发布…";
    const sessionToken = currentUser.token;
    const titleValue = document.querySelector("#post-title").value;
    const contentValue = document.querySelector("#post-content").value;
    try {
      await requestJson(`${API_BASE}/api/v1/posts`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ title, content, author: currentUser.username }),
      });
      if (sessionToken !== currentUser?.token) return;
      if (document.querySelector("#post-title").value === titleValue && document.querySelector("#post-content").value === contentValue) e.target.reset();
      document.querySelector("#post-author").value = currentUser?.username || "";
      await loadPostsFromServer();
      if (typeof GardenUI !== "undefined") GardenUI.closePanel("#publish-section");
      showToast("文章已发布", "success");
    } catch (error) { showToast(error.message || "网络错误"); }
    finally { submit.disabled = false; submit.textContent = "立即发布文章"; }
  });

  document.querySelector("#login-prompt-btn")?.addEventListener("click", () => openAuthModal("login"));
  let searchTimer;
  const searchInput = document.querySelector("#search-input");
  const search = () => { clearTimeout(searchTimer); loadPostsFromServer(searchInput?.value.trim() || "", 1); };
  document.querySelector("#search-btn")?.addEventListener("click", search);
  searchInput?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) search(); });
  searchInput?.addEventListener("input", (e) => { clearTimeout(searchTimer); if (!e.isComposing) searchTimer = setTimeout(search, 320); });
  searchInput?.addEventListener("compositionstart", () => clearTimeout(searchTimer));
  searchInput?.addEventListener("compositionend", () => { clearTimeout(searchTimer); searchTimer = setTimeout(search, 320); });

  initMarkdownToolbar("#post-content");
}

/* ---------- 初始化 ---------- */
async function init() {
  loadUserSession();
  initAuthInteractions();
  initThemeToggle();
  initInteractions();
  // Register auth-changed listener BEFORE any await — ensures it catches
  // login events that fire while loadSiteConfig / loadPostsFromServer are pending
  document.addEventListener("auth-changed", () => {
    document.querySelector("#publish-section")?.classList.toggle("hidden", !isLoggedIn());
    document.querySelector("#login-prompt-section")?.classList.toggle("hidden", isLoggedIn());
    document.querySelector("#post-author").value = currentUser?.username || "";
    loadPostsFromServer(pagination.search, pagination.page);
  });
  await loadSiteConfig();
  updateAuthUI();
}

init();
