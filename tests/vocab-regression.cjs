const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// 直接执行页面源码；仅替代浏览器 DOM、网络和时钟，不修改生产数据库。
function harness() {
  const elements = new Map();
  const listeners = new Map();
  const timers = new Map();
  const notices = [];
  const requests = [];
  const activity = [];
  const loadErrors = [];
  let now = 0;
  let timerId = 0;
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      const attributes = new Map();
      elements.set(id, {
        value: '', files: [], innerHTML: '', textContent: '', disabled: false,
        style: {}, dataset: {}, offsetHeight: 1,
        classList: { add: v => classes.add(v), remove: v => classes.delete(v),
          contains: v => classes.has(v), toggle(v, on) { if (on) classes.add(v); else classes.delete(v); } },
        addEventListener() {}, querySelector: element, querySelectorAll: () => [],
        focus() { ctx.document.activeElement = this; this.focusCount = (this.focusCount || 0) + 1; },
        scrollIntoView(options) { this.scrollOptions = options; },
        setAttribute: (name, value) => attributes.set(name, String(value)),
        getAttribute: name => attributes.get(name), removeAttribute: name => attributes.delete(name),
        prepend() {}, remove() {},
      });
    }
    return elements.get(id);
  }
  const on = (name, fn) => {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(fn);
  };
  const ctx = {
    console, AbortController, CustomEvent: class { constructor(type) { this.type = type; } }, API_BASE: 'http://local',
    Date: { now: () => now },
    currentUser: { token: 'token-A', user_id: 1, username: 'A' },
    document: { querySelector: selector => selector.includes('.custom-modal-overlay') ? (elements.get(selector) || null) : element(selector), querySelectorAll: () => [], addEventListener: on,
      createElement: () => element(`created-${elements.size}`), dispatchEvent: event => activity.push(event.type) },
    window: { addEventListener: on },
    isLoggedIn: () => !!ctx.currentUser,
    isOwner: () => false,
    getAuthHeaders: () => ({ Authorization: `Bearer ${ctx.currentUser?.token}`, 'Content-Type': 'application/json' }),
    escapeHtml: value => String(value ?? '').replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[char])),
    showToast: (message, type) => notices.push({ message, type }),
    renderLoadError: (target, message, retry) => loadErrors.push({ target, message, retry }),
    openAuthModal() {}, loadUserSession() {}, initAuthInteractions() {}, initThemeToggle() {},
    loadSiteConfig: async () => {}, updateAuthUI() {},
    confirm: () => true,
    FormData: class { append() {} },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, due: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval(fn, ms) { const id = ++timerId; timers.set(id, { fn, due: now + ms, interval: ms }); return id; },
    clearInterval: id => timers.delete(id),
    fetch: async (url, options = {}) => { requests.push({ url, options }); return { ok: true, json: async () => ({ code: 0, data: [] }) }; },
  };
  vm.createContext(ctx);
  const source = fs.readFileSync(path.join(__dirname, '../frontend/vocab.js'), 'utf8').replace(/init\(\);\s*$/, '');
  vm.runInContext(source, ctx);
  const run = code => vm.runInContext(code, ctx);
  const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
  const advance = async ms => {
    const target = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      const [id, timer] = next;
      now = timer.due;
      if (timer.interval) timer.due += timer.interval; else timers.delete(id);
      await timer.fn();
      await flush();
    }
    now = target;
    await flush();
  };
  const emit = async (name, event = {}) => { for (const fn of listeners.get(name) || []) await fn(event); await flush(); };
  run("selectedSet = { id: 10, name: 'A', words: [{ id: 1, word: 'alpha' }, { id: 2, word: 'beta' }, { id: 3, word: 'gamma' }] }; currentWords = [...selectedSet.words];");
  return { ctx, run, element, requests, notices, advance, flush, emit, timers, activity, loadErrors };
}

