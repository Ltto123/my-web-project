/**
 * herb.js — 中药识别页面
 * 依赖 common.js：常量、工具函数、认证、主题
 */

const HERB_CLASSES = [
  "僵蚕","党参","天南星","枸杞","槐花","牛蒡子","牡丹皮",
  "猪苓","甘草","百合","百部","竹叶","竹茹","紫草",
  "红藤","艾叶","荆芥","金银花","黄柏","黄芪",
];

/* ===================================================================
   中药种类
   =================================================================== */
async function loadHerbClasses() {
  try {
    const resp = await fetch(`${API_BASE}/api/v1/herb/classes`);
    const result = await resp.json();
    if (result.code === 0 && Array.isArray(result.data)) return result.data;
  } catch { /* fallback */ }
  return HERB_CLASSES;
}

async function renderClassGrid() {
  const classes = await loadHerbClasses();
  const grid = document.querySelector("#class-grid");
  if (!grid) return;
  grid.innerHTML = classes.map((name) => `<span class="herb-class-tag">${escapeHtml(name)}</span>`).join("");
}

/* ===================================================================
   拖拽 & 预览
   =================================================================== */
function initFilePreview() {
  const fileInput = document.querySelector("#herb-file");
  const dropZone = document.querySelector("#herb-drop-zone");
  const placeholder = document.querySelector("#herb-drop-placeholder");
  const previewImg = document.querySelector("#preview-img");
  if (!dropZone || !fileInput) return;

  dropZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) showPreview(file, placeholder, previewImg);
  });

  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add("drag-over"); });
  dropZone.addEventListener("dragleave", (e) => { e.preventDefault(); e.stopPropagation(); if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove("drag-over"); });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault(); e.stopPropagation();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      const dt = new DataTransfer(); dt.items.add(file);
      fileInput.files = dt.files;
      showPreview(file, placeholder, previewImg);
    }
  });

  document.addEventListener("dragover", (e) => { if (!dropZone.contains(e.target)) e.preventDefault(); });
  document.addEventListener("drop", (e) => { if (!dropZone.contains(e.target)) e.preventDefault(); });
}

function showPreview(file, placeholder, previewImg) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    if (previewImg) { previewImg.src = e.target.result; previewImg.classList.remove("hidden"); }
    if (placeholder) placeholder.classList.add("hidden");
  };
  reader.readAsDataURL(file);
}

/* ===================================================================
   预测
   =================================================================== */
async function handlePredict() {
  const fileInput = document.querySelector("#herb-file");
  const file = fileInput?.files[0];
  const loadingArea = document.querySelector("#loading-area");
  const resultSection = document.querySelector("#result-section");
  if (!file) { alert("请先选择一张中药图片"); return; }
  if (file.size > 10 * 1024 * 1024) { alert("图片大小不能超过 10MB"); return; }
  loadingArea?.classList.remove("hidden");
  resultSection?.classList.add("hidden");

  const modelName = document.querySelector("#herb-model")?.value || "MobileNetV3-Large";
  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", modelName);

  try {
    const resp = await fetch(`${API_BASE}/api/v1/herb/predict`, { method: "POST", body: formData });
    const result = await resp.json();
    loadingArea?.classList.add("hidden");
    if (result.code === 0) { renderResult(result.data); resultSection?.classList.remove("hidden"); }
    else alert("识别失败：" + (result.msg || "未知错误"));
  } catch (e) {
    loadingArea?.classList.add("hidden");
    alert("网络请求失败：" + e.message);
  }
}

function renderResult(data) {
  const container = document.querySelector("#result-content");
  if (!container) return;
  const { prediction, confidence, top3, model_used } = data;
  const rankEmoji = ["🥇","🥈","🥉"];
  const barColors = ["#16a34a","#2563eb","#9333ea"];
  let html = `
    <div class="herb-result-primary">
      <div class="herb-name">🔮 ${escapeHtml(prediction)}</div>
      <div class="herb-confidence">置信度：${confidence}% · 模型：${escapeHtml(model_used || "")}</div>
      <div class="herb-confidence-bar"><div class="herb-confidence-fill" style="width:${confidence}%"></div></div>
    </div>`;
  if (top3?.length) {
    html += '<ul class="herb-top3-list">';
    for (const item of top3) {
      html += `
        <li class="herb-top3-item">
          <span class="herb-top3-rank">${rankEmoji[item.rank - 1] || ""}</span>
          <span class="herb-top3-name">${escapeHtml(item.class)}</span>
          <span class="herb-top3-bar-wrap">
            <span class="herb-top3-bar"><span class="herb-top3-fill" style="width:${item.confidence}%;background:${barColors[item.rank - 1] || barColors[0]};"></span></span>
            <span class="herb-top3-percent">${item.confidence}%</span>
          </span>
        </li>`;
    }
    html += "</ul>";
  }
  container.innerHTML = html;
}

/* ===================================================================
   初始化
   =================================================================== */
async function init() {
  loadUserSession();
  initAuthInteractions();
  initThemeToggle();
  await loadSiteConfig();
  updateAuthUI();
  initFilePreview();
  document.querySelector("#predict-btn")?.addEventListener("click", handlePredict);
  await renderClassGrid();
}

init();
