/**
 * personal.js — 个人主页
 * 依赖 common.js：常量、工具函数、认证、主题、Markdown、上传
 */

let personalPosts = [];
let personalLoadId = 0;
let personalLoaded = false;
let personalDetailId = 0;
let activePersonalModal = null;
let personalPublishBusy = false;
const pendingPersonalLikes = new Set();

/* ===================================================================
   API
   =================================================================== */
async function loadPersonalPosts() {
  const list = document.querySelector('#personal-list');
  if (!list) return;
  const requestId = ++personalLoadId;
  const session = currentUser?.token;
  if (!personalLoaded && !personalPosts.length) skeletonCards(4, '#personal-list');
  else list.classList.add('is-refreshing');
  list.querySelector('.list-load-feedback')?.remove();
  list.setAttribute('aria-busy', 'true');
  try {
    const result = await requestJson(`${API_BASE}/api/v1/personal`, { headers: getAuthHeaders() });
    if (requestId !== personalLoadId || session !== currentUser?.token) return;
    personalPosts = result.data;
    personalLoaded = true;
    renderPersonalList();
  } catch (error) {
    if (requestId !== personalLoadId || session !== currentUser?.token) return;
    let target = list;
    if (personalLoaded || personalPosts.length) {
      target = document.createElement('div');
      target.className = 'empty-posts list-load-feedback';
      list.prepend(target);
    }
    renderLoadError(target, '动态加载失败：' + error.message, loadPersonalPosts);
  } finally {
    if (requestId === personalLoadId) {
      list.classList.remove('is-refreshing');
      list.setAttribute('aria-busy', 'false');
    }
  }
}

async function fetchPersonalComments(postId) {
  const result = await requestJson(`${API_BASE}/api/v1/personal/${postId}/comments`, { headers: getAuthHeaders() });
  return result.data || [];
}

async function submitPersonalComment(postId, content) {
  if (!isLoggedIn()) { showToast("请先登录"); openAuthModal("login"); return null; }
  const result = await requestJson(`${API_BASE}/api/v1/personal/${postId}/comments`, {
    method: "POST", headers: getAuthHeaders(),
    body: JSON.stringify({ content }),
  });
  return result.data;
}

async function togglePersonalLike(postId) {
  if (!isLoggedIn()) { showToast("请先登录"); openAuthModal("login"); return; }
  if (pendingPersonalLikes.has(postId)) return;
  pendingPersonalLikes.add(postId);
  const session = currentUser.token;
  try {
    const result = await requestJson(`${API_BASE}/api/v1/personal/${postId}/like`, {
      method: "POST", headers: getAuthHeaders(),
    });
    if (session !== currentUser?.token) return;
    if (result.code === 0) {
      const post = personalPosts.find(p => p.id === postId);
      if (post) { post.like_count = result.data.like_count; post.liked = result.data.liked; }
      renderPersonalList();
      showToast(result.data.liked ? "已点赞" : "已取消点赞", "success");
    }
  } catch (error) {
    if (session === currentUser?.token) showToast('点赞失败：' + error.message);
  } finally { pendingPersonalLikes.delete(postId); }
}

/* ===================================================================
   渲染
   =================================================================== */