test('重复评分只保存一次，并只前进一个词', async () => {
  const h = harness();
  h.run('cardFlipped = true;');
  h.run("handleRating('pass'); handleRating('pass');");
  await h.flush();
  await h.advance(300);
  assert.equal(h.requests.length, 1);
  assert.equal(h.run('currentIdx'), 1);
});

test('重复拼写提交与提交后跳过不会重复计分或跳词', async () => {
  const h = harness();
  h.run("currentMode = 'spelling'; spellWords = [...selectedSet.words];");
  h.element('#spell-input').value = 'alpha';
  h.run('handleSpellSubmit(); handleSpellSubmit(); advanceSpell();');
  await h.flush();
  await h.advance(800);
  assert.equal(h.run('spellStats.correct'), 1);
  assert.equal(h.run('spellIdx'), 1);
});

test('切换学习模式会取消旧题目的延迟推进', async () => {
  const h = harness();
  h.run('cardFlipped = true;');
  h.run("handleRating('pass');");
  await h.flush();
  h.run("switchMode('learn');");
  await h.advance(500);
  assert.equal(h.run('currentIdx'), 0);
});

test('返回列表后进入另一个词集，拼写题目来自新词集', async () => {
  const h = harness();
  h.run("spellWords = [...selectedSet.words]; showSets(); selectedSet = { id: 20, name: 'B', words: [{ id: 4, word: 'delta' }] }; startSpelling();");
  assert.equal(h.run('spellWords.length'), 1);
  assert.equal(h.run('spellWords[0].word'), 'delta');
});

test('拼写进度条使用拼写索引', () => {
  const h = harness();
  h.run("currentMode = 'spelling'; spellWords = [...selectedSet.words]; spellIdx = 2; updateProgressBar();");
  assert.equal(h.element('#vocab-progress-fill').style.width, '67%');
});

test('保存失败显示错误，并保留当前题目与未保存的进度', async () => {
  const h = harness();
  h.ctx.fetch = async () => ({ ok: false, status: 500, json: async () => ({ code: 500, msg: 'save failed' }) });
  await h.run('handleKnow(false)');
  assert.equal(h.run('totalWrong'), 0);
  assert.equal(h.run('cardFlipped'), false);
  assert.equal(h.run('Object.keys(vocabProgress).length'), 0);
  assert.ok(h.notices.some(n => /保存|save failed/.test(n.message)));
});

test('拼写保存失败不会提示正确或计为已掌握', async () => {
  const h = harness();
  h.run("currentMode = 'spelling'; spellWords = [...selectedSet.words];");
  h.element('#spell-input').value = 'alpha';
  h.ctx.fetch = async () => ({ ok: true, json: async () => ({ code: 403, msg: '请先登录' }) });
  await h.run('handleSpellSubmit()');
  await h.advance(900);
  assert.equal(h.run('spellStats.correct'), 0);
  assert.equal(h.run('spellIdx'), 0);
  assert.ok(h.notices.length > 0);
});

test('帐号变更会立即清除私人学习状态', async () => {
  const h = harness();
  await h.run('init()');
  h.ctx.currentUser = { token: 'token-B', user_id: 2, username: 'B' };
  await h.emit('auth-changed');
  assert.equal(h.run('selectedSet'), null);
  assert.equal(h.run('currentWords.length'), 0);
  assert.equal(h.element('#vocab-learn-section').classList.contains('hidden'), true);
});

test('旧列表响应不能覆盖最近一次列表加载', async () => {
  const h = harness();
  let firstResolve;
  let call = 0;
  h.ctx.fetch = () => ++call === 1 ? new Promise(resolve => { firstResolve = resolve; }) : Promise.resolve({ ok: true, json: async () => ({ code: 0, data: [{ id: 2, name: 'new' }] }) });
  const oldRequest = h.run('loadSets()');
  await h.run('loadSets()');
  firstResolve({ ok: true, json: async () => ({ code: 0, data: [{ id: 1, name: 'old' }] }) });
  await oldRequest;
  assert.equal(h.run('vocabSets[0].name'), 'new');
});

