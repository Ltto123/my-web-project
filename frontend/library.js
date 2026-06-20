/**
 * library.js — 资源库
 * 依赖 common.js：常量、工具函数、认证、主题、上传
 */

let resources = [];
let currentCategory = "";

/* ===================================================================
   API
   =================================================================== */
async function loadResources(category) {
  try {
    const params = category ? `?category=${encodeURIComponent(category)}` : "";
    const r = await fetch(`${API_BASE}/api/v1/resources${params}`, { headers: getAuthHeaders() });
    const result = await r.json();
    if (result.code === 0) { resources = result.data; renderResourceList(); }
  } catch { /* ignore */ }
}

async function uploadResourceFile(file) {
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

async function submitResource(form) {
  const title = form.querySelector("#resource-title").value.trim();
  const desc = form.querySelector("#resource-desc").value.trim();
  const category = form.querySelector("#resource-category").value;
  const file = form.querySelector("#resource-file")?.files[0];
  if (!title || !category || !file) { alert("请填写完整信息"); return; }
  try {
    const fileUrl = await uploadResourceFile(file);
    const r = await fetch(`${API_BASE}/api/v1/resources`, {
      method: "POST", headers: getAuthHeaders(),
      body: JSON.stringify({ title, description: desc, category, file_url: fileUrl, file_name: file.name }),
    });
    const result = await r.json();
    if (result.code === 0) { form.reset(); loadResources(currentCategory); }
    else alert(result.msg);
  } catch (err) { alert("上传失败: " + err.message); }
}

async function toggleResourceStar(resourceId) {
  if (!isLoggedIn()) { alert("请先登录"); openAuthModal("login"); return; }
  try {
    const r = await fetch(`${API_BASE}/api/v1/resources/${resourceId}/star`, {
      method: "POST", headers: getAuthHeaders(),
    });
    const result = await r.json();
    if (result.code === 0) {
      const resource = resources.find(r => r.id === resourceId);
      if (resource) { resource.star_count = result.data.star_count; resource.starred = result.data.starred; }
      renderResourceList();
    }
  } catch { /* ignore */ }
}

/* ===================================================================
   文件预览
   =================================================================== */
function getFileExtension(name) { return (name || "").split(".").pop().toLowerCase(); }
function isPreviewableType(ext) { return ["pdf","jpg","jpeg","png","gif","webp","svg","bmp","txt","md","csv","json","xml","yaml","log","html","htm"].includes(ext); }

async function openResourcePreview(resource) {
  const ext = getFileExtension(resource.file_name);
  const modal = document.createElement("div");
  modal.className = "custom-modal-overlay";
  let previewHtml = "";
  if (ext === "pdf") previewHtml = `<iframe src="${resource.file_url}" class="preview-iframe"></iframe>`;
  else if (["jpg","jpeg","png","gif","webp","svg","bmp"].includes(ext)) previewHtml = `<img src="${resource.file_url}" class="preview-img" alt="${escapeHtml(resource.title)}" />`;
  else if (["txt","md","csv","json","xml","yaml","log"].includes(ext)) {
    try {
      const r = await fetch(resource.file_url);
      const text = await r.text();
      previewHtml = `<pre class="preview-text">${escapeHtml(text)}</pre>`;
    } catch { previewHtml = `<p class="preview-error">无法加载文件内容</p>`; }
  } else if (["html","htm"].includes(ext)) previewHtml = `<iframe src="${resource.file_url}" class="preview-iframe"></iframe>`;
  else previewHtml = `<div class="preview-unsupported"><span class="preview-unsupported-icon">📄</span><p>暂不支持预览此类型文件</p><p class="preview-hint">可下载后查看</p></div>`;
  modal.innerHTML = `
    <div class="custom-modal-content preview-modal">
      <span class="custom-modal-close">×</span>
      <h2 class="preview-title">${escapeHtml(resource.title)}</h2>
      <div class="preview-body">${previewHtml}</div>
      <div class="preview-footer">
        <span class="preview-file-info">${escapeHtml(resource.file_name)} · ${escapeHtml(resource.category)}</span>
        <a href="${resource.file_url}" class="toggle-btn" download style="text-decoration:none;">⬇ 下载</a>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector(".custom-modal-close").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
}

function renderMarkdownInline(text) {
  if (!text) return "";
  text = escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/`(.+?)`/g, "<code>$1</code>");
  return text;
}

/* ===================================================================
   渲染
   =================================================================== */
function renderResourceList() {
  const list = document.querySelector("#resource-list");
  if (!list) return;
  if (!resources.length) { list.innerHTML = '<p class="empty-posts">暂无资源</p>'; return; }
  const categoryLabels = { "PPT": "📊", "课件": "📖", "学习笔记": "📝", "电子书": "📚", "其他": "📁" };
  let html = "";
  for (const r of resources) {
    const starClass = r.starred ? "starred" : "";
    const starText = r.starred ? "⭐" : "☆";
    const deleteBtnHtml = isOwner() ? `<button class="delete-card-btn" data-id="${r.id}">🗑️ 删除</button>` : "";
    const catIcon = categoryLabels[r.category] || "📁";
    html += `
      <article class="blog-card">
        <div class="card-meta">
          <span class="card-date">${formatPostDate(r.created_at)}</span>
          <span class="star-btn-card ${starClass}" data-id="${r.id}" data-action="star">${starText} <span class="star-count">${r.star_count || 0}</span></span>
        </div>
        <h2 class="card-title">${catIcon} ${escapeHtml(r.title)}</h2>
        <p class="card-content">${renderMarkdownInline(r.description)}</p>
        <span class="category-badge">${escapeHtml(r.category)}</span>
        <div class="card-footer">
          <button class="toggle-btn preview-btn" data-id="${r.id}">👁️ 预览</button>
          ${deleteBtnHtml}
        </div>
      </article>`;
  }
  list.innerHTML = html;
}

/* ===================================================================
   分类栏
   =================================================================== */
function initCategoryBar() {
  const CATEGORIES = ["全部", "PPT", "课件", "学习笔记", "电子书", "其他"];
  const bar = document.querySelector("#category-bar");
  if (!bar) return;
  bar.innerHTML = CATEGORIES.map(c => {
    const val = c === "全部" ? "" : c;
    const active = val === currentCategory ? "active" : "";
    return `<button class="cat-btn ${active}" data-cat="${val}">${c}</button>`;
  }).join("");
  bar.querySelectorAll(".cat-btn").forEach(btn => {
    btn.addEventListener("click", () => { currentCategory = btn.getAttribute("data-cat"); loadResources(currentCategory); initCategoryBar(); });
  });
}

/* ===================================================================
   交互
   =================================================================== */
function initInteractions() {
  document.querySelector("#resource-list")?.addEventListener("click", async (e) => {
    const deleteBtn = e.target.closest(".delete-card-btn");
    if (deleteBtn) {
      e.stopPropagation();
      if (!isOwner()) return;
      const id = deleteBtn.getAttribute("data-id");
      if (!confirm("确定删除？")) return;
      try {
        const r = await fetch(`${API_BASE}/api/v1/resources/${id}`, { method: "DELETE", headers: getAuthHeaders() });
        const result = await r.json();
        if (result.code === 0) loadResources(currentCategory);
        else alert(result.msg);
      } catch { alert("网络错误"); }
      return;
    }
    const starBtn = e.target.closest("[data-action='star']");
    if (starBtn) { e.stopPropagation(); await toggleResourceStar(parseInt(starBtn.getAttribute("data-id"))); return; }
    const previewBtn = e.target.closest(".preview-btn");
    if (previewBtn) {
      const id = parseInt(previewBtn.getAttribute("data-id"));
      const resource = resources.find(r => r.id === id);
      if (resource) openResourcePreview(resource);
      return;
    }
  });

  document.querySelector("#upload-section")?.classList.toggle("hidden", !isOwner());
  document.querySelector("#resource-form")?.addEventListener("submit", (e) => { e.preventDefault(); submitResource(e.target); });

  initCategoryBar();
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
  document.querySelector("#upload-section")?.classList.toggle("hidden", !isOwner());
  await loadResources(currentCategory);
}

init();
