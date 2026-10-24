// An isolated, read-only browser: no accounts, uploads, or shared browser preferences.
const { chromium } = require(process.env.SEASON_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel:'chrome', headless:true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const output = path.resolve('.tmp/season-hero');
  fs.mkdirSync(output, { recursive:true });
  try {
    await page.goto('http://127.0.0.1:8766/');
    await page.emulateMedia({ reducedMotion:'reduce' });
    const results = [];
    for (const season of ['spring','summer','autumn','winter']) {
      await page.evaluate(value => BlogAppearance.apply(value), season);
      await page.waitForFunction(() => {
        const image = document.querySelector('.season-main-photo');
        return image?.complete && image.naturalWidth > 0;
      });
      for (const width of [320,390,768,1440]) {
        await page.setViewportSize({ width, height:1050 });
        const layout = await page.evaluate(() => {
          const bounds = selector => {
            const box = document.querySelector(selector).getBoundingClientRect();
            return { left:box.left, top:box.top, right:box.right, bottom:box.bottom, width:box.width, height:box.height };
          };
          const title = bounds('#season-title');
          const copy = bounds('.season-hero-copy');
          const titleStyle = getComputedStyle(document.querySelector('#season-title'));
          return {
            season:document.documentElement.dataset.appearance,
            width:innerWidth,
            overflow:document.documentElement.scrollWidth-innerWidth,
            title, copy, photo:bounds('.season-photo-wrap'),
            titleColor:titleStyle.color,
            display:bounds('.season-hero-display'),
          };
        });
        assert.ok(layout.overflow <= 1, `${season} overflows at ${width}: ${layout.overflow}`);
        assert.ok(layout.title.left >= 0 && layout.title.right <= width + 1, `${season} title clips at ${width}`);
        assert.ok(layout.title.bottom <= layout.copy.bottom + 1, `${season} copy clips title at ${width}`);
        if (season === 'winter') assert.ok(layout.copy.bottom <= layout.photo.top + 1, `Winter copy overlaps the photograph at ${width}`);
        if (season === 'summer') {
          const targets = await page.locator('#season-title [data-destination]').evaluateAll(buttons => buttons.map(button => ({ height:button.getBoundingClientRect().height, label:button.textContent })));
          assert.equal(targets.length, 2, 'Summer destinations must be part of the heading');
          assert.ok(targets.every(target => target.height >= 44), 'Destination heading touch targets are too small');
          assert.deepEqual(targets.map(target => target.label), ['去看海。','去那拉提。']);
        }
        results.push(layout);
        if (width === 390 || width === 1440) {
          await page.screenshot({ path:path.join(output, `${season}-${width}.png`), fullPage:false });
        }
      }
    }
    await page.evaluate(() => BlogAppearance.apply('summer'));
    await page.locator('[data-destination="meadow"]').click();
    await page.waitForFunction(() => document.querySelector('.season-main-photo').dataset.scene === 'meadow');
    assert.equal(await page.locator('[data-destination="meadow"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-destination="sea"]').click();
    await page.waitForFunction(() => document.querySelector('.season-main-photo').dataset.scene === 'sea');
    assert.equal(await page.locator('.season-photo-fade').count(), 0, 'Reduced motion should skip scene animation');
    await page.emulateMedia({ reducedMotion:'no-preference' });
    await page.evaluate(() => document.body.classList.remove('garden-motion-off'));
    await page.locator('[data-destination="meadow"]').click();
    await page.waitForFunction(() => document.querySelector('.season-photo-fade'));
    await page.locator('[data-destination="sea"]').click();
    await page.waitForFunction(() => document.querySelector('.season-main-photo').dataset.scene === 'sea');
    await page.waitForFunction(() => !document.querySelector('.season-photo-fade'));
    assert.equal(await page.locator('[data-destination="sea"]').getAttribute('aria-pressed'), 'true');
    // Changing motion preferences during a Web Animation must settle it immediately.
    await page.locator('[data-destination="meadow"]').click();
    await page.waitForFunction(() => document.querySelector('.season-photo-fade'));
    await page.evaluate(() => document.body.classList.add('garden-motion-off'));
    await page.waitForFunction(() => !document.querySelector('.season-photo-fade'));
    assert.equal(await page.locator('.season-main-photo').getAttribute('data-scene'), 'meadow');
    await page.evaluate(() => document.body.classList.remove('garden-motion-off'));
    await page.locator('[data-destination="sea"]').click();
    await page.waitForFunction(() => document.querySelector('.season-photo-fade'));
    await page.emulateMedia({ reducedMotion:'reduce' });
    await page.waitForFunction(() => !document.querySelector('.season-photo-fade'));
    assert.equal(await page.locator('.season-main-photo').getAttribute('data-scene'), 'sea');
    await page.locator('.season-enter').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'journal');
    await page.evaluate(() => BlogAppearance.apply('art'));
    assert.equal(await page.locator('.season-hero').isVisible(), false);
    assert.equal(await page.locator('.utopia-hero').isVisible(), true);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'layout-results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ checks:results.length, summerSwitch:true, sceneCrossfade:true, winterCopyOutsideImage:true, journalFocus:true, artRestored:true, pageErrors:errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