test('返回列表后迟到的词集详情不能重新打开学习区', async () => {
  const h = harness();
  let resolveDetail;
  h.ctx.fetch = url => url.endsWith('/sets/20') ? new Promise(resolve => { resolveDetail = resolve; }) : Promise.resolve({ ok: true, json: async () => ({ code: 0, data: [] }) });
  const detail = h.run('enterSet(20)');
  h.run('showSets()');
  resolveDetail({ ok: true, json: async () => ({ code: 0, data: { id: 20, name: 'late', words: [{ id: 4, word: 'delta' }] } }) });
  await detail;
  assert.equal(h.run('selectedSet'), null);
  assert.equal(h.element('#vocab-learn-section').classList.contains('hidden'), true);
});

test('上传轮询持续返回权限失败时解除按钮禁用', async () => {
  const h = harness();
  let call = 0;
  h.element('#vocab-file-input').files = [{ name: 'test.txt' }];
  h.ctx.fetch = async () => ({ ok: true, json: async () => ++call === 1 ? { code: 0, data: { set_id: 1, name: 'test' } } : { code: 403, msg: '请先登录' } });
  await h.run('handleUpload()');
  await h.advance(302000);
  assert.equal(h.element('#vocab-upload-btn').disabled, false);
  assert.equal(h.timers.size, 0);
});

test('离开页面后取消学习延迟，防止缓存页面恢复时跳词', async () => {
  const h = harness();
  await h.run('init()');
  h.run('cardFlipped = true;');
  h.run("handleRating('pass');");
  await h.flush();
  await h.emit('pagehide');
  await h.advance(1000);
  assert.equal(h.run('selectedSet'), null);
  assert.equal(h.timers.size, 0);
});

test('同一单词的保存按顺序发送，避免慢请求覆盖新的进度', async () => {
  const h = harness();
  let finishFirst;
  const calls = [];
  h.ctx.fetch = (url, options) => {
    calls.push(JSON.parse(options.body));
    if (calls.length === 1) return new Promise(resolve => { finishFirst = resolve; });
    return Promise.resolve({ ok: true, json: async () => ({ code: 0, data: null }) });
  };
  const first = h.run('saveProgress(1, 1, 1, 0)');
  const second = h.run('saveProgress(1, 0, 1, 1)');
  await h.flush();
  assert.equal(calls.length, 1);
  finishFirst({ ok: true, json: async () => ({ code: 0, data: null }) });
  await Promise.all([first, second]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].stage, 0);
});

test('轮询持续断网停止自动重试并说明状态未知，仍允许上传', async () => {
  const h = harness();
  let call = 0;
  h.element('#vocab-file-input').files = [{ name: 'test.txt' }];
  h.ctx.fetch = async () => {
    if (++call > 1) throw new Error('offline');
    return { ok: true, json: async () => ({ code: 0, data: { set_id: 1, name: 'test' } }) };
  };
  await h.run('handleUpload()');
  await h.advance(302000);
  assert.equal(h.element('#vocab-upload-btn').disabled, false);
  assert.match(h.element('#vocab-upload-status').innerHTML, /暂停.*刷新|刷新.*继续/);
  assert.doesNotMatch(h.element('#vocab-upload-status').innerHTML, /解析失败|解析超时/);
  assert.equal(h.timers.size, 0);
});

