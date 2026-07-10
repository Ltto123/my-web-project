/**
 * vocab.js — 不背单词页面
 * 依赖 common.js：常量、工具函数、认证、主题
 */

let vocabSets = [];
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
let activePollInterval = null;  // track async upload polling for cleanup

/* ===================================================================
   Init
   =================================================================== */

async function init() {
  loadUserSession();
  initAuthInteractions();
  initThemeToggle();
  await loadSiteConfig();
  updateAuthUI();
  bindVocabEvents();
  toggleOwnerUI();
  await loadSets();
  // Re-render on login/logout without page refresh
  document.addEventListener("auth-changed", () => { toggleOwnerUI(); loadSets(); });
}

function toggleOwnerUI() {
  document.querySelector('#vocab-upload-section')?.classList.toggle('hidden', !isLoggedIn());
}

/* ===================================================================
   Event Bindings
   =================================================================== */

function bindVocabEvents() {
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
  if (e.target.tagName === 'INPUT') return;
  if (currentMode === 'learn' || currentMode === 'review') {
    if (!cardFlipped) {
      if (e.key === 'ArrowLeft') handleKnow(false);
      if (e.key === 'ArrowRight') handleKnow(true);
    } else {
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
  grid.innerHTML = skeletonHTML(3);
  try {
    const r = await fetch(`${API_BASE}/api/v1/vocab/sets`, { headers: getAuthHeaders() });
    const result = await r.json();
    if (result.code === 0) {
      vocabSets = result.data || [];
      renderSets();
    } else {
      grid.innerHTML = `<p class="empty-posts">加载失败：${result.msg}</p>`;
    }
  } catch (e) {
    grid.innerHTML = `<p class="empty-posts">网络错误：${e.message}</p>`;
  }
}

function renderSets() {
  const grid = document.querySelector('#vocab-sets-grid');
  if (!vocabSets.length) {
    const msg = isLoggedIn() ? '还没有单词集，上传你的第一个单词表吧！📤' : '还没有单词集，登录后上传你的第一个单词表吧！📤';
    grid.innerHTML = `<p class="empty-posts">${msg}</p>`;
    return;
  }
  let html = '';
  for (const s of vocabSets) {
    const pct = s.progress_pct || 0;
    html += `
      <article class="blog-card" data-set-id="${s.id}" style="cursor:pointer">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:24px">📖</span>
          <div>
            <div style="font-weight:600;font-size:16px">${escapeHtml(s.name)}</div>
            <div style="font-size:13px;color:var(--c-text-3)">${s.word_count} 词</div>
          </div>
        </div>
        <div class="vocab-progress-bar"><div class="vocab-progress-fill" style="width:${pct}%"></div></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
          <span style="font-size:12px;color:var(--c-text-3)">已掌握 ${pct}%</span>
          ${s.user_id ? `<button class="delete-card-btn" data-del-set="${s.id}">🗑️</button>` : ''}
        </div>
      </article>`;
  }
  grid.innerHTML = html;
  // Click to enter learning
  grid.querySelectorAll('.blog-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.delete-card-btn')) return;
      const setId = parseInt(card.dataset.setId);
      enterSet(setId);
    });
  });
  // Delete buttons
  grid.querySelectorAll('.delete-card-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const setId = parseInt(btn.dataset.delSet);
      if (confirm('确定删除这个单词集吗？')) {
        const r = await fetch(`${API_BASE}/api/v1/vocab/sets/${setId}`, { method: 'DELETE', headers: getAuthHeaders() });
        const result = await r.json();
        if (result.code === 0) { showToast('已删除', 'success'); loadSets(); }
        else showToast(result.msg);
      }
    });
  });
}

