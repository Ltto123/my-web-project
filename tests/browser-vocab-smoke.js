async (page) => {
  // 独立浏览器上下文，模拟词集 API；不调用付费 AI，不写数据库。
  const context = await page.context().browser().newContext({viewport:{width:320,height:844},reducedMotion:'reduce'});
  try {
  const testPage = await context.newPage();
  const check = (value, message) => {if (!value) throw new Error(message);};
  await context.addInitScript(({exp}) => {
    const token = 'e30.' + btoa(JSON.stringify({exp})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'') + '.audit';
    localStorage.setItem('blog_token',JSON.stringify({token,user_id:1,username:'test_vocab_ui'}));
  }, {exp:Math.floor(Date.now()/1000)+3600});
  let progressWrites = 0;
  const words = [1,2].map(id => ({id,set_id:71,word:id===1?'interdisciplinary':'characteristically',pos:'adv.',def_zh:'跨学科地理解、联系与运用知识。'.repeat(12),def_en:'A deliberately long definition for responsive reading and learning. '.repeat(9),example_en:'We connect ideas from different fields to understand the world around us.',example_zh:'我们把来自不同领域的想法联系起来，理解周围的世界。'}));
  await context.route('**/api/v1/vocab/**', async route => {
    const path = route.request().url().split('?')[0].replace(/^https?:\/\/[^/]+/, '');
    let data;
    if (path.endsWith('/sets')) data = [{id:71,name:'手机端长释义验证词集',word_count:2,user_id:1,status:'completed',progress_pct:0}];
    else if (path.endsWith('/sets/71')) data = {id:71,name:'手机端长释义验证词集',user_id:1,words};
    else if (route.request().method() === 'POST') { progressWrites++; data={}; }
    else data = {};
    await route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,msg:'success',data})});
  });
    await testPage.goto('http://127.0.0.1:8765/vocab?audit=long-card',{waitUntil:'domcontentloaded'});
    const entry = testPage.locator('[data-open-set="71"]');
    await entry.focus();
    await testPage.keyboard.press('Enter');
    await testPage.waitForSelector('#vocab-learn-section:not(.hidden)');
    check(await testPage.evaluate(()=>document.activeElement.id==='vocab-learn-section'),'learning focus not moved');
    await testPage.keyboard.press('ArrowRight');
    await testPage.waitForFunction(()=>document.querySelector('#vocab-card-back').getAttribute('aria-hidden')==='false');
    await testPage.waitForSelector('#btn-pass');
    check(progressWrites===1,'keyboard learning sent duplicate writes');
    const dimensions = await testPage.evaluate(()=>({pageWidth:innerWidth,scrollWidth:document.documentElement.scrollWidth,cardHeight:document.querySelector('#vocab-card-inner').getBoundingClientRect().height,backHeight:document.querySelector('#vocab-card-back').getBoundingClientRect().height,backScroll:document.querySelector('#vocab-card-back').scrollHeight,frontHidden:document.querySelector('#vocab-card-front').getAttribute('aria-hidden')}));
    check(dimensions.scrollWidth<=dimensions.pageWidth,'long card horizontal overflow');
    check(dimensions.backScroll<=dimensions.backHeight+2,'long definition clipped');
    check(dimensions.frontHidden==='true','both sides exposed to screen reader');
    await testPage.screenshot({path:'C:/Users/dudu1/my-project/.tmp/blog-audit/mobile-long-vocab.png',fullPage:true});
    await testPage.locator('.vocab-mode-tab[data-mode="spelling"]').click();
    await testPage.waitForSelector('#spell-input');
    await testPage.locator('#spell-input').fill('incorrect-answer');
    await testPage.locator('#btn-spell-submit').click();
    await testPage.waitForFunction(()=>document.querySelector('#spell-result').textContent.length>0);
    await testPage.locator('#vocab-back-btn').click();
    await testPage.waitForFunction(()=>document.activeElement.matches('[data-open-set="71"]'));
    await testPage.locator('#logout-btn').click();
    await testPage.waitForFunction(()=>!document.querySelector('[data-open-set]'));
    check(await testPage.locator('#vocab-card-back').textContent()==='','private answer remains after logout');
    return {passed:['keyboard set entry','learning focus and shortcut','320px long card','card screen-reader state','spelling feedback','return focus','logout data clearing'],dimensions};
  } finally { await context.close(); }
}
