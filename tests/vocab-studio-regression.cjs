const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function studioHarness() {
  const elements = new Map();
  const calls = [];
  function el(selector) {
    if (!elements.has(selector)) {
      const classes = new Set();
      const attrs = new Map();
      elements.set(selector, {
        textContent: '', innerHTML: '', value: '', files: [], style: {}, dataset: {},
        classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle(x, on) { on ? classes.add(x) : classes.delete(x); } },
        setAttribute: (k,v) => attrs.set(k,String(v)), getAttribute: k => attrs.get(k),
        addEventListener() {}, querySelectorAll: () => [], focus() {},
      });
    }
    return elements.get(selector);
  }
  const ctx = {
    console, currentUser: { user_id: 1, token: 'A' },
    document: { querySelector: selector => selector.includes('.custom-modal-overlay') ? (elements.get(selector) || null) : el(selector), querySelectorAll: () => [], body: el('body') },
    window: { GardenUI: { openPanel: (...args) => calls.push(['open', ...args]), closePanel() {} } },
    isLoggedIn: () => !!ctx.currentUser,
    openAuthModal: () => calls.push(['login']),
    escapeHtml: String,
    clearTimeout() {}, setTimeout() {},
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/vocab.js'), 'utf8').replace(/init\(\);\s*$/, ''), ctx);
  const run = code => vm.runInContext(code, ctx);
  run("selectedSet = { id: 1, words: [{ id: 9, word: 'serendipity', def_zh: '意外的幸运' }] }; currentWords = [...selectedSet.words];");
  return { ctx, run, el, calls };
}

test('导入入口：游客先登录，登录后才打开工作台', () => {
  const h = studioHarness();
  h.el('#vocab-upload-section').classList.add('hidden');
  h.ctx.currentUser = null;
  h.run('openVocabImport()');
  assert.equal(h.el('#vocab-upload-section').classList.contains('hidden'), true);
  assert.deepEqual(h.calls.map(x => x[0]), ['login']);
  h.ctx.currentUser = { user_id: 1, token: 'A' };
  h.run('openVocabImport()');
  assert.equal(h.el('#vocab-upload-section').classList.contains('hidden'), false);
  assert.equal(h.calls[1][0], 'open');
  assert.equal(h.calls[1][1], h.el('#vocab-upload-section'));
});

test('查看释义不写进度、不计分，再次点击回到单词', () => {
  const h = studioHarness();
  h.run('showCard(); toggleVocabPreview()');
  assert.equal(h.el('#vocab-card-front').getAttribute('aria-hidden'), 'true');
  assert.equal(h.el('#vocab-card-back').getAttribute('aria-hidden'), 'false');
  assert.equal(h.run('cardFlipped'), false);
  assert.equal(h.run('totalLearned + totalWrong'), 0);
  assert.equal(h.run('Object.keys(vocabProgress).length'), 0);
  h.run('toggleVocabPreview()');
  assert.equal(h.el('#vocab-card-front').getAttribute('aria-hidden'), 'false');
});

test('词集没有待复习单词时显示可继续学习的空状态', () => {
  const h = studioHarness();
  h.run("vocabProgress = { 9: { stage: 1 } }; switchMode('review')");
  assert.equal(h.el('#vocab-review-empty').classList.contains('hidden'), false);
  assert.equal(h.el('#vocab-card-area').classList.contains('hidden'), true);
  h.run("switchMode('learn')");
  assert.equal(h.el('#vocab-review-empty').classList.contains('hidden'), true);
  assert.equal(h.el('#vocab-card-area').classList.contains('hidden'), false);
});

test('拼写输入中的 Escape 可以返回书架，输入中的箭头不评分', () => {
  const h = studioHarness();
  h.run('showSets = () => { window.returnedToShelf = true; };');
  h.ctx.inputTarget = { closest: selector => selector.includes('input') ? {} : null };
  h.run("handleKeyboard({key:'ArrowRight',target:inputTarget})");
  assert.equal(h.run('totalLearned'), 0);
  h.run("handleKeyboard({key:'Escape',target:inputTarget})");
  assert.equal(h.ctx.window.returnedToShelf, true);
});

test('默认登录状态不会自动展开大导入表单', () => {
  const h = studioHarness();
  h.el('#vocab-upload-section').classList.add('hidden');
  h.run('selectedSet = null; toggleOwnerUI()');
  assert.equal(h.el('#vocab-upload-section').classList.contains('hidden'), true);
  assert.equal(h.calls.length, 0);
});

test('上一词的下一个按钮不能跳过尚未作答的新词', () => {
  const h = studioHarness();
  h.run("currentWords.push({ id: 10, word: 'curiosity' }); cardFlipped = true; advanceWord()");
  assert.equal(h.run('currentIdx'), 1);
  assert.equal(h.run('cardFlipped'), false);
  h.run('advanceWord(); advanceWord()');
  assert.equal(h.run('currentIdx'), 1);
  h.run('toggleVocabPreview(); advanceWord()');
  assert.equal(h.run('currentIdx'), 1);
});

test('弹层出现但焦点尚在 body 时，Escape 不退出学习', () => {
  const h = studioHarness();
  h.el('.custom-modal-overlay:not(.hidden), #auth-modal:not(.hidden)');
  h.run('showSets = () => { window.returnedToShelf = true; };');
  h.ctx.bodyTarget = { closest: () => null };
  h.run("handleKeyboard({key:'Escape',target:bodyTarget})");
  assert.notEqual(h.ctx.window.returnedToShelf, true);
});
