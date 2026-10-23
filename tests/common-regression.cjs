const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup({storageBlocked = false} = {}) {
  const values = new Map();
  const listeners = {};
  const storage = {getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k)};
  const window = {location: {origin: 'http://localhost', protocol: 'http:', pathname: '/'}, addEventListener: (k, fn) => {listeners[k] = fn;}};
  Object.defineProperty(window, 'localStorage', {get() {if (storageBlocked) throw new Error('denied'); return storage;}});
  const document = {querySelector: () => null, querySelectorAll: () => [], dispatchEvent: () => {}};
  const context = vm.createContext({window, document, console, setTimeout: () => 1, clearTimeout: () => {}, atob, TextDecoder, Uint8Array, Map, CustomEvent: class {}});
  const source = fs.readFileSync('frontend/common.js', 'utf8').replace(/renderMainNav\(\);\s*initBackToTop\(\);\s*initEditorPaste\(\);\s*$/, '');
  vm.runInContext(source, context);
  return {context, storage, listeners, run: code => vm.runInContext(code, context)};
}

test('cross-tab logout clears stale identity and expiry timer', () => {
  const app = setup();
  app.run('currentUser = {token:"old", username:"Alice"}; logoutTimer = 10;');
  app.listeners.storage({key: 'blog_token'});
  assert.equal(app.run('currentUser'), null);
  assert.equal(app.run('logoutTimer'), null);
});

test('JWT payload supports UTF-8 and base64url', () => {
  const app = setup();
  const payload = Buffer.from(JSON.stringify({username: '博主', exp: 2000000000})).toString('base64url');
  app.context.token = `header.${payload}.signature`;
  assert.equal(app.run('decodeJwtPayload(token).username'), '博主');
});

test('legacy expired token is not restored without expires_at', () => {
  const app = setup();
  const payload = Buffer.from(JSON.stringify({exp: 1})).toString('base64url');
  app.storage.setItem('blog_token', JSON.stringify({token: `a.${payload}.b`, username: 'Alice'}));
  app.run('loadUserSession()');
  assert.equal(app.run('isLoggedIn()'), false);
});

test('storage blocked by browser does not break shared script', () => {
  const app = setup({storageBlocked: true});
  assert.doesNotThrow(() => app.run('loadUserSession(); safeStorage.setItem("theme", "dark");'));
});

test('missing sanitizer fails closed even when markdown parser exists', () => {
  const app = setup();
  app.context.marked = {setOptions() {}, parse: text => text};
  assert.equal(app.run('renderMarkdown("<img src=x onerror=alert(1)>")').includes('<img'), false);
});

test('write-only storage failure preserves the in-memory session on reload', () => {
  const app = setup();
  app.storage.setItem = () => {throw new Error('quota');};
  const payload = Buffer.from(JSON.stringify({exp:2000000000})).toString('base64url');
  app.context.user = {token:`a.${payload}.b`,user_id:1,username:'Alice'};
  app.run('saveUserSession(user); loadUserSession();');
  assert.equal(app.run('isLoggedIn()'),true);
});