test('处理中的卡片展示真实 AI 进度和环节，不显示学习进度', () => {
  const h = harness();
  h.run("vocabSets = [{ id: 10, name: '大英三', user_id: 1, status: 'processing', parse_stage: 'enriching', parse_progress_pct: 40, processed_words: 240, total_words: 600, elapsed_seconds: 75, progress_pct: 0 }]; renderSets();");
  const html = h.element('#vocab-sets-grid').innerHTML;
  assert.match(html, /AI 解析/);
  assert.match(html, /240\s*\/\s*600/);
  assert.match(html, /40%/);
  assert.match(html, /1 分 15 秒/);
  assert.match(html, /role="progressbar"[^>]+aria-valuenow="40"/);
  assert.match(html, /读取文件.*识别词条.*AI 解析.*核对与保存/s);
  assert.doesNotMatch(html, /已掌握|等待第一次探索/);
});

test('未知格式识别阶段按已完成批次展示 AI 识别百分比', () => {
  const h = harness();
  h.run("vocabSets = [{ id: 10, name: '课程笔记', status: 'processing', parse_stage: 'identifying', parse_stage_progress_pct: 40, parse_progress_pct: 0, total_words: 0, completed_batches: 2, total_batches: 5, elapsed_seconds: 12 }]; renderSets();");
  const html = h.element('#vocab-sets-grid').innerHTML;
  assert.match(html, /AI 识别 40%/);
  assert.match(html, /已识别 2\s*\/\s*5 批/);
  assert.match(html, /role="progressbar"[^>]+aria-valuenow="40"/);
  assert.doesNotMatch(html, /正在确认词条数量/);
});

test('失败卡片显示安全转义的具体原因，进入失败词集不会打开学习', async () => {
  const h = harness();
  const data = { id: 10, name: '失败词集', user_id: 1, status: 'error', error_message: '<img src=x onerror=alert(1)> 模型不可用', words: [] };
  h.ctx.errorSet = data;
  h.run('vocabSets = [errorSet]; renderSets();');
  assert.match(h.element('#vocab-sets-grid').innerHTML, /模型不可用/);
  assert.doesNotMatch(h.element('#vocab-sets-grid').innerHTML, /<img/);
  h.ctx.fetch = async () => ({ ok: true, json: async () => ({ code: 0, data }) });
  await h.run('enterSet(10)');
  assert.equal(h.run('selectedSet'), null);
  assert.match(h.element('#vocab-upload-status').innerHTML, /解析失败/);
  assert.doesNotMatch(h.notices.map(n => n.message).join(), /为空或仍在解析/);
});

test('历史任务未知耗时不误报零秒', () => {
  const h = harness();
  h.run("vocabSets = [{ id: 10, name: '旧任务', status: 'error', elapsed_seconds: null, error_message: '任务已中断' }]; renderSets();");
  const html = h.element('#vocab-sets-grid').innerHTML;
  assert.match(html, /耗时未记录/);
  assert.doesNotMatch(html, /已用时 0 秒/);
});

test('刷新页面加载处理中的词集后自动跟踪到完成', async () => {
  const h = harness();
  let statusCalls = 0;
  h.ctx.fetch = async url => ({ ok: true, json: async () => ({ code: 0, data: url.endsWith('/sets')
    ? [{ id: 10, name: '大英三', user_id: 1, status: 'processing', parse_stage: 'enriching', total_words: 20 }]
    : (++statusCalls, { status: 'completed', parse_stage: 'completed', parse_progress_pct: 100, word_count: 20, total_words: 20, processed_words: 20 }) }) });
  await h.run('init()');
  await h.advance(2500);
  assert.equal(statusCalls, 1);
  assert.equal(h.run('vocabSets[0].status'), 'completed');
  assert.match(h.element('#vocab-sets-grid').innerHTML, /20 <span>个单词/);
  assert.equal(h.timers.size, 0);
});