async function enterSet(setId) {
  try {
    const r = await fetch(`${API_BASE}/api/v1/vocab/sets/${setId}`, { headers: getAuthHeaders() });
    const result = await r.json();
    if (result.code !== 0) { showToast(result.msg); return; }
    selectedSet = result.data;
    currentWords = [...selectedSet.words];
    if (!currentWords.length) { showToast('该单词集为空'); return; }
    // Load progress if logged in
    if (isLoggedIn()) {
      await loadProgress(setId);
    }
    // Show learn area
    document.querySelector('#vocab-sets-section').classList.add('hidden');
    document.querySelector('#vocab-upload-section').classList.add('hidden');
    document.querySelector('#vocab-learn-section').classList.remove('hidden');
    document.querySelector('#vocab-set-title').textContent = selectedSet.name;
    switchMode('learn');
  } catch (e) { showToast('加载失败: ' + e.message); }
}

function showSets() {
  // Stop any active upload polling
  if (activePollInterval) { clearInterval(activePollInterval); activePollInterval = null; }
  document.querySelector('#vocab-learn-section').classList.add('hidden');
  document.querySelector('#vocab-sets-section').classList.remove('hidden');
  toggleOwnerUI();
  selectedSet = null;
  currentWords = [];
  vocabProgress = {};
  loadSets();
}

async function loadProgress(setId) {
  try {
    const r = await fetch(`${API_BASE}/api/v1/vocab/progress/${setId}`, { headers: getAuthHeaders() });
    const result = await r.json();
    if (result.code === 0) vocabProgress = result.data || {};
  } catch (e) { /* ignore */ }
}

async function saveProgress(wordId, stage, correct, wrong) {
  if (!isLoggedIn()) return;
  try {
    await fetch(`${API_BASE}/api/v1/vocab/progress`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ word_id: wordId, stage, correct_count: correct, wrong_count: wrong }),
    });
  } catch (e) { /* ignore */ }
}

async function saveSpellProgress(wordId) {
  if (!isLoggedIn()) return;
  try {
    await fetch(`${API_BASE}/api/v1/vocab/progress/spell`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ word_id: wordId }),
    });
  } catch (e) { /* ignore */ }
}

/* ===================================================================
   Upload
   =================================================================== */

async function handleUpload() {
  const fileInput = document.querySelector('#vocab-file-input');
  const nameInput = document.querySelector('#vocab-set-name');
  const statusEl = document.querySelector('#vocab-upload-status');
  const btn = document.querySelector('#vocab-upload-btn');
  const file = fileInput.files[0];
  if (!file) { showToast('请选择文件'); return; }

  // Disable button to prevent double-upload
  btn.disabled = true;
  statusEl.classList.remove('hidden');
  statusEl.innerHTML = '<span class="vocab-spinner"></span> 📤 正在上传文件...';

  const formData = new FormData();
  formData.append('file', file);
  if (nameInput.value.trim()) formData.append('name', nameInput.value.trim());

  try {
    const r = await fetch(`${API_BASE}/api/v1/vocab/sets/upload`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + currentUser.token },
      body: formData,
    });
    const result = await r.json();
    if (result.code !== 0) {
      statusEl.textContent = '';
      btn.disabled = false;
      showToast(result.msg || '上传失败');
      return;
    }

    // Upload succeeded, now poll for AI parsing completion
    const setId = result.data.set_id;
    const setName = escapeHtml(result.data.name || file.name);
    statusEl.innerHTML = `<span class="vocab-spinner"></span> 🤖 AI 正在后台解析「${setName}」...`;
    fileInput.value = '';
    nameInput.value = '';

    // Poll every 2 seconds
    let elapsed = 0;
    const maxWait = 300; // 5 minutes max
    if (activePollInterval) clearInterval(activePollInterval);
    activePollInterval = setInterval(async () => {
      elapsed += 2;
      // Guard: stop polling if user logged out (e.g. cross-tab)
      if (!isLoggedIn()) {
        clearInterval(activePollInterval);
        activePollInterval = null;
        btn.disabled = false;
        statusEl.textContent = '';
        return;
      }
      try {
        const sr = await fetch(`${API_BASE}/api/v1/vocab/sets/${setId}/status`, {
          headers: getAuthHeaders(),
        });
        const sresult = await sr.json();
        if (sresult.code !== 0) return;

        const s = sresult.data;
        if (s.status === 'completed') {
          clearInterval(activePollInterval);
          activePollInterval = null;
          statusEl.textContent = `✅ 解析完成！共 ${s.word_count} 个单词`;
          showToast(`「${setName}」解析完成，共 ${s.word_count} 词`, 'success');
          btn.disabled = false;
          loadSets();
        } else if (s.status === 'error') {
          clearInterval(activePollInterval);
          activePollInterval = null;
          statusEl.textContent = '';
          btn.disabled = false;
          showToast('AI 解析失败: ' + escapeHtml(s.error_message || '未知错误'));
        } else if (elapsed >= maxWait) {
          clearInterval(activePollInterval);
          activePollInterval = null;
          statusEl.textContent = '⚠️ 解析超时，请刷新页面查看状态';
          btn.disabled = false;
          loadSets();
        } else {
          // Still processing — update status with elapsed time
          statusEl.innerHTML = `<span class="vocab-spinner"></span> 🤖 AI 正在后台解析「${setName}」... (已等待 ${elapsed} 秒)`;
        }
      } catch (e) {
        // Polling error — keep trying (network blip, etc.)
      }
    }, 2000);

  } catch (e) {
    statusEl.textContent = '';
    btn.disabled = false;
    showToast('上传失败: ' + e.message);
  }
}

