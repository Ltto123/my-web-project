// 独立浏览器上下文和模拟 API：验证进度、刷新恢复及移动布局，不写业务库。
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 320, height: 844 }, reducedMotion: 'reduce' });
  const errors = [];
  let polls = 0;
  let complete = false;
  const state = () => ({id:71,name:'大英三 · 导入进度',status:complete?'completed':'processing',
    parse_stage:complete?'completed':'enriching',parse_progress_pct:complete?100:54,
    processed_words:complete?577:312,total_words:577,word_count:complete?577:0,
    elapsed_seconds:complete?28:17,completed_batches:complete?25:13,total_batches:25,
    progress_message:complete?'词集已准备好':'AI 已完成 312/577 词',progress_pct:0});
  try {
    await context.addInitScript(() => {
      const token = 'e30.' + btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})) + '.test';
      localStorage.setItem('blog_token',JSON.stringify({token,user_id:1,username:'test_vocab_ui'}));
    });
    await context.route('**/api/v1/vocab/**', async route => {
      const url = new URL(route.request().url());
      let data;
      if (url.pathname.endsWith('/sets')) data = [state(),{id:72,name:'失败任务',status:'error',word_count:0,
        parse_stage:'error',elapsed_seconds:null,error_message:'API 超时，请重试 <script>bad()</script>'}];
      else if (url.pathname.endsWith('/status')) {polls++;data=state();}
      else data={...state(),words:[{id:1,word:'grave',def_zh:'严重的\n墓穴',def_en:'serious; a burial place'}]};
      await route.fulfill({json:{code:0,msg:'success',data}});
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.VOCAB_TEST_URL || 'http://127.0.0.1:8766/vocab', {waitUntil:'networkidle'});
    await page.getByText('AI 54%',{exact:true}).waitFor();
    assert.match(await page.locator('#vocab-sets-grid').innerText(), /312 \/ 577/);
    assert.match(await page.locator('#vocab-sets-grid').innerText(), /耗时未记录/);
    assert.match(await page.locator('#vocab-sets-grid').innerText(), /API 超时/);
    assert.equal(await page.locator('#vocab-sets-grid script').count(), 0);
    await page.locator('#vocab-sets-grid').screenshot({path:path.resolve('.tmp/vocab-progress-320.png')});
    const width = await page.evaluate(() => ({window:innerWidth,actual:document.documentElement.scrollWidth}));
    assert.ok(width.actual <= width.window, JSON.stringify(width));
    const before = polls;
    await page.reload({waitUntil:'networkidle'});
    await page.waitForFunction(() => document.querySelector('[role="progressbar"][aria-valuenow="54"]'));
    await page.waitForTimeout(2500);
    assert.ok(polls > before, '刷新后没有恢复轮询');
    complete = true;
    await page.getByText('577 个单词',{exact:false}).waitFor({timeout:7000});
    await page.setViewportSize({width:1440,height:900});
    complete = false;
    await page.reload({waitUntil:'networkidle'});
    await page.getByText('AI 54%',{exact:true}).waitFor();
    await page.locator('#vocab-sets-grid').screenshot({path:path.resolve('.tmp/vocab-progress-desktop.png')});
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({passed:true,mobileWidth:width,restoredPolling:true,polls,pageErrors:errors}));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode=1; });