test('上传成功立即显示卡片并解除上传锁，关闭面板仍有进度', async () => {
  const h = harness();
  h.element('#vocab-file-input').files = [{ name: '大英3.xlsx' }];
  h.ctx.fetch = async url => ({ ok: true, json: async () => ({ code: 0, data: url.endsWith('/upload')
    ? { set_id: 10, name: '大英三', status: 'processing', parse_stage: 'extracting' }
    : { status: 'processing', parse_stage: 'enriching', parse_progress_pct: 50, processed_words: 10, total_words: 20, elapsed_seconds: 6 } }) });
  await h.run('handleUpload()');
  assert.match(h.element('#vocab-sets-grid').innerHTML, /大英三/);
  assert.match(h.element('#vocab-sets-grid').innerHTML, /读取文件/);
  assert.equal(h.element('#vocab-upload-btn').disabled, false);
  h.element('#vocab-upload-section').classList.add('hidden');
  await h.advance(2500);
  assert.match(h.element('#vocab-sets-grid').innerHTML, /50%/);
});

test('上传完成取代旧列表请求时结束书架忙碌状态', async () => {
  const h = harness();
  let finishList;
  h.element('#vocab-file-input').files = [{ name: 'test.txt' }];
  h.ctx.fetch = url => url.endsWith('/sets') ? new Promise(resolve => { finishList = resolve; })
    : Promise.resolve({ ok: true, json: async () => ({ code: 0, data: { set_id: 10, name: '新词集', status: 'processing' } }) });
  const oldList = h.run('loadSets()');
  await h.run('handleUpload()');
  finishList({ ok: true, json: async () => ({ code: 0, data: [] }) });
  await oldList;
  assert.equal(h.run('vocabSets.length'), 1);
  assert.equal(h.element('#vocab-sets-grid').getAttribute('aria-busy'), 'false');
});

test('五分钟之后仍按后端真实状态继续跟踪，不假报任务超时', async () => {
  const h = harness();
  h.ctx.fetch = async url => ({ ok: true, json: async () => ({ code: 0, data: url.endsWith('/sets')
    ? [{ id: 10, name: '长词集', user_id: 1, status: 'processing', parse_stage: 'enriching' }]
    : { status: 'processing', parse_stage: 'enriching', parse_progress_pct: 50, processed_words: 1000, total_words: 2000, elapsed_seconds: 310 } }) });
  await h.run('loadSets()');
  await h.advance(310000);
  assert.equal(h.run('vocabSets[0].status'), 'processing');
  assert.match(h.element('#vocab-sets-grid').innerHTML, /50%/);
  assert.ok(h.timers.size > 0);
});

test('账号切换后迟到的解析状态不能写回新账户', async () => {
  const h = harness();
  let finishStatus;
  h.ctx.fetch = async () => ({ ok: true, json: async () => ({ code: 0, data: [] }) });
  await h.run('init()');
  h.ctx.fetch = url => url.endsWith('/status') ? new Promise(resolve => { finishStatus = resolve; })
    : Promise.resolve({ ok: true, json: async () => ({ code: 0, data: [{ id: 10, name: '私人词集', status: 'processing' }] }) });
  await h.run('loadSets()');
  const polling = h.advance(2000);
  await h.flush();
  h.ctx.currentUser = { token: 'token-B', user_id: 2, username: 'B' };
  h.ctx.fetch = async () => ({ ok: true, json: async () => ({ code: 0, data: [] }) });
  await h.emit('auth-changed');
  assert.equal(typeof finishStatus, 'function', '已有任务应恢复状态查询');
  finishStatus({ ok: true, json: async () => ({ code: 0, data: { status: 'completed', word_count: 20 } }) });
  await polling;
  assert.equal(h.run('vocabSets.length'), 0);
  assert.doesNotMatch(h.element('#vocab-sets-grid').innerHTML, /私人词集/);
  assert.equal(h.timers.size, 0);
});

