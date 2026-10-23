/**
 * vocab.js — 不背单词页面
 * 依赖 common.js：常量、工具函数、认证、主题
 */

let vocabSets = [];
let vocabSetsLoaded = false;
let selectedSet = null;
let currentWords = [];
let currentIdx = 0;
let cardFlipped = false;
let reviewQueue = [];
let roundNum = 0;
let totalLearned = 0;
let totalWrong = 0;
let vocabProgress = {};   // {wordId: {stage, correct_count, ...}}
let spellWords = [];
let spellIdx = 0;
let spellStats = { correct: 0, wrong: 0 };
let currentMode = 'learn'; // 'learn' | 'spelling' | 'review'
let activePollInterval = null;
let uploadGeneration = 0;
let parsePollGeneration = 0;
let parsePollingGeneration = null;
let watchedImportSetId = null;
const parsePollErrors = new Map();
const deletingVocabSets = new Set();
let viewGeneration = 0;
let listRequestId = 0;
let detailRequestId = 0;
let transitionTimer = null;
let interactionBusy = false;
let cardKnew = true;
let cardPreviewed = false;
let importedSetId = null;
let authSession = '';
let requestGeneration = 0;
const activeVocabRequests = new Set();
const pendingProgressWrites = new Map();

function vocabSession() {
  return isLoggedIn() ? `${currentUser.user_id}:${currentUser.token}` : '';
}

// 每次操作绑定发起时的帐号与学习视图，迟到的响应不能写回新页面。
function isCurrentVocabOperation(generation, session) {
  return generation === viewGeneration && session === vocabSession();
}

function cancelLearningTransition() {
  viewGeneration++;
  if (transitionTimer !== null) clearTimeout(transitionTimer);
  transitionTimer = null;
  setLearningBusy(false);
}

function setLearningBusy(busy) {
  interactionBusy = busy;
  ['#btn-know', '#btn-unknown', '#btn-again', '#btn-pass', '#btn-next-only',
    '#btn-spell-submit', '#btn-spell-skip', '#spell-input'].forEach(selector => {
    const control = document.querySelector(selector);
    if (control) control.disabled = busy;
  });
}

function scheduleLearningTransition(action, delay) {
  if (transitionTimer !== null) clearTimeout(transitionTimer);
  const generation = viewGeneration;
  const session = vocabSession();
  transitionTimer = setTimeout(() => {
    transitionTimer = null;
    if (!isCurrentVocabOperation(generation, session)) return;
    setLearningBusy(false);
    action();
  }, delay);
}

function stopUploadPolling() {
  uploadGeneration++;
  parsePollGeneration++;
  if (activePollInterval !== null) clearTimeout(activePollInterval);
  activePollInterval = null;
  parsePollingGeneration = null;
  parsePollErrors.clear();
  deletingVocabSets.clear();
  const button = document.querySelector('#vocab-upload-btn');
  if (button) button.disabled = false;
}

function resetLearningState() {
  cancelLearningTransition();
  detailRequestId++;
  selectedSet = null;
  currentWords = [];
  currentIdx = 0;
  vocabProgress = {};
  spellWords = [];
  spellIdx = 0;
  spellStats = { correct: 0, wrong: 0 };
  reviewQueue = [];
  cardFlipped = false;
  currentMode = 'learn';
  document.querySelector('#vocab-intro')?.classList.remove('hidden');
  document.querySelector('#vocab-review-empty')?.classList.add('hidden');
  document.body?.classList.remove('vocab-focus-mode');
  document.querySelector('#vocab-learn-section')?.classList.add('hidden');
  document.querySelector('#vocab-sets-section')?.classList.remove('hidden');
  // 清掉隐藏 DOM 中的私人内容，防止退出后仍可通过页面恢复读取。
  ['#vocab-set-title', '#vocab-card-front', '#vocab-card-back', '#spell-def-zh',
    '#spell-def-en', '#spell-pos-tag', '#spell-result', '#vocab-complete-stats'].forEach(selector => {
    const node = document.querySelector(selector);
    if (node) node.textContent = '';
  });
  const input = document.querySelector('#spell-input');
  if (input) input.value = '';
}

function clearVocabSessionState() {
  requestGeneration++;
  listRequestId++;
  stopUploadPolling();
  resetLearningState();
  activeVocabRequests.forEach(controller => controller.abort());
  activeVocabRequests.clear();
  vocabSets = [];
  vocabSetsLoaded = false;
  const grid = document.querySelector('#vocab-sets-grid');
  if (grid) grid.textContent = '';
  importedSetId = null;
  watchedImportSetId = null;
  document.querySelector('#vocab-import-start')?.classList.add('hidden');
  if (window.GardenUI) window.GardenUI.closePanel(document.querySelector('#vocab-upload-section'));
  const status = document.querySelector('#vocab-upload-status');
  if (status) status.textContent = '';
  ['#vocab-file-input', '#vocab-set-name'].forEach(selector => {
    const input = document.querySelector(selector);
    if (input) input.value = '';
  });
  updateVocabFileName();
}

async function requestVocab(path, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  activeVocabRequests.add(controller);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  // 仅为一次短请求提示忙碌；后台解析轮询与上传已有页内进度。
  const showActivity = path !== '/sets/upload' && !path.endsWith('/status');
  if (showActivity) document.dispatchEvent(new CustomEvent('request-start'));
  try {
    const response = await fetch(`${API_BASE}/api/v1/vocab${path}`, {
      ...options, signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok || result.code !== 0) {
      const error = new Error(result.msg || result.detail || '请求失败，请稍后重试');
      error.code = result.code || response.status;
      throw error;
    }
    return result.data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求已取消或超时，请重试');
    throw error;
  } finally {
    clearTimeout(timeout);
    activeVocabRequests.delete(controller);
    if (showActivity) document.dispatchEvent(new CustomEvent('request-end'));
  }
}

/* ===================================================================
   Init
   =================================================================== */

async function init() {
  loadUserSession();
  authSession = vocabSession();
  initAuthInteractions();
  initThemeToggle();
  // Register auth-changed listener BEFORE any await — ensures it catches
  // login events that fire while loadSiteConfig / loadSets are pending
  document.addEventListener('auth-changed', () => {
    const nextSession = vocabSession();
    if (nextSession === authSession) { toggleOwnerUI(); return; }
    authSession = nextSession;
    clearVocabSessionState();
    toggleOwnerUI();
    loadSets();
  });
  window.addEventListener('pagehide', clearVocabSessionState);
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    loadUserSession();
    authSession = vocabSession();
    clearVocabSessionState();
    updateAuthUI();
    toggleOwnerUI();
    loadSets();
  });
  await loadSiteConfig();
  updateAuthUI();
  bindVocabEvents();
  toggleOwnerUI();
  await loadSets();
}