function renderPersonalList() {
  const list = document.querySelector("#personal-list");
  if (!list) return;
  if (!personalPosts.length) { list.innerHTML = '<div class="studio-empty"><span class="studio-empty-mark" aria-hidden="true">✳</span><h3>留白，也是生活的一部分。</h3><p>新的手记，会从某个平常的瞬间开始。</p></div>'; return; }
  let html = "";
  for (const post of personalPosts) {
    let imagesHtml = "";
    if (post.image_urls?.length) {
      imagesHtml = '<div class="image-grid">' +
        post.image_urls.map(safeFileUrl).filter(Boolean).map(u => `<img src="${escapeHtml(u)}" class="post-thumb" alt="图片" role="button" tabindex="0" aria-label="查看完整图片" aria-haspopup="dialog" data-full="${escapeHtml(u)}" loading="lazy" decoding="async" />`).join("") +
        '</div>';
    }
    let filesHtml = "";
    if (post.file_urls?.length) {
      filesHtml = '<div class="file-list">' +
        post.file_urls.map(safeFileUrl).filter(Boolean).map(u => { const n = u.split("/").pop(); return `<a href="${escapeHtml(u)}" class="file-link" download rel="noopener">📎 ${escapeHtml(n)}</a>`; }).join("") +
        '</div>';
    }
    const likeBtnClass = post.liked ? "like-btn-card liked" : "like-btn-card";
    const likeBtnText = post.liked ? "♥" : "♡";
    const deleteBtnHtml = isOwner() ? `<button class="delete-card-btn" data-id="${post.id}">删除</button>` : "";
    html += `
      <article class="blog-card" data-id="${post.id}">
        <div class="card-meta">
          <span class="card-author">${escapeHtml(post.author)}</span>
          <span class="card-date">${formatPostDate(post.created_at)}</span>
          <button type="button" class="${likeBtnClass}" data-id="${post.id}" data-action="like" aria-label="${post.liked ? '取消点赞' : '点赞'}">${likeBtnText} <span class="like-count">${post.like_count || 0}</span></button>
          <button type="button" class="comment-btn-card" data-id="${post.id}" data-action="comment" aria-label="查看评论">回应 ${post.comment_count || 0}</button>
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
  const requestId = ++personalDetailId;
  let comments = [];
  try { comments = await fetchPersonalComments(postId); }
  catch (error) { if (requestId === personalDetailId) showToast('评论加载失败：' + error.message); return; }
  if (requestId !== personalDetailId) return;
  activePersonalModal?.remove();
  const modal = document.createElement("div");
  activePersonalModal = modal;
  modal.className = "custom-modal-overlay reader-overlay";
  modal.restoreFocusTarget = () => document.querySelector(`[data-action="comment"][data-id="${postId}"]`);
  modal.innerHTML = `
    <div class="custom-modal-content">
      <div class="reader-bar"><span>LTTO / A FRAGMENT OF LIFE</span><button type="button" class="custom-modal-close" aria-label="关闭详情">×</button></div><div class="reader-body">
      <div class="card-meta">
        <span>${escapeHtml(post.author)} · ${formatPostDate(post.created_at)}</span>
      </div>
      <div class="modal-body markdown-body">${renderMarkdown(post.content)}</div>
      </div><section class="comments-section">
        <h3 class="comments-title">评论 (${comments.length})</h3>
        <div class="comments-list">${renderCommentsList(comments)}</div>
        <div class="comment-login ${isLoggedIn() ? 'hidden' : ''}" data-comment-login><span>把你的想法，留在这里。</span><button type="button" class="studio-secondary">登录后回应 ↗</button></div><form class="comment-form2">
          <textarea class="form-input form-textarea" rows="2" maxlength="500" placeholder="${isLoggedIn() ? "写下你的评论..." : "登录后可评论"}" ${isLoggedIn() ? "" : "disabled"}></textarea>
          <button type="submit" class="toggle-btn" ${isLoggedIn() ? "" : "disabled"}>发布</button>
        </form>
      </section>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector(".custom-modal-close").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  let submitting = false;
  modal.querySelector(".comment-form2").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isLoggedIn()) { showToast("请先登录"); return; }
    const ta = modal.querySelector("textarea");
    const c = ta.value.trim();
    if (!c || submitting) return;
    submitting = true;
    const session = currentUser.token;
    const button = modal.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const newC = await submitPersonalComment(postId, c);
      if (!newC || !modal.isConnected || session !== currentUser?.token) return;
      comments.push(newC);
      modal.querySelector('.comments-list').innerHTML = renderCommentsList(comments);
      modal.querySelector('.comments-title').textContent = `评论 (${comments.length})`;
      if (ta.value.trim() === c) ta.value = '';
      post.comment_count = comments.length;
      renderPersonalList();
      showToast('评论成功！', 'success');
    } catch (error) {
      if (modal.isConnected && session === currentUser?.token) showToast('评论失败：' + error.message);
    } finally { submitting = false; button.disabled = !isLoggedIn(); }
  });
}

/* ===================================================================
   交互
   =================================================================== */