test('已移除任务的迟到解析响应不会恢复卡片', async () => {
  const h = harness();
  let finishStatus;
  h.ctx.fetch = url => url.endsWith('/status') ? new Promise(resolve => { finishStatus = resolve; })
    : Promise.resolve({ ok: true, json: async () => ({ code: 0, data: [{ id: 10, name: '已删除', status: 'processing' }] }) });
  await h.run('loadSets()');
  const polling = h.advance(2000);
  await h.flush();
  h.run('vocabSets = []; renderSets();');
  assert.equal(typeof finishStatus, 'function', '已有任务应恢复状态查询');
  finishStatus({ ok: true, json: async () => ({ code: 0, data: { status: 'completed', word_count: 20 } }) });
  await polling;
  assert.equal(h.run('vocabSets.length'), 0);
  assert.equal(h.timers.size, 0);
});

test('AI 已完成而仍保存时不能进入学习区', async () => {
  const h = harness();
  h.ctx.fetch = async () => ({ ok: true, json: async () => ({ code: 0, data: { id: 10, name: 'saving', status: 'processing', parse_stage: 'saving', parse_progress_pct: 100, processed_words: 20, total_words: 20, words: [{ id: 1, word: 'alpha' }] } }) });
  await h.run('enterSet(10)');
  assert.equal(h.run('selectedSet'), null);
  assert.match(h.element('#vocab-upload-status').innerHTML, /保存词集/);
  assert.match(h.element('#vocab-upload-status').innerHTML, /100%/);
  assert.equal(h.element('#vocab-import-start').classList.contains('hidden'), true);
});

test('解析进度刷新保留书架上键盘焦点', () => {
  const h = harness();
  h.run("vocabSets = [{ id: 10, name: 'A', status: 'processing' }]; renderSets();");
  const button = h.element('[data-open-set="10"]');
  button.dataset.openSet = '10';
  button.closest = selector => selector === '#vocab-sets-grid' ? h.element('#vocab-sets-grid') : null;
  button.focus();
  h.run('renderSets()');
  assert.equal(button.focusCount, 2);
});

test('解析刷新不会重新启用正在删除的词集按钮', () => {
  const h = harness();
  h.run("vocabSets = [{ id: 10, name: 'A', status: 'processing', user_id: 1 }]; deletingVocabSets.add(10); renderSets();");
  assert.match(h.element('#vocab-sets-grid').innerHTML, /data-del-set="10"[^>]*disabled/);
  assert.match(h.element('#vocab-sets-grid').innerHTML, /data-open-set="10"[^>]*disabled/);
});

test('暂停的任务加载列表后可恢复查询，临时失败不会变成解析失败', async () => {
  const h = harness();
  let offline = true;
  let completedCalls = 0;
  h.ctx.fetch = async url => {
    if (url.endsWith('/status') && offline) throw new Error('offline');
    return { ok: true, json: async () => ({ code: 0, data: url.endsWith('/sets')
      ? [{ id: 10, name: 'A', status: 'processing' }]
      : (++completedCalls, { status: 'completed', word_count: 20 }) }) };
  };
  await h.run('loadSets()');
  await h.advance(10000);
  assert.equal(h.run('vocabSets[0].status'), 'processing');
  assert.match(h.element('#vocab-sets-grid').innerHTML, /状态查询已暂停/);
  assert.equal(h.timers.size, 0);
  offline = false;
  await h.run('loadSets()');
  await h.advance(2500);
  assert.equal(completedCalls, 1);
  assert.equal(h.run('vocabSets[0].status'), 'completed');
});

test('保存中的帐号切换不会把旧帐号结果写入新学习状态', async () => {
  const h = harness();
  await h.run('init()');
  let resolveSave;
  h.ctx.fetch = (url) => url.endsWith('/progress')
    ? new Promise(resolve => { resolveSave = resolve; })
    : Promise.resolve({ ok: true, json: async () => ({ code: 0, data: [] }) });
  const oldSave = h.run('handleKnow(false)');
  await h.flush();
  h.ctx.currentUser = { token: 'token-B', user_id: 2, username: 'B' };
  await h.emit('auth-changed');
  resolveSave({ ok: true, json: async () => ({ code: 0, data: null }) });
  await oldSave;
  assert.equal(h.run('selectedSet'), null);
  assert.equal(h.run('Object.keys(vocabProgress).length'), 0);
  assert.equal(h.run('cardFlipped'), false);
});