function toggleOwnerUI() {
  const section = document.querySelector('#vocab-upload-section');
  if (!isLoggedIn() || selectedSet) {
    if (window.GardenUI) window.GardenUI.closePanel(section);
    section?.classList.add('hidden');
  }
}

function openVocabImport() {
  if (!isLoggedIn()) { openAuthModal('login'); return; }
  const section = document.querySelector('#vocab-upload-section');
  section?.classList.remove('hidden');
  if (window.GardenUI) window.GardenUI.openPanel(section, { title: '导入单词集', eyebrow: 'GROW YOUR COLLECTION' });
  else { section?.classList.remove('hidden'); document.querySelector('#vocab-file-input')?.focus(); }
}

function updateVocabFileName() {
  const input = document.querySelector('#vocab-file-input');
  const name = document.querySelector('#vocab-file-name');
  if (name) name.textContent = input?.files?.[0]?.name || '点击选择文件';
}

function toggleVocabPreview() {
  if (cardFlipped || interactionBusy || !selectedSet || !currentWords[currentIdx]) return;
  cardPreviewed = !cardPreviewed;
  document.querySelector('#vocab-card-inner').classList.toggle('flipped', cardPreviewed);
  document.querySelector('#vocab-card-front').setAttribute('aria-hidden', String(cardPreviewed));
  document.querySelector('#vocab-card-back').setAttribute('aria-hidden', String(!cardPreviewed));
  const button = document.querySelector('#vocab-peek-btn');
  if (button) { button.setAttribute('aria-pressed', String(cardPreviewed)); button.innerHTML = `${cardPreviewed ? '返回单词' : '查看释义'} <kbd>Space</kbd>`; }
}

/* ===================================================================
   Event Bindings
   =================================================================== */

function bindVocabEvents() {
  document.querySelector('#vocab-import-open')?.addEventListener('click', openVocabImport);
  document.querySelector('#vocab-file-input')?.addEventListener('change', updateVocabFileName);
  document.querySelector('#vocab-peek-btn')?.addEventListener('click', toggleVocabPreview);
  document.querySelector('#vocab-review-learn')?.addEventListener('click', () => switchMode('learn'));
  document.querySelector('#vocab-import-start')?.addEventListener('click', () => {
    if (importedSetId === null) return;
    if (window.GardenUI) window.GardenUI.closePanel(document.querySelector('#vocab-upload-section'));
    enterSet(importedSetId);
  });
  // Upload
  document.querySelector('#vocab-upload-btn')?.addEventListener('click', handleUpload);
  // Mode tabs
  document.querySelectorAll('.vocab-mode-tab').forEach(tab => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  });
  // Back to sets
  document.querySelector('#vocab-back-btn')?.addEventListener('click', showSets);
  // Know/Unknown buttons
  document.querySelector('#btn-unknown')?.addEventListener('click', () => handleKnow(false));
  document.querySelector('#btn-know')?.addEventListener('click', () => handleKnow(true));
  // Rating buttons
  document.querySelector('#btn-again')?.addEventListener('click', () => handleRating('again'));
  document.querySelector('#btn-pass')?.addEventListener('click', () => handleRating('pass'));
  // Spelling
  document.querySelector('#btn-spell-submit')?.addEventListener('click', handleSpellSubmit);
  document.querySelector('#btn-spell-skip')?.addEventListener('click', advanceSpell);
  document.querySelector('#spell-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSpellSubmit();
  });
  // Restart / spell start
  document.querySelector('#btn-vocab-restart')?.addEventListener('click', restartLearning);
  document.querySelector('#btn-vocab-spell-start')?.addEventListener('click', startSpelling);
  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboard);
}

function handleKeyboard(e) {
  if (document.querySelector('#vocab-learn-section')?.classList.contains('hidden')) return;
  if (e.target.closest?.('.custom-modal-overlay, #auth-modal') || e.repeat) return;
  // 弹窗打开时快捷键交由弹窗处理；输入拼写时仍可用 Escape 退出。
  if (document.querySelector('.custom-modal-overlay:not(.hidden), #auth-modal:not(.hidden)')) return;
  if (e.key === 'Escape') { e.preventDefault?.(); showSets(); return; }
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]') || interactionBusy) return;
  if (document.querySelector('#vocab-card-area')?.classList.contains('hidden')) return;
  if (e.key === ' ' && !e.target.closest?.('button, a')) { e.preventDefault?.(); toggleVocabPreview(); return; }
  if (currentMode === 'learn' || currentMode === 'review') {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault?.();
    if (!cardFlipped) {
      if (e.key === 'ArrowLeft') handleKnow(false);
      if (e.key === 'ArrowRight') handleKnow(true);
    } else {
      if (!cardKnew) { if (e.key === 'ArrowRight') advanceWord(); return; }
      if (e.key === 'ArrowLeft') handleRating('again');
      if (e.key === 'ArrowRight') handleRating('pass');
    }
  }
}

/* ===================================================================
   API Calls
   =================================================================== */

