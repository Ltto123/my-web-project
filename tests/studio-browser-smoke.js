// 在本地预览页运行。只创建临时 DOM，不写业务数据。
async (page) => {
  const base=await page.evaluate(()=>location.origin);
  if(!/^http:\/\/(localhost|127\.0\.0\.1):/.test(base))throw new Error('仅在本地预览运行');
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  const errors=[];
  const onError=error=>errors.push(error.message);
  const viewport=page.viewportSize();
  page.on('pageerror',onError);
  try {
    await page.goto(base);
    await page.evaluate(()=>{
      const host=document.createElement('div');host.id='studio-test-host';
      host.innerHTML='<button id="studio-test-open" type="button">打开测试工作台</button><section id="studio-test-panel" data-studio-panel><form><label for="studio-test-input">测试草稿</label><input id="studio-test-input" class="form-input"/><button type="button" id="studio-test-nested">登录</button></form></section>';
      document.querySelector('main').prepend(host);
      host.querySelector('#studio-test-open').onclick=()=>GardenUI.openPanel('#studio-test-panel',{title:'工作台测试'});
      host.querySelector('#studio-test-nested').onclick=()=>openAuthModal('login');
    });
    await page.locator('#studio-test-open').click();
    await page.waitForSelector('.studio-overlay');
    await page.locator('#studio-test-input').fill('关闭后保留的草稿');
    await page.locator('#studio-test-nested').click();
    await page.waitForSelector('#auth-modal:not(.hidden)');
    check(await page.locator('.studio-overlay').evaluate(el=>el.inert),'嵌套登录未隔离工作台焦点');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.activeElement.id==='studio-test-nested');
    check(await page.locator('main').evaluate(el=>el.inert),'关闭上层登录误解锁背景');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.activeElement.id==='studio-test-open');
    check(!await page.locator('main').evaluate(el=>el.inert),'关闭后背景仍被锁定');
    await page.locator('#studio-test-open').click();
    check(await page.locator('#studio-test-input').inputValue()==='关闭后保留的草稿','原表单草稿丢失');
    await page.keyboard.press('Escape');
    await page.evaluate(()=>{window.studioTestResult='pending';GardenUI.confirm({title:'只测试，不删除',danger:true}).then(result=>window.studioTestResult=result);});
    await page.waitForSelector('.studio-confirm');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>window.studioTestResult===false);
    await page.evaluate(()=>{window.studioTestResult='pending';GardenUI.confirm({title:'确认测试'}).then(result=>window.studioTestResult=result);});
    await page.locator('[data-confirm]').click();
    await page.waitForFunction(()=>window.studioTestResult===true);
    const checks=[];
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      for(const route of ['/','/personal','/library','/vocab','/herb']) {
        await page.goto(base+route);
        await page.evaluate(()=>document.fonts.ready);
        check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${route} 在 ${width}px 溢出`);
        checks.push(`${route}:${width}`);
      }
    }
    await page.setViewportSize({width:320,height:650});
    for(const dark of [false,true]) {
      await page.evaluate(value=>document.body.classList.toggle('dark-theme',value),dark);
      await page.locator('#login-open-btn').isVisible().then(async guest=>{
        if(guest)await page.locator('#login-open-btn').click();else await page.evaluate(()=>openAuthModal('login'));
      });
      await page.waitForSelector('#auth-modal:not(.hidden)');
      check(await page.locator('.auth-modal-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'移动登录面板横向溢出');
      await page.keyboard.press('Escape');
    }
    check(!errors.length,errors.join('; '));
    return {passed:['原节点与草稿保留','嵌套弹层与焦点恢复','确认取消与确认接受','20 组页面尺寸','明暗主题移动登录'],layoutChecks:checks.length,pageErrors:errors};
  } finally {
    page.off('pageerror',onError);
    if(viewport)await page.setViewportSize(viewport);
    await page.goto(base);
  }
}
