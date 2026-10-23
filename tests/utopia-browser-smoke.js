// 在本地预览页运行；只读检查，不创建业务数据。
async (page) => {
  const base = await page.evaluate(() => location.origin);
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(base)) throw new Error('请先打开本地预览页');
  const original = await page.evaluate(() => ({theme:localStorage.getItem('dark_mode_active'), motion:localStorage.getItem('garden_motion_paused')}));
  const viewport = page.viewportSize();
  const errors = [];
  const onError = error => errors.push(error.message);
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  page.on('pageerror', onError);
  try {
    await page.evaluate(() => {localStorage.removeItem('garden_motion_paused');localStorage.removeItem('dark_mode_active');});
    await page.goto(base);
    await page.emulateMedia({reducedMotion:'no-preference'});
    check(await page.locator('body').evaluate(el=>el.classList.contains('dark-theme')), '新访客默认深色主题失败');
    await page.setViewportSize({width:1440,height:900});
    await page.locator('.utopia-hero').hover({position:{x:100,y:100}});
    await page.waitForFunction(() => parseFloat(document.querySelector('.hero-art').style.getPropertyValue('--art-x')) < -1);
    await page.locator('#motion-toggle').click();
    check(await page.locator('#motion-toggle').getAttribute('aria-pressed') === 'true', '暂停状态错误');
    check(await page.locator('.ribbon-track').evaluate(el=>getComputedStyle(el).animationName) === 'none', '暂停后滚动字幕仍动画');
    await page.goto(base + '/personal');
    check(await page.locator('body').evaluate(el=>el.classList.contains('garden-motion-off')), '跨页未保留暂停偏好');
    await page.locator('#motion-toggle').click();
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(() => document.querySelector('#motion-toggle').disabled);
    check(await page.locator('#motion-toggle').isDisabled(), '未遵循系统减少动态效果设置');
    await page.goto(base);
    check(await page.locator('[data-reveal]').first().evaluate(el=>getComputedStyle(el).opacity) === '1', '减少动态效果时隐藏正文');
    await page.emulateMedia({reducedMotion:'no-preference'});
    if (await page.locator('#auth-guest-area').isVisible()) {
      await page.locator('#garden-write-btn').click();
      await page.waitForSelector('#auth-modal:not(.hidden)');
      check(await page.locator('main').evaluate(el=>el.inert), '登录时背景未隔离焦点');
      await page.keyboard.press('Escape');
      check(await page.locator('#auth-modal').isHidden(), 'Escape 未关闭登录窗口');
      check(await page.evaluate(()=>document.activeElement.id) === 'garden-write-btn', '登录关闭后未恢复写作入口焦点');
    }
    for (const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      for (const route of ['/','/personal','/library','/vocab','/herb']) {
        await page.goto(base + route);
        await page.evaluate(()=>document.fonts.ready);
        check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), `${width}px ${route} 横向溢出`);
        if (route === '/') check(await page.locator('#search-input').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16), '搜索框字体会触发 iOS 自动缩放');
      }
    }
    check(errors.length===0, errors.join('; '));
    return {passed:['默认主题','指针视差','暂停与跨页持久化','系统减少动态效果','登录入口与焦点恢复','5 页 × 4 尺寸无横向溢出','移动搜索字号'],pageErrors:errors};
  } finally {
    page.off('pageerror',onError);
    await page.emulateMedia({reducedMotion:null});
    await page.evaluate(saved=>{
      for (const [key,value] of [['dark_mode_active',saved.theme],['garden_motion_paused',saved.motion]]) {
        if(value===null) localStorage.removeItem(key); else localStorage.setItem(key,value);
      }
    },original);
    if(viewport) await page.setViewportSize(viewport);
    await page.goto(base);
  }
}
