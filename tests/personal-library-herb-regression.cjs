const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function harness(file) {
  const nodes = new Map(), appended = [], notices = [], loadErrors = [], calls = [];
  function node(key) {
    if (!nodes.has(key)) {
      const classes = new Set(), events = {}, attrs = {};
      nodes.set(key, {
        innerHTML: '', textContent: '', value: '', files: [], style: {}, dataset: {},
        disabled: false, isConnected: true, events,
        classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
          toggle(x, on) { if (on) classes.add(x); else classes.delete(x); } },
        setAttribute: (k, v) => attrs[k] = String(v), getAttribute: k => attrs[k], removeAttribute: k => delete attrs[k],
        addEventListener: (name, fn) => events[name] = fn,
        querySelector: selector => node(`${key} ${selector}`), querySelectorAll: () => [],
        appendChild: child => appended.push(child), prepend: child => appended.push(child), remove() { this.isConnected = false; }, reset() {},
        contains: () => false, click() {}, focus() {}, dispatchEvent() {},
      });
    }
    return nodes.get(key);
  }
  let created = 0;
  const ctx = {
    console, URL, AbortController, setTimeout, clearTimeout, API_BASE: 'http://local',
    currentUser: { token: 'A', username: 'A', user_id: 1 },
    document: { querySelector: node, querySelectorAll: () => [], createElement: () => node(`modal${++created}`),
      body: { appendChild: child => appended.push(child) }, addEventListener() {} },
    window: { addEventListener() {} },
    isLoggedIn: () => !!ctx.currentUser, isOwner: () => true,
    getAuthHeaders: () => ({ Authorization: 'Bearer ' + ctx.currentUser?.token }),
    escapeHtml: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    safeFileUrl(value) { try { const url = new URL(value, 'http://local'); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } },
    showToast: message => notices.push(message), renderLoadError: (el, msg, retry) => loadErrors.push({ el, msg, retry }),
    skeletonCards: (count, selector) => node(selector).innerHTML = '<skeleton>',
    renderMarkdown: value => value || '', convertForPreview: value => value || '', renderCommentsList: comments => JSON.stringify(comments),
    formatPostDate: () => '', openAuthModal() {}, initMarkdownToolbar() {}, confirm: () => true,
    loadUserSession() {}, initAuthInteractions() {}, initThemeToggle() {}, loadSiteConfig: async () => {}, updateAuthUI() {},
    FormData: class { append() {} }, FileReader: class { readAsDataURL() { this.onload({ target: { result: 'data:image/png,test' } }); } },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ code: 0, data: [] }), text: async () => 'text' }; },
  };
  ctx.requestJson = async (url, options) => {
    const response = await ctx.fetch(url, options);
    const result = await response.json();
    if (!response.ok || result.code !== 0) throw new Error(result.msg || '请求失败');
    return result;
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend', file), 'utf8').replace(/init\(\);\s*$/, ''), ctx);
  return { ctx, node, appended, notices, loadErrors, calls, run: code => vm.runInContext(code, ctx) };
}

for (const [file, load, selector, state, render] of [
  ['personal.js', 'loadPersonalPosts()', '#personal-list', 'personalPosts', 'renderPersonalList'],
  ['library.js', 'loadResources()', '#resource-list', 'resources', 'renderResourceList'],
]) {
  test(`${file} 首次请求失败提供重试并解除忙碌状态`, async () => {
    const h = harness(file);
    h.ctx.fetch = async () => { throw new Error('offline'); };
    await h.run(load);
    assert.equal(h.loadErrors.length, 1);
    assert.equal(typeof h.loadErrors[0].retry, 'function');
    assert.notEqual(h.node(selector).getAttribute('aria-busy'), 'true');
  });
  test(`${file} 后到旧响应不能覆盖新列表，刷新保留已有内容`, async () => {
    const h = harness(file);
    h.run(`${render} = () => {}; ${state} = [{ id: 0 }];`);
    h.node(selector).innerHTML = 'existing content';
    let finishOld, count = 0;
    h.ctx.fetch = () => ++count === 1 ? new Promise(resolve => { finishOld = resolve; })
      : Promise.resolve({ ok: true, json: async () => ({ code: 0, data: [{ id: 2 }] }) });
    const old = h.run(load);
    assert.equal(h.node(selector).innerHTML, 'existing content');
    await h.run(load);
    finishOld({ ok: true, json: async () => ({ code: 0, data: [{ id: 1 }] }) });
    await old;
    assert.equal(h.run(`${state}[0].id`), 2);
  });
}

for (const [file, action] of [['personal.js', 'togglePersonalLike(1)'], ['library.js', 'toggleResourceStar(1)']]) {
  test(`${file} 连点操作只发一次请求，失败有反馈`, async () => {
    const h = harness(file);
    let finish, count = 0;
    h.ctx.fetch = () => { count++; return new Promise(resolve => { finish = resolve; }); };
    const first = h.run(action);
    h.run(action);
    assert.equal(count, 1);
    finish({ ok: true, json: async () => ({ code: 403, msg: '没有权限' }) });
    await first;
    assert.ok(h.notices.some(message => message.includes('没有权限')));
  });
}