async function loadSets() {
  const grid = document.querySelector('#vocab-sets-grid');
  if (!grid) return;
  const requestId = ++listRequestId;
  const session = vocabSession();
  if (!vocabSetsLoaded && !vocabSets.length) grid.innerHTML = skeletonHTML(3);
  else grid.classList.add('is-refreshing');
  grid.querySelector('.list-load-feedback')?.remove();
  grid.setAttribute('aria-busy', 'true');
  try {
    const data = await requestVocab('/sets', { headers: getAuthHeaders() });
    if (requestId !== listRequestId || session !== vocabSession()) return;
    vocabSets = (data || []).filter(set => !deletingVocabSets.has(Number(set.id)));
    vocabSetsLoaded = true;
    parsePollErrors.clear();
    renderSets();
    renderWatchedImport();
    ensureParsePolling();
  } catch (e) {
    if (requestId !== listRequestId || session !== vocabSession()) return;
    let target = grid;
    if (vocabSetsLoaded || vocabSets.length) {
      target = document.createElement('div');
      target.className = 'empty-posts list-load-feedback';
      grid.prepend(target);
    }
    renderLoadError(target, '词集加载失败：' + e.message, loadSets);
  } finally {
    if (requestId === listRequestId) {
      grid.classList.remove('is-refreshing');
      grid.setAttribute('aria-busy', 'false');
    }
  }
}

// 导入任务与学习进度分开；刷新页面后由服务端持久状态恢复跟踪。
function isParsingSet(set) {
  return set?.status === 'processing' || set?.status === 'pending';
}

function parseElapsed(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return value >= 60 ? `${Math.floor(value / 60)} 分 ${value % 60} 秒` : `${value} 秒`;
}

function parseStatusHTML(set) {
  const failed = set.status === 'error';
  const completed = set.status === 'completed';
  const stageLabels = { queued: '等待处理', extracting: '读取文件', identifying: '识别词条', enriching: 'AI 解析', validating: '核对词条', saving: '保存词集', completed: '解析完成', error: '解析失败' };
  const stage = completed ? 'completed' : failed ? 'error' : (set.parse_stage || 'queued');
  const label = stageLabels[stage] || '正在处理';
  const total = Math.max(0, Math.floor(Number(set.total_words) || 0));
  const processed = Math.min(total, Math.max(0, Math.floor(Number(set.processed_words) || 0)));
  const totalBatches = Math.max(0, Math.floor(Number(set.total_batches) || 0));
  const completedBatches = Math.min(totalBatches, Math.max(0, Math.floor(Number(set.completed_batches) || 0)));
  const identifying = stage === 'identifying' && totalBatches > 0;
  const pct = Math.min(100, Math.max(0, Math.round(Number(identifying ? set.parse_stage_progress_pct : set.parse_progress_pct) || 0)));
  const aiKnown = identifying || (total > 0 && ['enriching', 'validating', 'saving', 'completed'].includes(stage));
  const stageIndex = { queued: 0, extracting: 0, identifying: 1, enriching: 2, validating: 3, saving: 3, completed: 4 }[stage];
  const steps = ['读取文件', '识别词条', 'AI 解析', '核对与保存'].map((step, index) =>
    `<li${index === stageIndex ? ' aria-current="step"' : ''} class="${index < stageIndex ? 'is-done' : ''}">${step}</li>`).join('');
  const monitor = parsePollErrors.get(Number(set.id));
  const message = failed ? (set.error_message || '解析未完成，请重新上传材料。') : (set.progress_message || '');
  const count = identifying ? `已识别 ${completedBatches} / ${totalBatches} 批` : total > 0 ? `已处理 ${processed} / ${total} 词` : '正在确认词条数量';
  const elapsed = set.elapsed_seconds == null ? '耗时未记录' : `已用时 ${parseElapsed(set.elapsed_seconds)}`;
  const progress = failed || completed ? '' : `<div class="vocab-parse-meter" role="progressbar" aria-label="${identifying ? 'AI 识别进度' : 'AI 解析进度'}" aria-valuemin="0" aria-valuemax="100"${aiKnown ? ` aria-valuenow="${pct}"` : ' aria-valuetext="等待确定词条数量"'}><span style="width:${aiKnown ? pct : 0}%"></span></div>`;
  return `<div class="vocab-parse-status${failed ? ' is-error' : ''}">
    <div class="vocab-parse-heading"><strong>${label}</strong>${aiKnown ? `<span>${identifying ? 'AI 识别' : 'AI'} ${pct}%</span>` : ''}</div>
    ${failed ? '' : `<ol class="vocab-parse-steps" aria-label="导入环节">${steps}</ol>`}
    ${progress}
    <p class="vocab-parse-count">${completed ? `已导入 ${Math.max(0, Number(set.word_count) || 0)} 个单词` : failed ? '请根据提示重新上传' : count}<span>${elapsed}</span></p>
    ${message ? `<p class="vocab-parse-message">${escapeHtml(message)}</p>` : ''}
    ${monitor ? `<p class="vocab-parse-network" role="status">${escapeHtml(monitor.message)}</p>${monitor.paused ? `<button type="button" class="vocab-parse-retry" data-retry-parse="${Number(set.id)}">重新查询状态</button>` : ''}` : ''}
  </div>`;
}

function renderWatchedImport() {
  const set = vocabSets.find(item => Number(item.id) === watchedImportSetId);
  if (!set) return;
  const status = document.querySelector('#vocab-upload-status');
  if (status) {
    status.classList.remove('hidden');
    status.innerHTML = `<strong class="vocab-parse-name">${escapeHtml(set.name)}</strong>${parseStatusHTML(set)}`;
    bindParseRetries(status);
  }
  const completed = set.status === 'completed' && Number(set.word_count) > 0;
  importedSetId = completed ? Number(set.id) : null;
  document.querySelector('#vocab-import-start')?.classList.toggle('hidden', !completed);
}

function bindParseRetries(root) {
  root.querySelectorAll('[data-retry-parse]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    parsePollErrors.delete(Number(button.dataset.retryParse));
    renderSets();
    renderWatchedImport();
    ensureParsePolling();
  }));
}

