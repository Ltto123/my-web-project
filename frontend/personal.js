/**
 * personal.js — 个人主页
 * 依赖 common.js：常量、工具函数、认证、主题、Markdown、上传
 */

let personalPosts = [];

/* ===================================================================
   API
   =================================================================== */
async function loadPersonalPosts() {
  try {
    const r = await fetch(`${API_BASE}/api/v1/personal`, { headers: getAuthHeaders() });
    const result = await r.json();
    if (result.code === 0) { personalPosts = result.data; renderPersonalList(); }
  } catch { /* ignore */ }
}

async function fetchPersonalComments(postId) {
  const r = await fetch(`${API_BASE}/api/v1/personal/${postId}/comments`, { headers: getAuthHeaders() });
  const result = await r.json();
  return result.code === 0 ? result.data : [];
}

async function submitPersonalComment(postId, content) {
  if (!isLoggedIn()) { alert("请先登录"); openAuthModal("login"); return null; }
  const r = await fetch(`${API_BASE}/api/v1/personal/${postId}/comments`, {
    method: "POST", headers: getAuthHeaders(),
    body: JSON.stringify({ content }),
  });
  const result = await r.json();
  if (result.code !== 0) { alert(result.msg); return null; }
  return result.data;
}

async function togglePersonalLike(postId) {
  if (!isLoggedIn()) { alert("请先登录"); openAuthModal("login"); return; }
  try {
    const r = await fetch(`${API_BASE}/api/v1/personal/${postId}/like`, {
      method: "POST", headers: getAuthHeaders(),
    });
    const result = await r.json();
    if (result.code === 0) {
      const post = personalPosts.find(p => p.id === postId);
      if (post) { post.like_count = result.data.like_count; post.liked = result.data.liked; }
      renderPersonalList();
    }
  } catch { /* ignore */ }
}

/* ===================================================================
   渲染
   =================================================================== */
function renderPersonalList() {
  const list = document.querySelector("#personal-list");
  if (!list) return;
  if (!personalPosts.length) { list.innerHTML = '<p class="empty-posts">还没有内容。</p>'; return; }
  let html = "";
  for (const post of personalPosts) {
    let imagesHtml = "";
    if (post.image_urls?.length) {
      imagesHtml = '<div class="image-grid">' +
        post.image_urls.map(u => `<a href="${escapeHtml(u)}" target="_blank"><img src="${escapeHtml(u)}" class="post-thumb" alt="图片" /></a>`).join("") +
        '</div>';
    }
    let filesHtml = "";
    if (post.file_urls?.length) {
      filesHtml = '<div class="file-list">' +
        post.file_urls.map(u => { const n = u.split("/").pop(); return `<a href="${escapeHtml(u)}" class="file-link" download>📎 ${escapeHtml(n)}</a>`; }).join("") +
        '</div>';
    }
    const likeBtnClass = post.liked ? "like-btn-card liked" : "like-btn-card";
    const likeBtnText = post.liked ? "❤️" : "🤍";
    const deleteBtnHtml = isOwner() ? `<button class="delete-card-btn" data-id="${post.id}">🗑️ 删除</button>` : "";
    html += `
      <article class="blog-card" data-id="${post.id}">
        <div class="card-meta">
          <span class="card-author">${escapeHtml(post.author)}</span>
          <span class="card-date">${formatPostDate(post.created_at)}</span>
          <span class="${likeBtnClass}" data-id="${post.id}" data-action="like">${likeBtnText} <span class="like-count">${post.like_count || 0}</span></span>
          <span class="comment-btn-card" data-id="${post.id}" data-action="comment">💬 ${post.comment_count || 0}</span>
        </div>
        <div class="card-content markdown-body">${renderMarkdown(post.content)}</div>
        ${imagesHtml}${filesHtml}
        <div class="card-footer">${deleteBtnHtml}</div>
      </article>`;
  }
  list.innerHTML = html;
}

