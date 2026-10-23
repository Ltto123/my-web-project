/**
 * library.js — 资源库
 * 依赖 common.js：常量、工具函数、认证、主题、上传
 */

let resources = [];
let currentCategory = "";
let resourceLoadId = 0;
let resourcesLoaded = false;
let resourceUploadBusy = false;
let resourcePreviewId = 0;
let resourcePreviewController = null;
let activeResourceModal = null;
const pendingResourceStars = new Set();

/* ===================================================================
   API
   =================================================================== */
async function loadResources(category) {
  const list = document.querySelector("#resource-list");
  if (!list) return;
  const requestId = ++resourceLoadId;
  const session = currentUser?.token;
  if (!resourcesLoaded && !resources.length) skeletonCards(6, '#resource-list');
  else list.classList.add('is-refreshing');
  list.querySelector('.list-load-feedback')?.remove();
  list.setAttribute('aria-busy', 'true');
  try {
    const params = category ? `?category=${encodeURIComponent(category)}` : "";
    const result = await requestJson(`${API_BASE}/api/v1/resources${params}`, {
      headers: getAuthHeaders(),
    });
    if (requestId !== resourceLoadId || session !== currentUser?.token) return;
    resources = result.data;
    resourcesLoaded = true;
    renderResourceList();
  } catch (e) {
    if (requestId !== resourceLoadId || session !== currentUser?.token) return;
    let target = list;
    if (resourcesLoaded || resources.length) {
      target = document.createElement('div');
      target.className = 'empty-posts list-load-feedback';
      list.prepend(target);
    }
    renderLoadError(target, '资源加载失败：' + e.message, () => loadResources(category));
  } finally {
    if (requestId === resourceLoadId) {
      list.classList.remove('is-refreshing');
      list.setAttribute('aria-busy', 'false');
    }
  }
}

async function submitResource(form) {
  if (resourceUploadBusy) return;
  if (!isLoggedIn()) {
    showToast("请先登录后再上传。");
    openAuthModal("login");
    return;
  }
  if (!isOwner()) { showToast('仅博主可上传资源'); return; }
  const title = form.querySelector("#resource-title").value.trim();
  const desc = form.querySelector("#resource-desc").value.trim();
  const category = form.querySelector("#resource-category").value;
  const file = form.querySelector("#resource-file")?.files[0];
  if (!title || !category || !file) {
    showToast("请填写完整信息");
    return;
  }
  resourceUploadBusy = true;
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  const session = currentUser.token;
  try {
    const fileUrl = await uploadFile(file);
    if (session !== currentUser?.token) throw new Error('登录状态已变化，请重新上传');
    await requestJson(`${API_BASE}/api/v1/resources`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        title,
        description: desc,
        category,
        file_url: fileUrl,
        file_name: file.name,
      }),
    });
    if (session === currentUser?.token) {
      form.reset();
      if (typeof GardenUI !== 'undefined') GardenUI.closePanel('#upload-section');
      loadResources(currentCategory);
      showToast("上传成功！", "success");
    }
  } catch (err) {
    showToast("上传失败: " + err.message);
  } finally { resourceUploadBusy = false; if (button) button.disabled = false; }
}

async function toggleResourceStar(resourceId) {
  if (!isLoggedIn()) {
    showToast("请先登录");
    openAuthModal("login");
    return;
  }
  if (pendingResourceStars.has(resourceId)) return;
  pendingResourceStars.add(resourceId);
  const session = currentUser.token;
  try {
    const result = await requestJson(`${API_BASE}/api/v1/resources/${resourceId}/star`, {
      method: "POST",
      headers: getAuthHeaders(),
    });
    if (session !== currentUser?.token) return;
    if (result.code === 0) {
      const resource = resources.find((r) => r.id === resourceId);
      if (resource) {
        resource.star_count = result.data.star_count;
        resource.starred = result.data.starred;
      }
      renderResourceList();
      showToast(result.data.starred ? "已收藏" : "已取消收藏", "success");
    }
  } catch (error) {
    if (session === currentUser?.token) showToast('收藏失败：' + error.message);
  } finally { pendingResourceStars.delete(resourceId); }
}

/* ===================================================================
   文件预览
   =================================================================== */
function getFileExtension(name) {
  return (name || "").split(".").pop().toLowerCase();
}
function isPreviewableType(ext) {
  return [
    "pdf",
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "svg",
    "bmp",
    "txt",
    "md",
    "csv",
    "json",
    "xml",
    "yaml",
    "log",
    "html",
    "htm",
  ].includes(ext);
}

