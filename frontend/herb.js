/**
 * herb.js — 中药识别页面
 * 依赖 common.js：常量、工具函数、认证、主题
 */

const HERB_CLASSES = [
  "僵蚕",
  "党参",
  "天南星",
  "枸杞",
  "槐花",
  "牛蒡子",
  "牡丹皮",
  "猪苓",
  "甘草",
  "百合",
  "百部",
  "竹叶",
  "竹茹",
  "紫草",
  "红藤",
  "艾叶",
  "荆芥",
  "金银花",
  "黄柏",
  "黄芪",
];
let herbInputVersion = 0;
let herbPreviewVersion = 0;
let predictionController = null;

function setPredictBusy(busy) {
  const button = document.querySelector('#predict-btn');
  if (button) { button.disabled = busy; button.setAttribute('aria-busy', String(busy)); }
  document.querySelector('#loading-area')?.classList.toggle('hidden', !busy);
}

function invalidatePrediction() {
  herbInputVersion++;
  predictionController?.abort();
  predictionController = null;
  setPredictBusy(false);
  document.querySelector('#result-section')?.classList.add('hidden');
}

/* ===================================================================
   中药种类
   =================================================================== */
async function loadHerbClasses() {
  try {
    const result = await requestJson(`${API_BASE}/api/v1/herb/classes`);
    if (result.code === 0 && Array.isArray(result.data)) return result.data;
  } catch {
    /* fallback */
  }
  return HERB_CLASSES;
}

async function renderClassGrid() {
  const classes = await loadHerbClasses();
  const grid = document.querySelector("#class-grid");
  if (!grid) return;
  grid.innerHTML = classes
    .map((name) => `<span class="herb-class-tag">${escapeHtml(name)}</span>`)
    .join("");
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
  dropZone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) showPreview(file, placeholder, previewImg);
    else {
      herbPreviewVersion++;
      invalidatePrediction();
      previewImg?.classList.add('hidden');
      placeholder?.classList.remove('hidden');
    }
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dropZone.contains(e.relatedTarget))
      dropZone.classList.remove("drag-over");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      showPreview(file, placeholder, previewImg);
    }
  });

  document.addEventListener("dragover", (e) => {
    if (!dropZone.contains(e.target)) e.preventDefault();
  });
  document.addEventListener("drop", (e) => {
    if (!dropZone.contains(e.target)) e.preventDefault();
  });
}

function showPreview(file, placeholder, previewImg) {
  invalidatePrediction();
  const version = ++herbPreviewVersion;
  previewImg?.classList.add('hidden');
  placeholder?.classList.remove('hidden');
  if (!file || !file.type.startsWith('image/')) { showToast('请选择有效的图片文件'); return; }
  if (file.size > 10 * 1024 * 1024) { showToast('图片大小不能超过 10MB'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    if (version !== herbPreviewVersion) return;
    if (previewImg) {
      previewImg.src = e.target.result;
      previewImg.classList.remove("hidden");
    }
    if (placeholder) placeholder.classList.add("hidden");
  };
  reader.onerror = () => { if (version === herbPreviewVersion) showToast('图片读取失败，请重新选择'); };
  reader.readAsDataURL(file);
}

/* ===================================================================
   粘贴图片
   =================================================================== */
function initPasteSupport() {
  const dropZone = document.querySelector("#herb-drop-zone");
  if (!dropZone) return;
  document.addEventListener("paste", (e) => {
    if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
    if (!document.querySelector("#herb-drop-zone")) return; // only on herb page
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        const dt = new DataTransfer();
        dt.items.add(file);
        const fileInput = document.querySelector("#herb-file");
        if (fileInput) {
          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event("change"));
          showToast("图片已粘贴，点击「开始识别」", "success");
        }
        break;
      }
    }
  });
}

/* ===================================================================
   预测
   =================================================================== */
async function handlePredict() {
  if (predictionController) return;
  const fileInput = document.querySelector("#herb-file");
  const file = fileInput?.files[0];
  const resultSection = document.querySelector("#result-section");
  if (!file) {
    showToast("请先选择一张中药图片");
    return;
  }
  if (!file.type.startsWith('image/')) { showToast('请选择有效的图片文件'); return; }
  if (file.size > 10 * 1024 * 1024) {
    showToast("图片大小不能超过 10MB");
    return;
  }
  setPredictBusy(true);
  resultSection?.classList.add("hidden");

  const modelName =
    document.querySelector("#herb-model")?.value || "MobileNetV3-Large";
  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", modelName);
  const version = herbInputVersion;
  const controller = new AbortController();
  predictionController = controller;

  try {
    const result = await requestJson(`${API_BASE}/api/v1/herb/predict`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
      timeout: 120000,
    });
    if (version !== herbInputVersion || predictionController !== controller) return;
    renderResult(result.data);
    resultSection?.classList.remove('hidden');
  } catch (e) {
    if (version === herbInputVersion && !controller.signal.aborted) showToast('识别失败：' + e.message);
  } finally {
    if (predictionController === controller) { predictionController = null; setPredictBusy(false); }
  }
}

function renderResult(data) {
  const container = document.querySelector("#result-content");
  if (!container) return;
  const { prediction, top3, model_used } = data;
  const confidence = Math.min(100, Math.max(0, Number(data.confidence) || 0));
  const rankLabels = ["01", "02", "03"];
  const barColors = ['var(--c-primary)', 'var(--c-amber)', 'var(--c-text-3)'];
  let html = `
    <div class="herb-result-primary">
      <div class="herb-name">${escapeHtml(prediction)}</div>
      <div class="herb-confidence">置信度：${confidence}% · 模型：${escapeHtml(model_used || "")}</div>
      <div class="herb-confidence-bar"><div class="herb-confidence-fill" style="width:${confidence}%"></div></div>
    </div>`;
  if (top3?.length) {
    html += '<ul class="herb-top3-list">';
    for (const item of top3) {
      const itemConfidence = Math.min(100, Math.max(0, Number(item.confidence) || 0));
      html += `
        <li class="herb-top3-item">
          <span class="herb-top3-rank">${rankLabels[item.rank - 1] || ""}</span>
          <span class="herb-top3-name">${escapeHtml(item.class)}</span>
          <span class="herb-top3-bar-wrap">
            <span class="herb-top3-bar"><span class="herb-top3-fill" style="width:${itemConfidence}%;background:${barColors[item.rank - 1] || barColors[0]};"></span></span>
            <span class="herb-top3-percent">${itemConfidence}%</span>
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
  initFilePreview();
  initPasteSupport();
  document
    .querySelector("#predict-btn")
    ?.addEventListener("click", handlePredict);
  document.querySelector('#herb-model')?.addEventListener('change', invalidatePrediction);
  window.addEventListener('pagehide', () => { herbPreviewVersion++; invalidatePrediction(); });
  await loadSiteConfig();
  updateAuthUI();
  await renderClassGrid();
}

init();
