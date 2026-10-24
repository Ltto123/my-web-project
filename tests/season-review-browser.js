// Isolated, read-only browser regressions for the seasonal review findings.
async (page) => {
  const origin = 'http://127.0.0.1:8766';
  const browser = page.context().browser();
  const checks = [];
  const check = (ok, message) => { if (!ok) throw new Error(message); checks.push(message); };
  const lightBackgrounds = {
    spring: 'rgb(244, 245, 233)', summer: 'rgb(239, 246, 243)',
    autumn: 'rgb(244, 237, 222)', winter: 'rgb(241, 238, 233)',
  };

  // Hold the runtime script so a correct post-load screenshot cannot hide a
  // wrong first paint. The bootstrap and styles must restore the saved tone.
  for (const [season, expectedBackground] of Object.entries(lightBackgrounds)) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    let releaseRuntime;
    let navigation;
    try {
      await context.addInitScript(value => {
        localStorage.setItem('blog_appearance', value);
        localStorage.setItem('dark_mode_active', 'false');
        localStorage.setItem('garden_motion_paused', 'true');
      }, season);
      const target = await context.newPage();
      const errors = [];
      target.on('pageerror', error => errors.push(error.message));
      const gate = new Promise(resolve => { releaseRuntime = resolve; });
      await target.route('**/common.js?*', async route => { await gate; await route.continue(); });
      navigation = target.goto(`${origin}/library`);
      await target.waitForFunction(() => document.body && [...document.styleSheets].some(sheet => sheet.href?.includes('appearance.css')));
      const before = await target.evaluate(() => ({
        tone: document.documentElement.dataset.tone,
        appearance: document.documentElement.dataset.appearance,
        background: getComputedStyle(document.body).backgroundColor,
        danger: getComputedStyle(document.body).getPropertyValue('--c-danger').trim(),
        runtimeReady: !!window.BlogAppearance,
      }));
      check(!before.runtimeReady, `${season}: first-paint assertion runs before the runtime`);
      check(before.tone === 'light' && before.appearance === season && before.background === expectedBackground,
        `${season}: saved light palette is present at first paint (${before.background})`);
      check(before.danger === '#a53332', `${season}: first-paint danger text uses its light palette`);
      releaseRuntime();
      await navigation;
      await target.waitForFunction(() => !!window.BlogAppearance);
      const after = await target.evaluate(() => getComputedStyle(document.body).backgroundColor);
      check(after === before.background, `${season}: runtime initialization does not flash another background`);
      check(errors.length === 0, `${season}: no runtime errors`);
    } finally {
      releaseRuntime?.();
      if (navigation) await navigation.catch(() => {});
      await context.close();
    }
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    await context.addInitScript(() => localStorage.setItem('garden_motion_paused', 'true'));
    const target = await context.newPage();
    const errors = [];
    target.on('pageerror', error => errors.push(error.message));
    await target.goto(origin);
    await target.waitForFunction(() => !!window.BlogAppearance);
    for (const season of Object.keys(lightBackgrounds)) {
      await target.evaluate(value => BlogAppearance.apply(value), season);
      const link = target.locator('.garden-colophon a');
      await link.scrollIntoViewIfNeeded();
      check(await target.evaluate(() => scrollY > 1000), `${season}: return link starts below the opening`);
      await link.click();
      await target.waitForFunction(() => scrollY < 300);
      check(await target.evaluate(() => document.querySelector('.season-hero').getBoundingClientRect().top < 200),
        `${season}: return link reaches the visible seasonal opening`);
    }

    await target.evaluate(() => BlogAppearance.apply('art'));
    for (const width of [320, 390, 1440]) {
      await target.setViewportSize({ width, height: 1000 });
      await target.locator('#appearance-btn').click();
      const card = target.locator('[data-choose-appearance="art"]');
      await card.scrollIntoViewIfNeeded();
      const label = await card.evaluate(button => {
        const bounds = button.getBoundingClientRect();
        const texts = [...button.querySelectorAll('.appearance-choice-label strong,.appearance-choice-detail')];
        return {
          text: texts.map(node => node.textContent).join(' '),
          contained: texts.every(node => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return [...range.getClientRects()].every(rect => rect.width > 0 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1);
          }),
        };
      });
      check(label.text.includes('艺术花园') && label.text.includes('让灵感，自由生长。') && label.contained,
        `Art choice title and description remain inside the card at ${width}px`);
      await card.click();
      check(await card.getAttribute('aria-pressed') === 'true', `Art choice is selectable at ${width}px`);
      await target.keyboard.press('Escape');
      await target.waitForFunction(() => document.activeElement.id === 'appearance-btn');
    }
    check(errors.length === 0, 'Navigation and picker produce no runtime errors');
    return { checks, pageErrors: errors };
  } finally { await context.close(); }
}
