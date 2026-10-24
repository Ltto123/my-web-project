// Read-only UI checks in a disposable context; no account or business data is touched.
async (page) => {
  const origin = 'http://127.0.0.1:8766';
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
  const checks = [];
  const errors = [];
  const check = (result, message) => { if (!result) throw new Error(message); checks.push(message); };
  const fireGeometry = target => target.locator('.atmosphere-fire-scene').evaluate(element => {
    const scene = element.getBoundingClientRect();
    const photo = element.querySelector('.atmosphere-fire-photo').getBoundingClientRect();
    return {
      viewport: [innerWidth, innerHeight],
      scene: [scene.left, scene.top, scene.width, scene.height, scene.bottom],
      photo: [photo.left - scene.left, photo.top - scene.top, photo.width, photo.height],
      clipped: getComputedStyle(element).overflow === 'hidden'
    };
  });
  const fillsLowerThird = geometry => {
    const [width, height] = geometry.viewport;
    const [left, top, fireWidth, fireHeight, bottom] = geometry.scene;
    return Math.abs(left) <= 1 && Math.abs(fireWidth - width) <= 1 &&
      Math.abs(top - height * 2 / 3) <= 1 && Math.abs(fireHeight - height / 3) <= 1.5 &&
      bottom >= height && bottom <= height + 1.5 && geometry.clipped;
  };
  const sameFireGeometry = (first, second) => ['viewport', 'scene', 'photo'].every(key =>
    first[key].every((value, index) => Math.abs(value - second[key][index]) <= 1));
  const prepare = async target => {
    if (!await target.locator('link[href*="season-atmosphere.css"]').count()) await target.addStyleTag({ url: `${origin}/season-atmosphere.css` });
    // The runtime is idempotent; this supports testing before HTML integration.
    await target.addScriptTag({ url: `${origin}/season-atmosphere.js` });
  };
  try {
    await context.addInitScript(() => {
      localStorage.setItem('blog_appearance', 'summer');
      localStorage.setItem('garden_motion_paused', 'false');
      window.atmosphereDrawMetrics = new WeakMap();
      const prototype = window.WebGLRenderingContext?.prototype;
      if (prototype) {
        const draw = prototype.drawArrays, remove = prototype.deleteTexture;
        prototype.drawArrays = function(...args) {
          if (this.canvas.classList.contains('atmosphere-fire-canvas')) {
            const metrics = atmosphereDrawMetrics.get(this.canvas) || { frames: 0, deleted: 0, times: [] };
            metrics.frames++; metrics.times.push(performance.now()); atmosphereDrawMetrics.set(this.canvas, metrics);
          }
          return draw.apply(this, args);
        };
        prototype.deleteTexture = function(...args) {
          const metrics = atmosphereDrawMetrics.get(this.canvas);
          if (metrics) metrics.deleted++;
          return remove.apply(this, args);
        };
      }
    });
    const target = await context.newPage();
    target.on('pageerror', error => errors.push(error.message));
    await target.goto(origin); await prepare(target);
    check(await target.locator('.season-atmosphere').count() === 1, 'One atmosphere layer after repeated loading');
    check(await target.locator('.season-atmosphere').getAttribute('data-running') === 'true', 'Summer air starts with global motion');
    check(await target.evaluate(() => {
      const rect = document.querySelector('.season-atmosphere').getBoundingClientRect();
      return rect.width === innerWidth && rect.height === innerHeight && getComputedStyle(document.querySelector('.season-atmosphere')).pointerEvents === 'none';
    }), 'Breeze fills viewport without capturing input');
    const trailBefore = await target.locator('.atmosphere-wind-bands').evaluate(element => getComputedStyle(element).strokeDashoffset);
    await target.waitForTimeout(220);
    check(trailBefore !== await target.locator('.atmosphere-wind-bands').evaluate(element => getComputedStyle(element).strokeDashoffset), 'Wind travels across the page');
    await target.locator('.atmosphere-toggle').click();
    check(await target.locator('.season-atmosphere').getAttribute('data-running') === 'false', 'Local air control pauses the whole scene');
    check(await target.evaluate(() => document.querySelector('.season-atmosphere').getAnimations({ subtree: true }).every(animation => animation.playState === 'paused')), 'Paused summer has no running CSS animation');
    await target.locator('.atmosphere-toggle').click();
    await target.evaluate(() => BlogAppearance.apply('winter'));
    check(await target.locator('.atmosphere-fire-scene').count() === 1 && await target.locator('.atmosphere-wind-field,.atmosphere-hearth').count() === 0, 'Winter replaces air with free-standing fire and no stone frame');
    check(fillsLowerThird(await fireGeometry(target)), 'Fire spans the full viewport width and bottom third without a floor gap');
    await target.waitForFunction(() => document.querySelector('.season-atmosphere').dataset.fireRenderer === 'webgl');
    const runningFireGeometry = await fireGeometry(target);
    check(await target.locator('.atmosphere-fire-photo').evaluate(element => element.complete && element.naturalWidth > 0 && new URL(element.src).origin === location.origin), 'Fire uses the real local photograph');
    check(await target.locator('.atmosphere-fire-photo').evaluate(element => element.naturalWidth / element.naturalHeight >= 1.4), 'The flame photograph is a wide composition rather than a tall column');
    check(await target.locator('.atmosphere-fire-canvas').evaluate(element => element.width * element.height <= 501000), 'Fire framebuffer stays within the half-million-pixel budget');
    const flameBefore = await target.locator('.atmosphere-fire-canvas').screenshot();
    await target.waitForTimeout(400);
    const flameAfter = await target.locator('.atmosphere-fire-canvas').screenshot();
    check(flameBefore.length !== flameAfter.length || flameBefore.some((value, index) => value !== flameAfter[index]), 'The actual flame pixels change within the texture');
    const cadence = await target.evaluate(() => new Promise(resolve => {
      const canvas = document.querySelector('.atmosphere-fire-canvas');
      let referenceFrames = 0, start = 0, firstDraw = 0;
      const observe = now => {
        if (!referenceFrames) { start = now; firstDraw = atmosphereDrawMetrics.get(canvas).frames; }
        else if (now - start >= 1000) {
          resolve({ referenceFrames, drawnFrames: atmosphereDrawMetrics.get(canvas).frames - firstDraw });
          return;
        }
        referenceFrames++;
        requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
    }));
    check(cadence.drawnFrames > 0 && Math.abs(cadence.drawnFrames - cadence.referenceFrames) <= 2, 'Winter draws once per display frame without alternating skipped refreshes');
    await target.locator('.atmosphere-toggle').click();
    const localPauseFrame = await target.locator('.atmosphere-fire-canvas').evaluate(element => atmosphereDrawMetrics.get(element).frames);
    await target.waitForTimeout(150);
    check(localPauseFrame === await target.locator('.atmosphere-fire-canvas').evaluate(element => atmosphereDrawMetrics.get(element).frames), 'Local winter pause cancels all frame scheduling');
    check(await target.locator('.atmosphere-fire-photo').isVisible(), 'Local pause restores the static photograph');
    await target.locator('.atmosphere-toggle').click();
    const hearthTop = await target.locator('.atmosphere-fire-scene').evaluate(element => element.getBoundingClientRect().top);
    await target.evaluate(() => scrollTo(0, 700));
    check(Math.abs(hearthTop - await target.locator('.atmosphere-fire-scene').evaluate(element => element.getBoundingClientRect().top)) < 1, 'Fire remains in the room while the document scrolls');
    await target.evaluate(() => scrollTo(0, 0));
    await target.locator('#motion-toggle').click();
    check(await target.locator('.atmosphere-toggle').isDisabled(), 'Global pause controls the local atmosphere switch');
    check(await target.locator('.season-atmosphere').getAttribute('data-running') === 'false' && await target.locator('.atmosphere-fire-photo').isVisible(), 'Global pause leaves a visible static fire');
    const globalPauseFrame = await target.locator('.atmosphere-fire-canvas').evaluate(element => atmosphereDrawMetrics.get(element).frames);
    await target.waitForTimeout(150);
    check(globalPauseFrame === await target.locator('.atmosphere-fire-canvas').evaluate(element => atmosphereDrawMetrics.get(element).frames), 'Global winter pause cancels all frame scheduling');
    check(await target.evaluate(() => document.querySelector('.season-atmosphere').getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')), 'Global pause removes all animated fire and embers');
    await target.locator('#motion-toggle').click();
    await target.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    check(await target.locator('.season-atmosphere').getAttribute('data-running') === 'false', 'Background document pauses the scene');
    const hiddenFrame = await target.locator('.atmosphere-fire-canvas').evaluate(element => atmosphereDrawMetrics.get(element).frames);
    await target.waitForTimeout(150);
    check(hiddenFrame === await target.locator('.atmosphere-fire-canvas').evaluate(element => atmosphereDrawMetrics.get(element).frames), 'A hidden document schedules no fire frames');
    await target.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await target.emulateMedia({ reducedMotion: 'reduce' });
    await target.waitForFunction(() => document.querySelector('.atmosphere-toggle').disabled);
    check(await target.locator('.atmosphere-toggle').isDisabled(), 'Reduced motion disables atmosphere animation controls');
    const reducedFrame = await target.locator('.atmosphere-fire-canvas').evaluate(element => atmosphereDrawMetrics.get(element).frames);
    await target.waitForTimeout(150);
    check(reducedFrame === await target.locator('.atmosphere-fire-canvas').evaluate(element => atmosphereDrawMetrics.get(element).frames), 'Reduced motion schedules no fire frames');
    check(await target.evaluate(() => document.querySelector('.season-atmosphere').getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')), 'Reduced motion has no animation loop');
    check(await target.locator('.atmosphere-fire-photo').isVisible() && !await target.locator('.atmosphere-fire-canvas').isVisible(), 'Reduced motion displays the cropped static photograph');
    const reducedGeometry = await fireGeometry(target);
    check(fillsLowerThird(reducedGeometry) && sameFireGeometry(runningFireGeometry, reducedGeometry), 'Reduced motion preserves the full-width floor position and photograph crop');
    await target.emulateMedia({ reducedMotion: 'no-preference' });
    await target.waitForFunction(() => !document.querySelector('.atmosphere-toggle').disabled);
    await target.locator('#appearance-btn').click();
    check(await target.locator('.atmosphere-dock').evaluate(element => element.inert && getComputedStyle(element).visibility === 'hidden'), 'Atmosphere controls stay out of modal focus order');
    await target.keyboard.press('Escape');
    check(await target.locator('.atmosphere-dock').evaluate(element => !element.inert), 'Closing a dialog restores the atmosphere control');
    await target.evaluate(() => { window.previousFireCanvas = document.querySelector('.atmosphere-fire-canvas'); BlogAppearance.apply('autumn'); });
    check(await target.evaluate(() => !previousFireCanvas.isConnected && atmosphereDrawMetrics.get(previousFireCanvas).deleted > 0), 'Leaving winter deletes the texture and removes its canvas');
    const disposedFrames = await target.evaluate(() => atmosphereDrawMetrics.get(previousFireCanvas).frames);
    await target.waitForTimeout(150);
    check(disposedFrames === await target.evaluate(() => atmosphereDrawMetrics.get(previousFireCanvas).frames), 'Disposed winter has no pending draw loop');
    const sibling = await context.newPage();
    sibling.on('pageerror', error => errors.push(error.message));
    await sibling.goto(`${origin}/library`); await prepare(sibling);
    await target.evaluate(() => {
      BlogAppearance.apply('winter', false);
      BlogAppearance.apply('summer', false);
      window.atmosphereStorageEvents = [];
      addEventListener('storage', event => atmosphereStorageEvents.push(event.key));
    });
    await sibling.evaluate(() => BlogAppearance.apply('winter', false));
    await sibling.locator('.atmosphere-toggle').click();
    await target.waitForFunction(() => atmosphereStorageEvents.includes('garden_atmosphere_winter'));
    check(await target.evaluate(() => BlogAppearance.current === 'summer'), 'Another tab can change winter without changing the current summer view');
    await target.evaluate(() => BlogAppearance.apply('winter', false));
    check(await target.locator('.atmosphere-toggle').getAttribute('aria-pressed') === 'false', 'Returning to winter respects the other tab after its inactive preference changed');
    await target.evaluate(() => BlogAppearance.apply('summer', false));
    await target.locator('.atmosphere-toggle').click();
    await sibling.evaluate(() => localStorage.clear());
    await target.waitForFunction(() => atmosphereStorageEvents.includes(null));
    for (const season of ['winter', 'summer']) {
      await target.evaluate(value => BlogAppearance.apply(value, false), season);
      check(await target.locator('.atmosphere-toggle').getAttribute('aria-pressed') === 'true', `Clearing storage in another tab invalidates the cached ${season} preference`);
    }
    await sibling.close();
    for (const appearance of ['art', 'spring', 'autumn']) {
      await target.evaluate(value => BlogAppearance.apply(value), appearance);
      check(await target.locator('[data-atmosphere-owned]').count() === 0, `${appearance} leaves no summer or winter objects`);
    }
    for (const path of ['/', '/personal', '/library', '/vocab', '/herb']) {
      await target.goto(`${origin}${path}`); await prepare(target);
      await target.evaluate(() => BlogAppearance.apply('winter'));
      check(await target.locator('.atmosphere-fire-scene').count() === 1, `Fire is available on ${path}`);
      check(await target.evaluate(() => [...document.querySelectorAll('.inner-intro,.journal-heading,.studio-toolbar,.category-bar')].every(element => { const style = getComputedStyle(element); return style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.backgroundImage === 'none'; })), `Reading headings on ${path} have no rectangular backing panels`);
      for (const width of [320, 390, 768, 1440]) {
        await target.setViewportSize({ width, height: 960 });
        check(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Atmosphere preserves ${path} at ${width}px`);
        check(fillsLowerThird(await fireGeometry(target)), `Fire fills the bottom third edge to edge on ${path} at ${width}px`);
      }
      await target.setViewportSize({ width: 320, height: 800 });
      for (const season of ['summer', 'winter']) {
        await target.evaluate(value => {
          BlogAppearance.apply(value);
          scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
        }, season);
        check(await target.evaluate(() => {
          const dock = document.querySelector('.atmosphere-dock').getBoundingClientRect();
          const lines = [...document.querySelectorAll('.footer-bottom > *')].filter(node => node.getClientRects().length);
          return lines.length > 0 && lines.every(node => {
            const rect = node.getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= dock.top - 12;
          });
        }), `${season} footer text stays above the fixed control on ${path} at 320px`);
      }
      if (path === '/vocab') {
        await target.evaluate(() => document.body.classList.add('vocab-focus-mode'));
        check(await target.locator('.atmosphere-dock').evaluate(element => element.inert && getComputedStyle(element).visibility === 'hidden'), 'Learning focus hides the atmosphere control');
        await target.evaluate(() => document.body.classList.remove('vocab-focus-mode'));
      }
    }
    const fallback = await context.newPage();
    await fallback.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl' ? null : getContext.call(this, type, ...args); };
    });
    await fallback.goto(origin); await prepare(fallback); await fallback.evaluate(() => BlogAppearance.apply('winter'));
    await fallback.waitForFunction(() => document.querySelector('.season-atmosphere').dataset.fireRenderer === 'static');
    check(await fallback.locator('.atmosphere-fire-photo').isVisible() && !await fallback.locator('.atmosphere-fire-canvas').isVisible(), 'Without WebGL the local static fire remains visible');
    const fallbackGeometry = await fireGeometry(fallback);
    check(fillsLowerThird(fallbackGeometry) && sameFireGeometry(runningFireGeometry, fallbackGeometry), 'Without WebGL the full-width floor position and photograph crop match the animated layout');
    await fallback.close();
    check(errors.length === 0, `No page errors: ${errors.join('; ')}`);
    return { checks, pageErrors: errors };
  } finally { await context.close(); }
}