async function openPersonalDetail(postId) {
  const post = personalPosts.find(p => p.id === postId);
  if (!post) return;
  let comments = [];
  try { comments = await fetchPersonalComments(postId); } catch { /* */ }
  const modal = document.createElement("div");
  modal.className = "custom-modal-overlay";
  modal.innerHTML = `
    <div class="custom-modal-content">
      <span class="custom-modal-close">×</span>
      <div class="card-meta">
        <span>${escapeHtml(post.author)} · ${formatPostDate(post.created_at)}</span>
      </div>
      <div class="modal-body markdown-body">${renderMarkdown(post.content)}</div>
      <section class="comments-section">
        <h3 class="comments-title">评论 (${comments.length})</h3>
        <div class="comments-list">${renderCommentsList(comments)}</div>
        <form class="comment-form2">
          <textarea class="form-input form-textarea" rows="2" maxlength="500" placeholder="${isLoggedIn() ? "写下你的评论..." : "登录后可评论"}" ${isLoggedIn() ? "" : "disabled"}></textarea>
          <button type="submit" class="toggle-btn" ${isLoggedIn() ? "" : "disabled"}>发布</button>
        </form>
      </section>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector(".custom-modal-close").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector(".comment-form2").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isLoggedIn()) { alert("请先登录"); return; }
    const ta = modal.querySelector("textarea");
    const c = ta.value.trim();
    if (!c) return;
    const newC = await submitPersonalComment(postId, c);
    if (newC) { comments.push(newC); modal.querySelector(".comments-list").innerHTML = renderCommentsList(comments); modal.querySelector(".comments-title").textContent = `评论 (${comments.length})`; ta.value = ""; }
  });
}

/* ===================================================================
   交互
   =================================================================== */
function initInteractions() {
  document.querySelector("#personal-list")?.addEventListener("click", async (e) => {
    const deleteBtn = e.target.closest(".delete-card-btn");
    if (deleteBtn) {
      e.stopPropagation();
      if (!isOwner()) return;
      const targetId = deleteBtn.getAttribute("data-id");
      if (!confirm("确定要删除这条内容吗？")) return;
      try {
        const r = await fetch(`${API_BASE}/api/v1/personal/${targetId}`, { method: "DELETE", headers: getAuthHeaders() });
        const result = await r.json();
        if (result.code === 0) await loadPersonalPosts();
        else alert(result.msg);
      } catch { alert("网络错误，删除失败。"); }
      return;
    }
    const likeBtn = e.target.closest("[data-action='like']");
    if (likeBtn) { e.stopPropagation(); await togglePersonalLike(parseInt(likeBtn.getAttribute("data-id"))); return; }
    const commentBtn = e.target.closest("[data-action='comment']");
    if (commentBtn) { e.stopPropagation(); await openPersonalDetail(parseInt(commentBtn.getAttribute("data-id"))); return; }
  });

  document.querySelector("#publish-section")?.classList.toggle("hidden", !isOwner());

  document.querySelector("#personal-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = document.querySelector("#personal-content").value.trim();
    if (!content) return;
    const imageFiles = document.querySelector("#personal-images")?.files || [];
    const fileFiles = document.querySelector("#personal-files")?.files || [];
    let imageUrls = [], fileUrls = [];
    if (imageFiles.length) { for (const f of imageFiles) { try { imageUrls.push(await uploadFile(f)); } catch (err) { alert(`上传图片失败: ${err.message}`); return; } } }
    if (fileFiles.length) { for (const f of fileFiles) { try { fileUrls.push(await uploadFile(f)); } catch (err) { alert(`上传文件失败: ${err.message}`); return; } } }
    try {
      const r = await fetch(`${API_BASE}/api/v1/personal`, {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({ content, image_urls: imageUrls, file_urls: fileUrls }),
      });
      const result = await r.json();
      if (result.code === 0) { e.target.reset(); await loadPersonalPosts(); }
      else alert(result.msg);
    } catch { alert("网络错误"); }
  });

  initMarkdownToolbar("#personal-content");
}

/* ===================================================================
   初始化
   =================================================================== */
async function init() {
  loadUserSession();
  initAuthInteractions();
  initThemeToggle();
  initInteractions();
  await loadSiteConfig();
  updateAuthUI();
  document.querySelector("#publish-section")?.classList.toggle("hidden", !isOwner());
  await loadPersonalPosts();
}

init();