async function openResourcePreview(resource, opener = document.activeElement) {
  const fileUrl = safeFileUrl(resource.file_url);
  if (!fileUrl) { showToast('资源地址无效，无法预览'); return; }
  const escapedUrl = escapeHtml(fileUrl);
  const requestId = ++resourcePreviewId;
  resourcePreviewController?.abort();
  const controller = new AbortController();
  resourcePreviewController = controller;
  const ext = getFileExtension(resource.file_name);
  const modal = document.createElement("div");
  modal.className = "custom-modal-overlay preview-overlay";
  modal.restoreFocusTarget = () => opener?.isConnected ? opener : document.querySelector(`.preview-btn[data-id="${Number(resource.id)}"]`);
  let previewHtml = "";
  if (ext === "pdf")
    previewHtml = `<iframe src="${escapedUrl}" class="preview-iframe" title="${escapeHtml(resource.title)}" sandbox="allow-same-origin"></iframe>`;
  else if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext))
    previewHtml = `<img src="${escapedUrl}" class="preview-img" alt="${escapeHtml(resource.title)}" />`;
  else if (["txt", "md", "csv", "json", "xml", "yaml", "log"].includes(ext)) {
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await fetch(fileUrl, { signal: controller.signal });
      if (!r.ok) throw new Error('文件不存在或暂时不可用');
      const text = await r.text();
      previewHtml = `<pre class="preview-text">${escapeHtml(text)}</pre>`;
    } catch {
      previewHtml = `<p class="preview-error">无法加载文件内容</p>`;
    } finally { clearTimeout(timeout); }
  } else if (["html", "htm"].includes(ext))
    previewHtml = `<iframe src="${escapedUrl}" class="preview-iframe" title="${escapeHtml(resource.title)}" sandbox="" referrerpolicy="no-referrer"></iframe>`;
  else
    previewHtml = `<div class="preview-unsupported"><span class="preview-unsupported-icon">📄</span><p>暂不支持预览此类型文件</p><p class="preview-hint">可下载后查看</p></div>`;
  if (requestId !== resourcePreviewId) return;
  activeResourceModal?.remove();
  activeResourceModal = modal;
  modal.innerHTML = `
    <div class="custom-modal-content preview-modal">
      <button type="button" class="custom-modal-close" aria-label="关闭预览">×</button>
      <h2 class="preview-title">${escapeHtml(resource.title)}</h2>
      <div class="preview-body">${previewHtml}</div>
      <div class="preview-footer">
        <span class="preview-file-info">${escapeHtml(resource.file_name)} · ${escapeHtml(resource.category)}</span>
        <a href="${escapedUrl}" class="toggle-btn" download rel="noopener" style="text-decoration:none;">下载文件 ↓</a>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal
    .querySelector(".custom-modal-close")
    .addEventListener("click", () => modal.remove());
  const previewImg = modal.querySelector(".preview-img");
  if (previewImg) {
    let scale = 1;
    previewImg.style.transform = `scale(${scale})`;
    previewImg.style.transformOrigin = "top center";
    previewImg.style.cursor = "zoom-in";
    previewImg.addEventListener("wheel", (e) => {
      e.preventDefault();
      scale += e.deltaY > 0 ? -0.15 : 0.15;
      scale = Math.min(Math.max(scale, 0.3), 5);
      previewImg.style.transform = `scale(${scale})`;
      previewImg.style.cursor = scale > 1 ? "zoom-out" : "zoom-in";
    });
  }
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });
}

/* ===================================================================
   渲染
   =================================================================== */
function renderResourceList() {
  const list = document.querySelector("#resource-list");
  if (!list) return;
  if (!resources.length) {
    list.innerHTML = '<div class="studio-empty"><span class="studio-empty-mark" aria-hidden="true">↗</span><h3>为下一次发现，留一个位置。</h3><p>这个分类还没有资源，换一个分类看看。</p></div>';
    return;
  }
  const categoryLabels = {
    PPT: "📊",
    课件: "📖",
    学习笔记: "📝",
    电子书: "📚",
    其他: "📁",
  };
  let html = "";
  for (const r of resources) {
    const starClass = r.starred ? "starred" : "";
    const starText = r.starred ? "★" : "☆";
    const deleteBtnHtml = isOwner()
      ? `<button class="delete-card-btn" data-id="${r.id}">删除</button>`
      : "";
    const catIcon = categoryLabels[r.category] || "📁";
    html += `
      <article class="blog-card">
        <div class="card-meta">
          <span class="card-date">${formatPostDate(r.created_at)}</span>
          <button type="button" class="star-btn-card ${starClass}" data-id="${r.id}" data-action="star" aria-label="${r.starred ? '取消收藏' : '收藏资源'}">${starText} <span class="star-count">${r.star_count || 0}</span></button>
        </div>
        <span class="resource-type" aria-hidden="true">${escapeHtml(getFileExtension(r.file_name).toUpperCase() || "FILE")}</span><h2 class="card-title">${escapeHtml(r.title)}</h2>
        <p class="card-content">${convertForPreview(r.description || "")}</p>
        <span class="category-badge">${escapeHtml(r.category)}</span>
        <div class="card-footer">
          <button class="toggle-btn preview-btn" data-id="${r.id}">翻阅资源 ↗</button>
          ${deleteBtnHtml}
        </div>
      </article>`;
  }
  list.innerHTML = html;
}

/* ===================================================================
   分类栏 — 不替换 innerHTML，只切换 active class
   =================================================================== */
function refreshCategoryBar() {
  document.querySelectorAll(".category-bar .cat-btn").forEach((btn) => {
    const cat = btn.getAttribute("data-cat");
    btn.classList.toggle("active", cat === currentCategory);
  });
}

// 事件委托（脚本在 body 底部，DOM 已就绪，直接绑定）
document.querySelector(".category-bar")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".cat-btn");
  if (!btn) return;
  currentCategory = btn.getAttribute("data-cat") || "";
  refreshCategoryBar();
  loadResources(currentCategory);
});

/* ===================================================================
   交互
   =================================================================== */
function initInteractions() {
  document
    .querySelector("#resource-list")
    ?.addEventListener("click", async (e) => {
      const deleteBtn = e.target.closest(".delete-card-btn");
      if (deleteBtn) {
        e.stopPropagation();
        if (!isLoggedIn()) {
          showToast("请先登录后再删除。");
          openAuthModal("login");
          return;
        }
        if (!isOwner()) {
          showToast("仅博主可删除资源。");
          return;
        }
        const id = deleteBtn.getAttribute("data-id");
        if (deleteBtn.disabled || !await (typeof GardenUI !== "undefined" ? GardenUI.confirm({title:"移出这份珍藏？",message:"资源记录会被删除，此操作无法撤销。",confirmText:"删除资源",danger:true}) : confirm("确定删除？"))) return;
        deleteBtn.disabled = true;
        try {
          await requestJson(`${API_BASE}/api/v1/resources/${id}`, {
            method: "DELETE",
            headers: getAuthHeaders(),
          });
          loadResources(currentCategory);
        } catch (error) { showToast('删除失败：' + error.message); }
        finally { deleteBtn.disabled = false; }
        return;
      }
      const starBtn = e.target.closest("[data-action='star']");
      if (starBtn) {
        e.stopPropagation();
        await toggleResourceStar(parseInt(starBtn.getAttribute("data-id")));
        return;
      }
      const previewBtn = e.target.closest(".preview-btn");
      if (previewBtn) {
        const id = parseInt(previewBtn.getAttribute("data-id"));
        const resource = resources.find((r) => r.id === id);
        if (resource && !previewBtn.disabled) {
          previewBtn.disabled = true; previewBtn.textContent = "正在展开…";
          try { await openResourcePreview(resource, previewBtn); }
          finally { previewBtn.disabled = false; previewBtn.textContent = "翻阅资源 ↗"; }
        }
        return;
      }
    });

  document
    .querySelector("#upload-section")
    ?.classList.toggle("hidden", !isOwner());
  document.querySelector("#resource-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    submitResource(e.target);
  });

  refreshCategoryBar();
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
  // login events that fire while loadSiteConfig / loadResources are pending
  document.addEventListener("auth-changed", () => {
    document
      .querySelector("#upload-section")
      ?.classList.toggle("hidden", !isOwner());
    loadResources(currentCategory);
  });
  window.addEventListener('pagehide', () => {
    resourceLoadId++;
    resourcePreviewId++;
    resourcePreviewController?.abort();
    activeResourceModal?.remove();
  });
  await loadSiteConfig();
  updateAuthUI();
  document
    .querySelector("#upload-section")
    ?.classList.toggle("hidden", !isOwner());
}

init();