function ensureParsePolling() {
  if (!vocabSession() || activePollInterval !== null || parsePollingGeneration === parsePollGeneration) return;
  if (!vocabSets.some(set => isParsingSet(set) && !deletingVocabSets.has(Number(set.id)) && !parsePollErrors.get(Number(set.id))?.paused)) return;
  const generation = parsePollGeneration;
  const session = vocabSession();
  activePollInterval = setTimeout(() => pollParsingSets(generation, session), 2000);
}

async function pollParsingSets(generation, session) {
  activePollInterval = null;
  const isCurrent = () => generation === parsePollGeneration && session === vocabSession();
  if (!isCurrent()) return;
  parsePollingGeneration = generation;
  const ids = vocabSets.filter(set => isParsingSet(set) && !deletingVocabSets.has(Number(set.id)) && !parsePollErrors.get(Number(set.id))?.paused).map(set => Number(set.id));
  await Promise.all(ids.map(async id => {
    try {
      const result = await requestVocab(`/sets/${id}/status`, { headers: getAuthHeaders() });
      if (!isCurrent() || deletingVocabSets.has(id)) return;
      const set = vocabSets.find(item => Number(item.id) === id);
      if (!set || !isParsingSet(set)) return;
      if (!['processing', 'completed', 'error'].includes(result?.status)) throw new Error('状态响应不完整');
      Object.assign(set, result);
      parsePollErrors.delete(id);
      if (result.status === 'completed') showToast(`「${set.name}」解析完成，共 ${Number(set.word_count) || 0} 词`, 'success');
      else if (result.status === 'error') showToast(`「${set.name}」解析失败：${set.error_message || '请查看词集提示'}`);
    } catch (error) {
      if (!isCurrent() || deletingVocabSets.has(id) || !vocabSets.some(set => Number(set.id) === id)) return;
      const failures = (parsePollErrors.get(id)?.failures || 0) + 1;
      const paused = [401, 403, 404].includes(error.code) || failures >= 4;
      parsePollErrors.set(id, { failures, paused, message: paused
        ? '状态查询已暂停，请刷新词集列表或重新查询。后台任务可能仍在进行。'
        : `状态暂时无法查询，正在重试（${failures}/4）。显示的是上次进度。` });
    }
  }));
  if (!isCurrent()) return;
  parsePollingGeneration = null;
  renderSets();
  renderWatchedImport();
  ensureParsePolling();
}