function initInteractions() {
  document.querySelector('#personal-list')?.addEventListener('keydown', event => {
    if (event.repeat || !['Enter', ' '].includes(event.key)) return;
    const image = event.target.closest('.post-thumb');
    if (!image) return;
    event.preventDefault();
    image.click();
  });
  document.querySelector("#personal-list")?.addEventListener("click", async (e) => {
    // Lightbox for image clicks
    const thumb = e.target.closest(".post-thumb");
    if (thumb) {
      e.stopPropagation();
      if (typeof GardenUI !== "undefined") { GardenUI.openGallery(thumb); return; }
      const src = safeFileUrl(thumb.getAttribute("data-full") || thumb.src);
      if (!src) { showToast('图片地址无效'); return; }
      const overlay = document.createElement("div");
      overlay.className = "lightbox-overlay";
      overlay.innerHTML = `<button type="button" class="custom-modal-close" aria-label="关闭图片">×</button><img src="${escapeHtml(src)}" class="lightbox-img" alt="查看原图" />`;
      document.body.appendChild(overlay);
      overlay.addEventListener("click", () => overlay.remove());
      return;
    }
    const deleteBtn = e.target.closest(".delete-card-btn");
    if (deleteBtn) {
      e.stopPropagation();
      if (!isLoggedIn()) { showToast("请先登录后再删除。"); openAuthModal("login"); return; }
      if (!isOwner()) { showToast("仅博主可删除动态。"); return; }
      const targetId = deleteBtn.getAttribute("data-id");
      if (deleteBtn.disabled || !await (typeof GardenUI !== "undefined" ? GardenUI.confirm({title:"删除这则手记？",message:"手记与相关评论会被移除，无法恢复。",confirmText:"删除手记",danger:true}) : confirm("确定要删除这条内容吗？"))) return;
      deleteBtn.disabled = true;
      try {
        await requestJson(`${API_BASE}/api/v1/personal/${targetId}`, { method: "DELETE", headers: getAuthHeaders() });
        await loadPersonalPosts();
      } catch (error) { showToast('删除失败：' + error.message); }
      finally { deleteBtn.disabled = false; }
      return;
    }
    const likeBtn = e.target.closest("[data-action='like']");
    if (likeBtn) { e.stopPropagation(); await togglePersonalLike(parseInt(likeBtn.getAttribute("data-id"))); return; }
    const commentBtn = e.target.closest("[data-action='comment']");
    if (commentBtn) { e.stopPropagation(); await openPersonalDetail(parseInt(commentBtn.getAttribute("data-id"))); return; }
    if (e.target.closest('a, button, input, textarea')) return;
    const card = e.target.closest(".blog-card");
    if (card) { await openPersonalDetail(parseInt(card.getAttribute("data-id"))); }
  });

  document.querySelector("#publish-section")?.classList.toggle("hidden", !isOwner());

  document.querySelector("#personal-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isOwner()) { showToast("仅博主可发布动态。"); return; }
    if (personalPublishBusy) return;
    const content = document.querySelector("#personal-content").value.trim();
    if (!content) return;
    const imageFiles = document.querySelector("#image-input")?.files || [];
    const fileFiles = document.querySelector("#file-input")?.files || [];
    const session = currentUser.token;
    personalPublishBusy = true;
    const button = e.target.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const imageUrls = [], fileUrls = [];
      for (const file of [...imageFiles]) {
        if (session !== currentUser?.token) throw new Error('登录状态已变化，请重新发布');
        imageUrls.push(await uploadFile(file));
      }
      for (const file of [...fileFiles]) {
        if (session !== currentUser?.token) throw new Error('登录状态已变化，请重新发布');
        fileUrls.push(await uploadFile(file));
      }
      if (session !== currentUser?.token) throw new Error('登录状态已变化，请重新发布');
      await requestJson(`${API_BASE}/api/v1/personal`, {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({ content, image_urls: imageUrls, file_urls: fileUrls }),
      });
      if (session === currentUser?.token) { e.target.reset(); await loadPersonalPosts(); if (typeof GardenUI !== 'undefined') GardenUI.closePanel('#publish-section'); showToast('手记已发布', 'success'); }
    } catch (error) { showToast('发布失败：' + error.message); }
    finally { personalPublishBusy = false; if (button) button.disabled = false; }
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
  // Register auth-changed listener BEFORE any await — ensures it catches
  // login events that fire while loadSiteConfig / loadPersonalPosts are pending
  document.addEventListener("auth-changed", () => {
    document.querySelector("#publish-section")?.classList.toggle("hidden", !isOwner());
    loadPersonalPosts();
  });
  window.addEventListener('pagehide', () => { personalLoadId++; personalDetailId++; activePersonalModal?.remove(); });
  await loadSiteConfig();
  updateAuthUI();
  document.querySelector("#publish-section")?.classList.toggle("hidden", !isOwner());
}

init();
