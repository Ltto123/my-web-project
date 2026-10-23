// Uses a fresh browser context; never changes the user's preference or business data.
async (page) => {
  const origin = 'http://127.0.0.1:8766';
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const checks = [];
  const check = (ok, message) => { if (!ok) throw new Error(message); checks.push(message); };
  const prepare = async target => {
    if (!await target.evaluate(() => !!window.BlogAppearance)) await target.addScriptTag({ url: `${origin}/appearance.js` });
    if (!await target.locator('link[href*="appearance.css"]').count()) await target.addStyleTag({ url: `${origin}/appearance.css` });
  };
  try {
    const testPage = await context.newPage();
    testPage.on('pageerror', error => errors.push(error.message));
    await testPage.goto(origin);
    await prepare(testPage);
    check(await testPage.locator('#appearance-btn').count() === 1, 'One appearance trigger');
    await testPage.evaluate(() => {
      window.appearanceEvents = [];
      document.addEventListener('appearance-changed', event => appearanceEvents.push(event.detail.appearance));
      const field = document.querySelector('#post-title');
      if (field) { field.value = 'Unfinished draft'; window.draftField = field; }
    });
    await testPage.locator('#appearance-btn').click();
    await testPage.locator('[data-choose-appearance="spring"]').click();
    check(await testPage.locator('#appearance-modal').isVisible(), 'Selection leaves picker available');
    check(await testPage.locator('[data-choose-appearance="spring"]').getAttribute('aria-pressed') === 'true', 'Selected state exposed');
    check(await testPage.evaluate(() => appearanceEvents.at(-1) === 'spring' && localStorage.getItem('blog_appearance') === 'spring'), 'Appearance event and preference agree');
    check(await testPage.evaluate(() => !window.draftField || (draftField === document.querySelector('#post-title') && draftField.value === 'Unfinished draft')), 'Business draft DOM preserved');
    await testPage.keyboard.press('Escape');
    await testPage.waitForFunction(() => document.activeElement.id === 'appearance-btn');
    check(await testPage.locator('#appearance-modal').count() === 0, 'Escape dismisses and restores focus');
    await testPage.locator('#theme-btn').click();
    check(await testPage.evaluate(() => document.documentElement.dataset.tone === (document.body.classList.contains('dark-theme') ? 'dark' : 'light')), 'Tone and body remain synchronized');
    await testPage.goto(`${origin}/vocab`);
    await prepare(testPage);
    check(await testPage.evaluate(() => document.documentElement.dataset.appearance === 'spring'), 'Appearance persists across pages');
    const sibling = await context.newPage();
    sibling.on('pageerror', error => errors.push(error.message));
    await sibling.goto(`${origin}/library`);
    await prepare(sibling);
    await sibling.evaluate(() => { localStorage.setItem('blog_appearance', 'summer'); localStorage.setItem('dark_mode_active', 'true'); });
    await testPage.waitForFunction(() => document.documentElement.dataset.appearance === 'summer' && document.documentElement.dataset.tone === 'dark' && document.body.classList.contains('dark-theme'));
    check(true, 'Cross-tab appearance and tone synchronize');
    await sibling.evaluate(() => localStorage.setItem('blog_appearance', '<script>invalid</script>'));
    await testPage.waitForFunction(() => document.documentElement.dataset.appearance === 'art');
    check(true, 'Invalid cross-tab value falls back to art');
    await testPage.locator('#appearance-btn').click();
    await testPage.locator('[data-choose-appearance="winter"]').click();
    await testPage.evaluate(() => openAuthModal('login'));
    await testPage.waitForFunction(() => document.querySelector('#appearance-modal').inert);
    await testPage.keyboard.press('Escape');
    await testPage.waitForFunction(() => !document.querySelector('#appearance-modal').inert);
    check(await testPage.locator('#appearance-modal').isVisible(), 'Nested auth dialog preserves picker');
    await testPage.keyboard.press('Escape');
    for (const width of [320, 390, 768, 1440]) {
      await testPage.setViewportSize({ width, height: 960 });
      await testPage.locator('#appearance-btn').click();
      check(await testPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Picker and header fit ${width}px`);
      await testPage.locator('.appearance-done').click();
    }
    check(errors.length === 0, `No page errors: ${errors.join('; ')}`);
    return { checks, pageErrors: errors };
  } finally { await context.close(); }
}