function renderSets() {
  const grid = document.querySelector('#vocab-sets-grid');
  const focused = document.activeElement;
  let focusSelector = null;
  if (focused?.closest?.('#vocab-sets-grid')) {
    for (const [key, attribute] of [['openSet', 'data-open-set'], ['delSet', 'data-del-set'], ['retryParse', 'data-retry-parse']]) {
      if (focused.dataset?.[key] !== undefined && Number.isSafeInteger(Number(focused.dataset[key]))) {
        focusSelector = `[${attribute}="${Number(focused.dataset[key])}"]`;
        break;
      }
    }
  }
  const count = document.querySelector('#vocab-shelf-count');
  if (count) count.textContent = vocabSets.length ? String(vocabSets.length).padStart(2, '0') : '';
  if (!vocabSets.length) {
    grid.innerHTML = `<div class="vocab-shelf-empty"><span class="vocab-empty-art" aria-hidden="true">Aa<span>↗</span></span><div><span class="section-kicker">YOUR FIRST CHAPTER</span><h3>${isLoggedIn() ? '第一份词集，从这里开始。' : '为自己留一间语言练习室。'}</h3><p>${isLoggedIn() ? '导入课程词表、阅读笔记，或一份想学的单词清单。' : '登录后导入自己的词表，用卡片和拼写，一点点记住。'}</p><button type="button" class="toggle-btn" id="vocab-empty-import">${isLoggedIn() ? '导入第一份词集' : '登录并开始'} <span aria-hidden="true">↗</span></button></div></div>`;
    document.querySelector('#vocab-empty-import')?.addEventListener('click', openVocabImport);
    return;
  }
  let html = '';
  let index = 0;
  for (const s of vocabSets) {
    const pct = Math.min(100, Math.max(0, Number(s.progress_pct) || 0));
    const id = Number(s.id);
    if (!Number.isSafeInteger(id)) continue;
    const importing = isParsingSet(s) || s.status === 'error';
    index++;
    html += `
      <article class="blog-card vocab-set-card${importing ? ' vocab-set-importing' : ''}" data-set-id="${id}">
        <div class="vocab-book-top"><span class="vocab-book-number">${String(index).padStart(2, '0')} / WORD COLLECTION</span><span class="vocab-book-arrow" aria-hidden="true">↗</span></div>
        <h3><button type="button" class="card-open-btn" data-open-set="${id}" aria-controls="${importing ? 'vocab-upload-section' : 'vocab-learn-section'}"${importing ? ' aria-label="查看导入状态：' + escapeHtml(s.name) + '"' : ''}${deletingVocabSets.has(id) ? ' disabled' : ''}>${escapeHtml(s.name)}</button></h3>
        ${importing ? parseStatusHTML(s) : `<p class="vocab-book-count">${Number(s.word_count) || 0} <span>个单词 · ${pct > 0 ? '继续上次的积累' : '等待第一次探索'}</span></p>
        <div class="vocab-progress-bar"><div class="vocab-progress-fill" style="width:${pct}%"></div></div>`}
        <div class="vocab-book-bottom"><span>${importing ? (s.status === 'error' ? '导入未完成' : '完成后可开始学习') : `已掌握 <strong>${pct}%</strong>`}</span>
          ${(isLoggedIn() && (isOwner() || currentUser.user_id === s.user_id)) ? `<button type="button" class="delete-card-btn" data-del-set="${id}" aria-label="删除词集 ${escapeHtml(s.name)}"${deletingVocabSets.has(id) ? ' disabled' : ''}>删除</button>` : ''}
        </div>
      </article>`;
  }
  grid.innerHTML = html;
  bindParseRetries(grid);
  // Click to enter learning
  grid.querySelectorAll('.blog-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.delete-card-btn, [data-retry-parse]')) return;
      const setId = parseInt(card.dataset.setId);
      if (deletingVocabSets.has(setId)) return;
      enterSet(setId);
    });
  });
  // Delete buttons — only show for owner's own sets (or blog owner)
  grid.querySelectorAll('.delete-card-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!isLoggedIn()) { showToast('请先登录后再删除。'); openAuthModal('login'); return; }
      const setId = parseInt(btn.dataset.delSet);
      if (btn.disabled || deletingVocabSets.has(setId)) return;
      btn.disabled = true;
      const session = vocabSession();
      const confirmed = window.GardenUI ? await window.GardenUI.confirm({ title: '删除这个词集？', message: '词集中的单词和学习进度也会一起删除，此操作无法撤销。', confirmText: '删除词集', danger: true }) : confirm('确定删除这个单词集及其学习进度吗？');
      if (!confirmed || session !== vocabSession()) { btn.disabled = false; return; }
      try {
        deletingVocabSets.add(setId);
        detailRequestId++;
        await requestVocab(`/sets/${setId}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (session !== vocabSession()) return;
        vocabSets = vocabSets.filter(set => Number(set.id) !== setId);
        parsePollErrors.delete(setId);
        if (watchedImportSetId === setId) {
          watchedImportSetId = null;
          importedSetId = null;
          document.querySelector('#vocab-upload-status').textContent = '词集已删除。';
          document.querySelector('#vocab-import-start')?.classList.add('hidden');
        }
        renderSets();
        showToast('已删除', 'success');
        loadSets();
      } catch (error) {
        if (session === vocabSession()) showToast('删除失败：' + error.message);
      } finally { deletingVocabSets.delete(setId); btn.disabled = false; ensureParsePolling(); }
    });
  });
  if (focusSelector) grid.querySelector(focusSelector)?.focus({ preventScroll: true });
}

async function enterSet(setId) {
  resetLearningState();
  const requestId = ++detailRequestId;
  const session = vocabSession();
  if (!session) { showToast('请先登录'); openAuthModal('login'); return; }
  try {
    const data = await requestVocab(`/sets/${setId}`, { headers: getAuthHeaders() });
    if (requestId !== detailRequestId || session !== vocabSession()) return;
    if (isParsingSet(data) || data?.status === 'error') {
      const existing = vocabSets.find(set => Number(set.id) === Number(setId));
      if (existing) Object.assign(existing, data);
      else vocabSets.unshift(data);
      watchedImportSetId = Number(setId);
      renderSets();
      renderWatchedImport();
      openVocabImport();
      ensureParsePolling();
      return;
    }
    if (!data?.words?.length) { showToast('该单词集没有可学习的词条，请重新上传材料。'); return; }
    const progress = await loadProgress(setId);
    if (requestId !== detailRequestId || session !== vocabSession()) return;
    selectedSet = data;
    currentWords = [...data.words];
    vocabProgress = progress;
    // Show learn area
    document.querySelector('#vocab-intro')?.classList.add('hidden');
    document.body?.classList.add('vocab-focus-mode');
    if (window.GardenUI) window.GardenUI.closePanel(document.querySelector('#vocab-upload-section'));
    document.querySelector('#vocab-sets-section').classList.add('hidden');
    document.querySelector('#vocab-upload-section').classList.add('hidden');
    document.querySelector('#vocab-learn-section').classList.remove('hidden');
    document.querySelector('#vocab-set-title').textContent = selectedSet.name;
    switchMode('learn');
    const section = document.querySelector('#vocab-learn-section');
    section.focus({ preventScroll: true });
    section.scrollIntoView({ block: 'start', behavior: 'auto' });
  } catch (e) {
    if (requestId === detailRequestId && session === vocabSession()) showToast('加载失败: ' + e.message);
  }
}

async function showSets() {
  const returnSetId = selectedSet?.id;
  resetLearningState();
  const generation = viewGeneration;
  const session = vocabSession();
  toggleOwnerUI();
  await loadSets();
  if (!isCurrentVocabOperation(generation, session) || selectedSet) return;
  if (returnSetId != null) document.querySelector(`[data-open-set="${returnSetId}"]`)?.focus();
}

async function loadProgress(setId) {
  return await requestVocab(`/progress/${setId}`, { headers: getAuthHeaders() }) || {};
}

async function saveProgress(wordId, stage, correct, wrong) {
  await writeVocabProgress(wordId, '/progress', {
    word_id: wordId, stage, correct_count: correct, wrong_count: wrong,
  });
}

async function saveSpellProgress(wordId) {
  await writeVocabProgress(wordId, '/progress/spell', { word_id: wordId });
}

async function writeVocabProgress(wordId, path, payload) {
  const session = vocabSession();
  if (!session) throw new Error('请先登录以保存学习进度');
  const generation = requestGeneration;
  const key = `${session}:${wordId}`;
  const headers = getAuthHeaders();
  const previous = pendingProgressWrites.get(key) || Promise.resolve();
  // 切换模式后也按单词串行保存，防止旧的慢请求在较新进度之后提交。
  const write = previous.catch(() => {}).then(() => {
    if (session !== vocabSession() || generation !== requestGeneration) throw new Error('登录状态已变化，请重新进入词集');
    return requestVocab(path, { method: 'POST', headers, body: JSON.stringify(payload) });
  });
  pendingProgressWrites.set(key, write);
  try { await write; }
  finally { if (pendingProgressWrites.get(key) === write) pendingProgressWrites.delete(key); }
}

/* ===================================================================
   Upload
   =================================================================== */

async function handleUpload() {
  if (!isLoggedIn()) { showToast('请先登录后再上传。'); openAuthModal('login'); return; }
  const fileInput = document.querySelector('#vocab-file-input');
  const nameInput = document.querySelector('#vocab-set-name');
  const statusEl = document.querySelector('#vocab-upload-status');
  const btn = document.querySelector('#vocab-upload-btn');
  if (btn.disabled) return;
  const file = fileInput.files[0];
  if (!file) { showToast('请选择文件'); return; }

  const generation = ++uploadGeneration;
  const session = vocabSession();
  const isCurrentUpload = () => generation === uploadGeneration && session === vocabSession();
  btn.disabled = true;
  importedSetId = null;
  watchedImportSetId = null;
  document.querySelector('#vocab-import-start')?.classList.add('hidden');
  statusEl.classList.remove('hidden');
  statusEl.innerHTML = '<span class="vocab-spinner"></span> 上传材料 · 正在传送文件…';

  const formData = new FormData();
  formData.append('file', file);
  if (nameInput.value.trim()) formData.append('name', nameInput.value.trim());

  try {
    const result = await requestVocab('/sets/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + currentUser.token },
      body: formData,
    }, 60000);
    if (!isCurrentUpload()) return;

    const setId = Number(result.set_id);
    if (!Number.isSafeInteger(setId)) throw new Error('未取得导入任务编号，请刷新词集列表确认');
    const set = { ...result, id: setId, name: result.name || file.name, user_id: currentUser.user_id,
      status: result.status || 'processing', parse_stage: result.parse_stage || 'extracting', word_count: result.word_count || 0 };
    // 迟到的旧列表不能抹掉刚上传的任务，关闭工作台后书架继续显示状态。
    listRequestId++;
    const grid = document.querySelector('#vocab-sets-grid');
    grid?.classList.remove('is-refreshing');
    grid?.setAttribute('aria-busy', 'false');
    vocabSets = [set, ...vocabSets.filter(item => Number(item.id) !== setId)];
    vocabSetsLoaded = true;
    watchedImportSetId = setId;
    renderSets();
    renderWatchedImport();
    ensureParsePolling();
    fileInput.value = '';
    nameInput.value = '';
    const fileName = document.querySelector('#vocab-file-name');
    if (fileName) fileName.textContent = '点击选择文件';

  } catch (e) {
    if (!isCurrentUpload()) return;
    statusEl.textContent = '上传失败：' + e.message + '。请重试。';
    showToast('上传失败: ' + e.message);
  } finally {
    if (isCurrentUpload()) btn.disabled = false;
  }
}

/* ===================================================================
   Mode Switching
   =================================================================== */

function switchMode(mode) {
  if (!selectedSet || !['learn', 'spelling', 'review'].includes(mode)) return;
  cancelLearningTransition();
  currentMode = mode;
  document.querySelector('#vocab-review-empty')?.classList.add('hidden');
  document.querySelectorAll('.vocab-mode-tab').forEach(t => { t.classList.toggle('active', t.dataset.mode === mode); t.setAttribute('aria-pressed', String(t.dataset.mode === mode)); });
  const cardArea = document.querySelector('#vocab-card-area');
  const spellArea = document.querySelector('#vocab-spell-area');
  const completeArea = document.querySelector('#vocab-complete-area');

  cardArea.classList.add('hidden');
  spellArea.classList.add('hidden');
  completeArea.classList.add('hidden');

  if (mode === 'learn') startLearnMode();
  else if (mode === 'spelling') startSpelling();
  else if (mode === 'review') startReviewMode();
}

/* ===================================================================
   Learn Mode
   =================================================================== */

function startLearnMode() {
  if (!selectedSet) return;
  cancelLearningTransition();
  document.querySelector('#vocab-card-area').classList.remove('hidden');
  currentIdx = 0;
  cardFlipped = false;
  reviewQueue = [];
  roundNum = 0;
  totalLearned = 0;
  totalWrong = 0;
  // Shuffle words
  currentWords = shuffleArray([...selectedSet.words]);
  showCard();
  updateProgressBar();
  document.querySelector('#vocab-progress-text').textContent = `第 ${roundNum + 1} 轮 · ${currentWords.length} 词`;
}

function showCard() {
  if (currentIdx >= currentWords.length) { endRound(); return; }
  const word = currentWords[currentIdx];
  const inner = document.querySelector('#vocab-card-inner');
  const front = document.querySelector('#vocab-card-front');
  const back = document.querySelector('#vocab-card-back');
  const knowBtns = document.querySelector('#vocab-know-btns');
  const ratingRow = document.querySelector('#vocab-rating-row');

  // Reset flip without animation
  inner.style.transition = 'none';
  inner.classList.remove('flipped');
  cardFlipped = false;
  cardPreviewed = false;
  const peek = document.querySelector('#vocab-peek-btn');
  if (peek) { peek.classList.remove('hidden'); peek.setAttribute('aria-pressed', 'false'); peek.innerHTML = '查看释义 <kbd>Space</kbd>'; }
  front.setAttribute('aria-hidden', 'false');
  back.setAttribute('aria-hidden', 'true');
  inner.offsetHeight; // force reflow
  inner.style.transition = 'transform 0.6s cubic-bezier(0.4,0,0.2,1)';

  // Build front
  front.innerHTML = `
    <div class="vocab-word-big">${escapeHtml(word.word)}</div>
    ${word.pos ? `<div class="vocab-pos-tag">${escapeHtml(word.pos)}</div>` : ''}
    ${word.is_phrase ? '<div class="vocab-phrase-tag">短语</div>' : ''}
  `;

  // Build back
  let backHTML = `
    <div class="vocab-word-big" style="font-size:28px">${escapeHtml(word.word)}</div>
    ${word.pos ? `<div class="vocab-pos-tag">${escapeHtml(word.pos)}</div>` : ''}
    ${word.def_zh ? `<div class="vocab-def-zh">${escapeHtml(word.def_zh)}</div>` : ''}
    ${word.def_en ? `<div class="vocab-def-en">${escapeHtml(word.def_en)}</div>` : ''}
  `;
  if (word.example_en) {
    backHTML += `
      <div class="vocab-example-box">
        <div class="vocab-example-label">IN CONTEXT · 例句</div>
        <div class="vocab-example-en">${escapeHtml(word.example_en)}</div>
        ${word.example_zh ? `<div class="vocab-example-zh">${escapeHtml(word.example_zh)}</div>` : ''}
      </div>`;
  }
  back.innerHTML = backHTML;

  knowBtns.style.display = 'flex';
  ratingRow.classList.remove('visible');
}

async function handleKnow(knew) {
  if (cardFlipped || interactionBusy || !selectedSet) return;
  const word = currentWords[currentIdx];
  if (!word) return;
  const generation = viewGeneration;
  const session = vocabSession();
  const inner = document.querySelector('#vocab-card-inner');
  const ratingRow = document.querySelector('#vocab-rating-row');
  const knowBtns = document.querySelector('#vocab-know-btns');
  const progress = { ...(vocabProgress[word.id] || { stage: 0, correct_count: 0, wrong_count: 0 }) };
  if (knew) {
    progress.correct_count = (progress.correct_count || 0) + 1;
    progress.stage = 1;
  } else {
    progress.wrong_count = (progress.wrong_count || 0) + 1;
    progress.stage = 0;
  }
  setLearningBusy(true);
  try {
    await saveProgress(word.id, progress.stage, progress.correct_count || 0, progress.wrong_count || 0);
    if (!isCurrentVocabOperation(generation, session)) return;
    vocabProgress[word.id] = progress;
    inner.classList.add('flipped');
    cardFlipped = true;
    document.querySelector('#vocab-peek-btn')?.classList.add('hidden');
    document.querySelector('#vocab-card-front').setAttribute('aria-hidden', 'true');
    document.querySelector('#vocab-card-back').setAttribute('aria-hidden', 'false');
    cardKnew = knew;
    knowBtns.style.display = 'none';
    if (!knew) {
      reviewQueue.push(word);
      totalWrong++;
      ratingRow.innerHTML = `<button class="vocab-rate-btn pass" id="btn-next-only" style="flex:1">下一个 →</button>`;
      ratingRow.classList.add('visible');
      document.querySelector('#btn-next-only')?.addEventListener('click', advanceWord);
      setLearningBusy(false);
    } else {
      totalLearned++;
      scheduleLearningTransition(() => {
        ratingRow.innerHTML = `
          <button class="vocab-rate-btn again" id="btn-again">← 再练一次</button>
          <button class="vocab-rate-btn pass" id="btn-pass">记住了 →</button>
        `;
        ratingRow.classList.add('visible');
        document.querySelector('#btn-again')?.addEventListener('click', () => handleRating('again'));
        document.querySelector('#btn-pass')?.addEventListener('click', () => handleRating('pass'));
      }, 400);
    }
  } catch (error) {
    if (!isCurrentVocabOperation(generation, session)) return;
    setLearningBusy(false);
    showToast('学习进度未保存：' + error.message);
  }
}

async function handleRating(rating) {
  if (!cardFlipped || interactionBusy || !selectedSet) return;
  const word = currentWords[currentIdx];
  if (!word) return;
  const generation = viewGeneration;
  const session = vocabSession();
  const progress = { ...(vocabProgress[word.id] || { stage: 0, correct_count: 0, wrong_count: 0 }) };

  if (rating === 'again') {
    progress.stage = 0;
    progress.wrong_count = (progress.wrong_count || 0) + 1;
  } else {
    progress.stage = 1;
  }
  setLearningBusy(true);
  try {
    await saveProgress(word.id, progress.stage, progress.correct_count || 0, progress.wrong_count || 0);
    if (!isCurrentVocabOperation(generation, session)) return;
    vocabProgress[word.id] = progress;
    if (rating === 'again') { reviewQueue.push(word); totalWrong++; }
    scheduleLearningTransition(advanceWord, 300);
  } catch (error) {
    if (!isCurrentVocabOperation(generation, session)) return;
    setLearningBusy(false);
    showToast('学习进度未保存：' + error.message);
  }
}

function advanceWord() {
  // 旧评分按钮的迟到点击不能跳过尚未作答的新词。
  if (interactionBusy || !cardFlipped || !selectedSet || !currentWords[currentIdx]) return;
  cancelLearningTransition();
  currentIdx++;
  updateProgressBar();
  showCard();
}

function endRound() {
  if (reviewQueue.length > 0) {
    roundNum++;
    currentWords = shuffleArray([...reviewQueue]);
    reviewQueue = [];
    currentIdx = 0;
    document.querySelector('#vocab-progress-text').textContent = `第 ${roundNum + 1} 轮 · ${currentWords.length} 词`;
    showCard();
    updateProgressBar();
  } else {
    // Complete!
    showCompletion();
  }
}

function updateProgressBar() {
  const total = currentMode === 'spelling' ? spellWords.length : currentWords.length;
  const done = currentMode === 'spelling' ? spellIdx : currentIdx;
  const pct = total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;
  document.querySelector('#vocab-progress-fill').style.width = pct + '%';
  document.querySelector('#vocab-session-progress')?.setAttribute('aria-valuenow', String(pct));
  const position = document.querySelector('#vocab-study-position');
  if (position) position.textContent = `${Math.min(done + 1, total)} / ${total}`;
}

function showCompletion() {
  document.querySelector('#vocab-card-area').classList.add('hidden');
  document.querySelector('#vocab-complete-area').classList.remove('hidden');
  document.querySelector('#vocab-complete-title').textContent =
    roundNum > 0 ? `这一组，记住了。共 ${roundNum + 1} 轮` : '这一轮，完成了。';
  document.querySelector('#vocab-complete-stats').textContent =
    `认识 ${totalLearned} 词 · 不认识 ${totalWrong} 词`;
  spellWords = selectedSet.words.filter(w => {
    const p = vocabProgress[w.id];
    return p && p.stage >= 1 && !p.spelling_passed;
  });
  const spellBtn = document.querySelector('#btn-vocab-spell-start');
  spellBtn.style.display = spellWords.length > 0 ? '' : 'none';
  spellBtn.textContent = `开始拼写测试 (${spellWords.length}词)`;
}

function restartLearning() {
  switchMode('learn');
}

/* ===================================================================
   Spelling Mode
   =================================================================== */

function startSpelling() {
  if (!selectedSet) return;
  cancelLearningTransition();
  currentMode = 'spelling';
  document.querySelector('#vocab-review-empty')?.classList.add('hidden');
  document.querySelectorAll('.vocab-mode-tab').forEach(tab => { tab.classList.toggle('active', tab.dataset.mode === 'spelling'); tab.setAttribute('aria-pressed', String(tab.dataset.mode === 'spelling')); });
  document.querySelector('#vocab-card-area').classList.add('hidden');
  document.querySelector('#vocab-complete-area').classList.add('hidden');
  document.querySelector('#vocab-spell-area').classList.remove('hidden');

  spellWords = selectedSet.words.filter(w => {
    const p = vocabProgress[w.id];
    return p && p.stage >= 1 && !p.spelling_passed;
  });
  if (spellWords.length === 0) spellWords = [...selectedSet.words];
  spellWords = shuffleArray([...spellWords]);
  spellIdx = 0;
  spellStats = { correct: 0, wrong: 0 };
  document.querySelector('#vocab-progress-text').textContent = `拼写测试 · ${spellWords.length} 词`;
  showSpellQuestion();
}

function showSpellQuestion() {
  if (spellIdx >= spellWords.length) {
    endSpelling();
    return;
  }
  const word = spellWords[spellIdx];
  document.querySelector('#spell-def-zh').textContent = word.def_zh || '';
  document.querySelector('#spell-def-en').textContent = word.def_en || '';
  document.querySelector('#spell-pos-tag').textContent = word.pos || '';
  const input = document.querySelector('#spell-input');
  input.value = '';
  input.className = 'vocab-spell-input';
  input.focus();
  document.querySelector('#spell-result').textContent = '';
  document.querySelector('#spell-result').className = 'vocab-spell-result';
  updateProgressBar();
}

async function handleSpellSubmit() {
  if (interactionBusy || !selectedSet || currentMode !== 'spelling') return;
  const word = spellWords[spellIdx];
  if (!word) return;
  const input = document.querySelector('#spell-input');
  const answer = input.value.trim();
  if (!answer) return;

  const resultEl = document.querySelector('#spell-result');
  const correct = answer.toLowerCase() === word.word.toLowerCase().trim();
  const generation = viewGeneration;
  const session = vocabSession();
  setLearningBusy(true);

  if (correct) {
    try {
      await saveSpellProgress(word.id);
      if (!isCurrentVocabOperation(generation, session)) return;
      input.className = 'vocab-spell-input correct';
      resultEl.textContent = '回答正确，已记录。';
      resultEl.className = 'vocab-spell-result correct';
      spellStats.correct++;
      vocabProgress[word.id] = { ...(vocabProgress[word.id] || {}), spelling_passed: 1 };
      scheduleLearningTransition(advanceSpell, 800);
    } catch (error) {
      if (!isCurrentVocabOperation(generation, session)) return;
      setLearningBusy(false);
      resultEl.textContent = '进度未保存，请重试提交。';
      showToast('拼写进度未保存：' + error.message);
    }
  } else {
    input.className = 'vocab-spell-input wrong';
    resultEl.innerHTML = `再记一次，正确答案： <strong>${escapeHtml(word.word)}</strong>`;
    resultEl.className = 'vocab-spell-result wrong';
    spellStats.wrong++;
    scheduleLearningTransition(advanceSpell, 2000);
  }
}

function advanceSpell() {
  if (interactionBusy || !selectedSet || !spellWords[spellIdx]) return;
  cancelLearningTransition();
  spellIdx++;
  updateProgressBar();
  showSpellQuestion();
}

function endSpelling() {
  document.querySelector('#vocab-spell-area').classList.add('hidden');
  document.querySelector('#vocab-complete-area').classList.remove('hidden');
  document.querySelector('#vocab-complete-title').textContent = '拼写练习，完成。';
  document.querySelector('#vocab-complete-stats').textContent =
    `正确 ${spellStats.correct} 词 · 错误 ${spellStats.wrong} 词`;
  document.querySelector('#btn-vocab-spell-start').style.display = 'none';
}

/* ===================================================================
   Review Mode
   =================================================================== */

function startReviewMode() {
  if (!selectedSet) return;
  cancelLearningTransition();
  document.querySelector('#vocab-card-area').classList.remove('hidden');
  const reviewWords = selectedSet.words.filter(w => {
    const p = vocabProgress[w.id];
    return p && p.stage === 0 && !p.spelling_passed;
  });
  if (!reviewWords.length) {
    currentWords = [];
    currentIdx = 0;
    document.querySelector('#vocab-card-area').classList.add('hidden');
    document.querySelector('#vocab-review-empty')?.classList.remove('hidden');
    document.querySelector('#vocab-progress-text').textContent = '暂时没有待复习的词';
    updateProgressBar();
    return;
  }
  currentWords = shuffleArray(reviewWords);
  currentIdx = 0;
  cardFlipped = false;
  reviewQueue = [];
  roundNum = 0;
  totalLearned = 0;
  totalWrong = 0;
  document.querySelector('#vocab-progress-text').textContent = `复习模式 · ${currentWords.length} 词`;
  showCard();
  updateProgressBar();
}

/* ===================================================================
   Helpers
   =================================================================== */

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function skeletonHTML(count) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += '<div class="blog-card skeleton-card"><div class="skeleton-line" style="width:60%"></div><div class="skeleton-line" style="width:40%"></div><div class="skeleton-line" style="width:80%"></div></div>';
  }
  return html;
}

// Init
init();
