async (page) => {
  const base = 'http://127.0.0.1:8765';
  const username = `test_ui_${Date.now().toString().slice(-8)}`;
  const password = 'Audit-pass-2026!';
  const posts = [];
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const api = async (path, options = {}) => {
    const response = await page.request.fetch(base + path, options);
    const result = await response.json();
    check(result.code === 0, `${path}: ${result.msg}`);
    return result.data;
  };
  await api('/api/v1/auth/register', {method:'POST', data:{username,password}});
  const session = await api('/api/v1/auth/login', {method:'POST', data:{username,password}});
  const headers = {Authorization:`Bearer ${session.token}`};
  try {
    await page.goto(base + '/?audit=reset', {waitUntil:'domcontentloaded'});
    await page.evaluate(() => { localStorage.removeItem('blog_token'); localStorage.setItem('dark_mode_active','false'); });
    for (const [title,content] of [
      ['在日常里，留一处安静的角落', '## 测试文章\n\n这是一篇本地界面验证内容。记录学习中的新发现，也记录平常日子里的小小进展。\n\n**保持好奇，慢慢积累。**\n\n行内公式 $E=mc^2$，以及 `const thought = "记录"`。'],
      ['把知识连起来：我的学习笔记', '从一个问题开始，到一次亲手验证。知识不只在书里，也在我们一次次追问和实践之中。\n\n|主题|进展|\n|---|---|\n|前端|布局与交互|\n|后端|权限与数据|'],
      ['草木有名，生活有趣', '认识一味草木，也就多了一种看待日常的方式。把一路遇到的知识和灵感，慢慢收藏起来。']
    ]) {
      const post = await api('/api/v1/posts', {method:'POST',headers,data:{title,content,author:username}});
      const listing = await api('/api/v1/posts?search=' + encodeURIComponent(title));
      const created = (listing.posts || listing).find(item => item.author === username);
      check(created, 'Created test post missing from list');
      posts.push(created.id);
    }
    await page.goto(base + '/?audit=smoke', {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => document.querySelectorAll('.card-open-btn').length >= 3);
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:'C:/Users/dudu1/my-project/.tmp/blog-audit/desktop-with-content.png',fullPage:true});
    const security = await page.evaluate(() => {
      const target = document.createElement('div');
      target.innerHTML = renderMarkdown('<div class="custom-modal-overlay" data-id="1" style="position:fixed">untrusted</div><img onerror="alert(1)"><a href="javascript:alert(1)">link</a> $x^2$ `inline`');
      return {events:!!target.querySelector('[onerror]'),controls:!!target.querySelector('.custom-modal-overlay,[data-id]'),scripts:!!target.querySelector('a[href^="javascript"]'),math:!!target.querySelector('.katex'),inline:target.querySelector('code')?.textContent};
    });
    check(!security.events && !security.controls && !security.scripts && security.math && security.inline === 'inline', 'Markdown sanitizer or math regression');
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'C:/Users/dudu1/my-project/.tmp/blog-audit/mobile-with-content.png',fullPage:true});
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile overflow');
    const titleButton = page.locator('.card-open-btn').first();
    await titleButton.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('#comment-form');
    check(await page.locator('main').evaluate(node => node.inert), 'background not inert');
    await page.locator('#modal-like-btn').click();
    await page.waitForSelector('#auth-modal:not(.hidden)');
    await page.locator('#login-username').fill(username);
    await page.locator('#login-password').fill(password);
    await page.locator('#login-form button[type=submit]').click();
    await page.waitForSelector('#auth-modal', {state:'hidden'});
    await page.waitForFunction(() => !document.querySelector('#comment-input').disabled);
    await page.locator('#comment-input').fill('本地端到端评论：公式 $a^2+b^2=c^2$ 与 **强调**。');
    await page.locator('#comment-form button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#comments-list').textContent.includes('本地端到端评论'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('body > .custom-modal-overlay'));
    check(!(await page.locator('main').evaluate(node => node.inert)), 'background stayed inert');
    await page.locator('#theme-btn').click();
    check(await page.locator('body').evaluate(node => node.classList.contains('dark-theme')), 'theme toggle failed');
    await page.screenshot({path:'C:/Users/dudu1/my-project/.tmp/blog-audit/mobile-dark.png',fullPage:true});
    await page.locator('#theme-btn').click();
    await page.locator('#logout-btn').click();
    await page.locator('#search-input').fill('把知识连起来');
    await page.waitForFunction(() => document.querySelectorAll('.card-open-btn').length === 1 && document.querySelector('.card-open-btn').textContent.includes('把知识连起来'));
    await page.locator('#search-input').fill('不存在的本地测试关键词');
    await page.waitForFunction(() => document.querySelector('.empty-posts')?.textContent.includes('没有找到'));
    check(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
    return {passed:['Markdown/XSS/KaTeX','mobile content overflow','keyboard article opening','nested login dialog','comment creation','Escape and background focus','dark theme','live search','empty search'],testUser:username};
  } finally {
    for (const id of posts) await page.request.delete(`${base}/api/v1/posts/${id}`, {headers});
    const listing = await api('/api/v1/posts?page_size=50');
    for (const post of (listing.posts || listing).filter(post => post.author === username)) await page.request.delete(`${base}/api/v1/posts/${post.id}`, {headers});
    page.off('pageerror', onError);
  }
}