/* ===================================================================
   Mode Switching
   =================================================================== */

function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.vocab-mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
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
        <div class="vocab-example-label">📝 例句</div>
        <div class="vocab-example-en">${escapeHtml(word.example_en)}</div>
        ${word.example_zh ? `<div class="vocab-example-zh">${escapeHtml(word.example_zh)}</div>` : ''}
      </div>`;
  }
  back.innerHTML = backHTML;

  knowBtns.style.display = 'flex';
  ratingRow.classList.remove('visible');
}

function handleKnow(knew) {
  if (cardFlipped) return;
  const word = currentWords[currentIdx];
  const inner = document.querySelector('#vocab-card-inner');
  const ratingRow = document.querySelector('#vocab-rating-row');
  const knowBtns = document.querySelector('#vocab-know-btns');

  const progress = vocabProgress[word.id] || { stage: 0, correct_count: 0, wrong_count: 0 };

  if (!knew) {
    // Don't know
    reviewQueue.push(word);
    progress.wrong_count = (progress.wrong_count || 0) + 1;
    progress.stage = 0;
    totalWrong++;
    saveProgress(word.id, 0, progress.correct_count || 0, progress.wrong_count);
    vocabProgress[word.id] = progress;
    // Flip to show definition
    inner.classList.add('flipped');
    cardFlipped = true;
    knowBtns.style.display = 'none';
    // Show "next" only
    ratingRow.innerHTML = `<button class="vocab-rate-btn pass" id="btn-next-only" style="flex:1">下一个 →</button>`;
    ratingRow.classList.add('visible');
    document.querySelector('#btn-next-only')?.addEventListener('click', advanceWord);
  } else {
    // Know
    progress.correct_count = (progress.correct_count || 0) + 1;
    progress.stage = 1;
    totalLearned++;
    saveProgress(word.id, 1, progress.correct_count, progress.wrong_count || 0);
    vocabProgress[word.id] = progress;
    // Flip
    inner.classList.add('flipped');
    cardFlipped = true;
    knowBtns.style.display = 'none';
    // Show rating after a moment
    setTimeout(() => {
      ratingRow.innerHTML = `
        <button class="vocab-rate-btn again" id="btn-again">🔄 再看看</button>
        <button class="vocab-rate-btn pass" id="btn-pass">✅ 过</button>
      `;
      ratingRow.classList.add('visible');
      document.querySelector('#btn-again')?.addEventListener('click', () => handleRating('again'));
      document.querySelector('#btn-pass')?.addEventListener('click', () => handleRating('pass'));
    }, 400);
  }
}

function handleRating(rating) {
  if (!cardFlipped) return;
  const word = currentWords[currentIdx];
  const progress = vocabProgress[word.id] || { stage: 0, correct_count: 0, wrong_count: 0 };

  if (rating === 'again') {
    reviewQueue.push(word);
    progress.stage = 0;
    progress.wrong_count = (progress.wrong_count || 0) + 1;
    totalWrong++;
  } else {
    progress.stage = 1;
  }
  saveProgress(word.id, progress.stage, progress.correct_count || 0, progress.wrong_count || 0);
  vocabProgress[word.id] = progress;
  setTimeout(() => advanceWord(), 300);
}

function advanceWord() {
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
  const total = currentWords.length;
  const done = currentIdx;
  const pct = total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;
  document.querySelector('#vocab-progress-fill').style.width = pct + '%';
}

function showCompletion() {
  document.querySelector('#vocab-card-area').classList.add('hidden');
  document.querySelector('#vocab-complete-area').classList.remove('hidden');
  document.querySelector('#vocab-complete-title').textContent =
    roundNum > 0 ? `🎉 全部掌握！共 ${roundNum + 1} 轮` : '🎉 本轮学习完成！';
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
  currentWords = shuffleArray([...selectedSet.words]);
  startLearnMode();
}

/* ===================================================================
   Spelling Mode
   =================================================================== */

function startSpelling() {
  document.querySelector('#vocab-card-area').classList.add('hidden');
  document.querySelector('#vocab-complete-area').classList.add('hidden');
  document.querySelector('#vocab-spell-area').classList.remove('hidden');

  if (spellWords.length === 0) {
    spellWords = selectedSet.words.filter(w => {
      const p = vocabProgress[w.id];
      return p && p.stage >= 1 && !p.spelling_passed;
    });
    if (spellWords.length === 0) spellWords = [...selectedSet.words];
  }
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

function handleSpellSubmit() {
  const word = spellWords[spellIdx];
  const input = document.querySelector('#spell-input');
  const answer = input.value.trim();
  if (!answer) return;

  const resultEl = document.querySelector('#spell-result');
  const correct = answer.toLowerCase() === word.word.toLowerCase().trim();

  if (correct) {
    input.className = 'vocab-spell-input correct';
    resultEl.textContent = '✅ 正确！';
    resultEl.className = 'vocab-spell-result correct';
    spellStats.correct++;
    saveSpellProgress(word.id);
    if (vocabProgress[word.id]) vocabProgress[word.id].spelling_passed = 1;
    setTimeout(advanceSpell, 800);
  } else {
    input.className = 'vocab-spell-input wrong';
    resultEl.innerHTML = `❌ 错误！正确答案: <strong>${escapeHtml(word.word)}</strong>`;
    resultEl.className = 'vocab-spell-result wrong';
    spellStats.wrong++;
    setTimeout(advanceSpell, 2000);
  }
}

function advanceSpell() {
  spellIdx++;
  updateProgressBar();
  showSpellQuestion();
}

function endSpelling() {
  document.querySelector('#vocab-spell-area').classList.add('hidden');
  document.querySelector('#vocab-complete-area').classList.remove('hidden');
  document.querySelector('#vocab-complete-title').textContent = '✍️ 拼写测试完成！';
  document.querySelector('#vocab-complete-stats').textContent =
    `正确 ${spellStats.correct} 词 · 错误 ${spellStats.wrong} 词`;
  document.querySelector('#btn-vocab-spell-start').style.display = 'none';
}

/* ===================================================================
   Review Mode
   =================================================================== */

function startReviewMode() {
  document.querySelector('#vocab-card-area').classList.remove('hidden');
  const reviewWords = selectedSet.words.filter(w => {
    const p = vocabProgress[w.id];
    return p && p.stage === 0 && !p.spelling_passed;
  });
  if (!reviewWords.length) {
    showToast('暂无需要复习的单词！', 'info');
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