test('词集使用原生标题按钮支持键盘进入，删除按钮独立', () => {
  const h = harness();
  h.run("vocabSets = [{ id: 10, name: 'A', user_id: 1 }]; renderSets();");
  const html = h.element('#vocab-sets-grid').innerHTML;
  assert.match(html, /<button[^>]+class="card-open-btn"[^>]+data-open-set="10"/);
  assert.match(html, /<button[^>]+class="delete-card-btn"[^>]+data-del-set="10"/);
});

test('词集刷新保留已有卡片，失败可重试且结束忙碌状态', async () => {
  const h = harness();
  h.run("vocabSets = [{ id: 10, name: 'A' }]");
  const grid = h.element('#vocab-sets-grid');
  grid.innerHTML = 'existing cards';
  let reject;
  h.ctx.fetch = () => new Promise((resolve, fail) => { reject = fail; });
  const pending = h.run('loadSets()');
  assert.equal(grid.innerHTML, 'existing cards');
  assert.equal(grid.getAttribute('aria-busy'), 'true');
  reject(new Error('offline'));
  await pending;
  assert.equal(grid.innerHTML, 'existing cards');
  assert.equal(grid.getAttribute('aria-busy'), 'false');
  assert.equal(h.loadErrors.length, 1);
  assert.equal(typeof h.loadErrors[0].retry, 'function');
});

test('进入词集聚焦学习区，返回后聚焦原词集入口', async () => {
  const h = harness();
  h.ctx.fetch = async url => ({ ok: true, json: async () => ({ code: 0, data:
    url.endsWith('/sets/10') ? { id: 10, name: 'A', words: [{ id: 1, word: 'alpha' }] }
      : url.endsWith('/sets') ? [{ id: 10, name: 'A' }] : {} }) });
  await h.run('enterSet(10)');
  const section = h.element('#vocab-learn-section');
  assert.equal(h.ctx.document.activeElement, section);
  assert.equal(section.scrollOptions.block, 'start');
  assert.equal(section.scrollOptions.behavior, 'auto');
  await h.run('showSets()');
  assert.equal(h.ctx.document.activeElement, h.element('[data-open-set="10"]'));
});

test('卡片正反面只向辅助技术暴露当前可见面', async () => {
  const h = harness();
  h.run('showCard()');
  assert.equal(h.element('#vocab-card-front').getAttribute('aria-hidden'), 'false');
  assert.equal(h.element('#vocab-card-back').getAttribute('aria-hidden'), 'true');
  await h.run('handleKnow(false)');
  assert.equal(h.element('#vocab-card-front').getAttribute('aria-hidden'), 'true');
  assert.equal(h.element('#vocab-card-back').getAttribute('aria-hidden'), 'false');
  h.run('advanceWord()');
  assert.equal(h.element('#vocab-card-back').getAttribute('aria-hidden'), 'true');
});

test('短请求发出成对顶栏事件，后台状态轮询不持续点亮顶栏', async () => {
  const h = harness();
  await h.run("requestVocab('/sets')");
  assert.deepEqual(h.activity, ['request-start', 'request-end']);
  h.activity.length = 0;
  await h.run("requestVocab('/sets/10/status')");
  assert.deepEqual(h.activity, []);
});

test('焦点位于学习区域时箭头快捷键仍正常翻卡', async () => {
  const h = harness();
  h.run("showCard(); document.querySelector('#vocab-learn-section').focus(); handleKeyboard({ key: 'ArrowRight', target: document.querySelector('#vocab-learn-section') });");
  await h.flush();
  assert.equal(h.run('cardFlipped'), true);
  assert.equal(h.run('totalLearned'), 1);
});