test('HTML 资源预览使用隔离 iframe 和真正的关闭按钮', async () => {
  const h = harness('library.js');
  await h.run("openResourcePreview({ file_name: 'x.html', file_url: '/uploads/x.html', title: 'X' })");
  assert.match(h.appended[0].innerHTML, /<iframe[^>]+sandbox=/);
  assert.doesNotMatch(h.appended[0].innerHTML, /sandbox="[^"]*allow-scripts[^"]*allow-same-origin/);
  assert.match(h.appended[0].innerHTML, /<button[^>]+class="custom-modal-close"/);
});

test('资源预览拒绝 javascript URL', async () => {
  const h = harness('library.js');
  await h.run("openResourcePreview({ file_name: 'x.pdf', file_url: 'javascript:alert(1)', title: 'X' })");
  assert.equal(h.appended.length, 0);
  assert.ok(h.notices.length > 0);
});

test('预测连点只发一次请求，更换图片后丢弃旧识别结果', async () => {
  const h = harness('herb.js');
  const file = { name: 'A.png', type: 'image/png', size: 10 };
  h.node('#herb-file').files = [file];
  let finish, count = 0;
  h.ctx.fetch = () => { count++; return new Promise(resolve => { finish = resolve; }); };
  const first = h.run('handlePredict()');
  h.run('handlePredict()');
  assert.equal(count, 1);
  h.ctx.nextFile = { name: 'B.png', type: 'image/png', size: 10 };
  h.run("showPreview(nextFile, document.querySelector('#herb-drop-placeholder'), document.querySelector('#preview-img'))");
  finish({ ok: true, json: async () => ({ code: 0, data: { prediction: 'old result', confidence: 99 } }) });
  await first;
  assert.equal(h.node('#result-content').innerHTML, '');
  assert.equal(h.node('#predict-btn').disabled, false);
});

test('个人评论失败保留草稿，重复提交只发送一次', async () => {
  const h = harness('personal.js');
  h.run("personalPosts = [{ id: 1, content: 'post', author: 'A' }]");
  await h.run('openPersonalDetail(1)');
  const modal = h.appended[0];
  modal.querySelector('textarea').value = 'draft';
  let finish, count = 0;
  h.ctx.fetch = () => { count++; return new Promise(resolve => { finish = resolve; }); };
  const submit = modal.querySelector('.comment-form2').events.submit;
  const first = submit({ preventDefault() {} });
  await submit({ preventDefault() {} });
  assert.equal(count, 1);
  finish({ ok: false, json: async () => ({ code: 500, msg: '保存失败' }) });
  await first;
  assert.equal(modal.querySelector('textarea').value, 'draft');
  assert.equal(modal.querySelector('button[type="submit"]').disabled, false);
  assert.ok(h.notices.some(message => message.includes('保存失败')));
});

for (const [file, action, state, selector] of [
  ['personal.js', 'loadPersonalPosts()', 'personalPosts', '#personal-list'],
  ['library.js', 'loadResources()', 'resources', '#resource-list'],
]) {
  test(`${file} 刷新失败保留卡片并提供独立重试入口`, async () => {
    const h = harness(file);
    h.run(`${state} = [{ id: 1 }]`);
    h.node(selector).innerHTML = 'existing cards';
    h.ctx.fetch = async () => { throw new Error('offline'); };
    await h.run(action);
    assert.equal(h.node(selector).innerHTML, 'existing cards');
    assert.equal(h.loadErrors.length, 1);
    assert.notEqual(h.loadErrors[0].el, h.node(selector));
  });
}

test('预测失败重新启用按钮并显示错误', async () => {
  const h = harness('herb.js');
  h.node('#herb-file').files = [{ type: 'image/png', size: 10 }];
  h.ctx.fetch = async () => ({ ok: true, json: async () => ({ code: 500, msg: '模型不可用' }) });
  await h.run('handlePredict()');
  assert.equal(h.node('#predict-btn').disabled, false);
  assert.ok(h.notices.some(message => message.includes('模型不可用')));
});

test('图片读取中切换模型仍能显示该图片的预览', () => {
  const h = harness('herb.js');
  let reader;
  h.ctx.FileReader = class { constructor() { reader = this; } readAsDataURL() {} };
  h.run("showPreview({ type: 'image/png', size: 10 }, document.querySelector('#herb-drop-placeholder'), document.querySelector('#preview-img')); invalidatePrediction();");
  reader.onload({ target: { result: 'data:image/png,current' } });
  assert.equal(h.node('#preview-img').src, 'data:image/png,current');
});

test('个人图片可以通过 Tab 聚焦并用 Enter 或空格打开', () => {
  const h = harness('personal.js');
  h.run("personalPosts = [{ id: 1, content: 'post', author: 'A', image_urls: ['/uploads/image.png'] }]; renderPersonalList(); initInteractions();");
  assert.match(h.node('#personal-list').innerHTML, /<img[^>]*role="button"[^>]*tabindex="0"/);
  const handler = h.node('#personal-list').events.keydown;
  assert.equal(typeof handler, 'function');
  let clicked = 0, prevented = 0;
  const image = { click() { clicked++; } };
  for (const key of ['Enter', ' ']) handler({ key, target: { closest: () => image }, preventDefault() { prevented++; } });
  assert.equal(clicked, 2);
  assert.equal(prevented, 2);
});
