// Read-only checks; the original preference is restored even when a check fails.
async (page) => {
  const base=await page.evaluate(()=>location.origin);
  if(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(base))throw new Error('Local preview only');
  const original=await page.evaluate(()=>({appearance:localStorage.getItem('blog_appearance'),dark:localStorage.getItem('dark_mode_active')}));
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  const errors=[];const onError=e=>errors.push(e.message);page.on('pageerror',onError);
  const results=[];
  try {
    await page.goto(base);
    check(await page.locator('#appearance-btn').count()===1,'Appearance selector is missing');
    for(const season of ['spring','summer','autumn','winter','art']) {
      await page.locator('#appearance-btn').click();
      await page.locator(`[data-choose-appearance="${season}"]`).click();
      check(await page.locator(`[data-choose-appearance="${season}"]`).getAttribute('aria-pressed')==='true','Selection state not exposed');
      await page.keyboard.press('Escape');
      check(await page.evaluate(()=>document.activeElement.id)==='appearance-btn','Picker did not restore focus');
      check(await page.evaluate(()=>document.documentElement.dataset.appearance)===season,'Theme not applied');
      await page.reload();
      check(await page.evaluate(()=>document.documentElement.dataset.appearance)===season,'Theme did not survive reload');
      for(const width of [390,1440]) {
        await page.setViewportSize({width,height:960});
        for(const route of ['/','/personal','/library','/vocab','/herb']) {
          await page.goto(base+route);
          await page.emulateMedia({reducedMotion:'reduce'});
          check(await page.evaluate(()=>document.documentElement.dataset.appearance)===season,'Theme lost across pages');
          check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${season} ${route} overflow at ${width}`);
          if(route==='/')check(await page.locator(season==='art'?'.utopia-hero':'.season-hero').isVisible(),'Wrong hero visibility');
          results.push({season,width,route});
        }
      }
    }
    check(errors.length===0,errors.join('\n'));
    return {checks:results.length,pageErrors:errors};
  } finally {
    page.off('pageerror',onError);
    await page.evaluate(original=>{for(const [key,value] of [['blog_appearance',original.appearance],['dark_mode_active',original.dark]])value===null?localStorage.removeItem(key):localStorage.setItem(key,value);},original);
    await page.emulateMedia({reducedMotion:null});
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(base);
  }
}
