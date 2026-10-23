const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function bootstrap(values, blocked = false) {
  const root = { dataset: {}, style: {} };
  const storage = { getItem(key) { if (blocked) throw new Error('Storage denied'); return values[key] ?? null; } };
  vm.runInNewContext(fs.readFileSync('frontend/appearance-bootstrap.js', 'utf8'), { document: { documentElement: root }, window: { localStorage: storage } });
  return root;
}

test('appearance is valid before the body exists, independently of light or dark mode', () => {
  for (const appearance of ['art', 'spring', 'summer', 'autumn', 'winter']) {
    for (const dark of ['true', 'false']) {
      const root = bootstrap({ blog_appearance: appearance, dark_mode_active: dark });
      assert.equal(root.dataset.appearance, appearance);
      assert.equal(root.dataset.tone, dark === 'true' ? 'dark' : 'light');
      assert.equal(root.style.colorScheme, root.dataset.tone);
    }
  }
});

test('invalid saved appearances cannot escape the allowlist', () => {
  for (const value of ['', '__proto__', '<img onerror=alert(1)>', 'Spring', null]) {
    assert.equal(bootstrap({ blog_appearance: value }).dataset.appearance, 'art');
  }
});

test('unavailable storage preserves the existing dark artistic default', () => {
  const root = bootstrap({}, true);
  assert.equal(root.dataset.appearance, 'art');
  assert.equal(root.dataset.tone, 'dark');
});
