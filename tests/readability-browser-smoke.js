// Read-only browser audit: all five pages plus resource preview and login.
async (page) => {
  const base = await page.evaluate(()=>location.origin);
  if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(base)) throw new Error('Local preview only');
  const audit = () => {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const rgb = value => {ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);const c=[...ctx.getImageData(0,0,1,1).data];c[3]/=255;return c;};
    const blend = (front, back) => front.slice(0,3).map((v,i)=>v*(front[3]??1)+back[i]*(1-(front[3]??1)));
    const luminance = color => color.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const background = el => {
      const chain=[];
      for(let node=el;node;node=node.parentElement) chain.unshift(node);
      return chain.reduce((bg,node)=>blend(rgb(getComputedStyle(node).backgroundColor),bg),[255,255,255]);
    };
    const rows=[], manual=[];
    for(const el of document.querySelectorAll('body *')) {
      const style=getComputedStyle(el);
      if (!el.getClientRects().length || el.closest('[hidden],.hidden,[inert]') || style.visibility==='hidden' || el.matches(':disabled')) continue;
      if (['SCRIPT','STYLE','OPTION'].includes(el.tagName)) continue;
      const text=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim();
      const placeholder=el.getAttribute('placeholder');
      if (!text && !placeholder) continue;
      // Images/gradients need a screenshot check; a flat-color ratio is misleading.
      let imageBacked=false;
      for(let node=el;node;node=node.parentElement)if(getComputedStyle(node).backgroundImage!=='none')imageBacked=true;
      if(imageBacked){manual.push(text||placeholder);continue;}
      for(const [kind,label,computed] of [['text',text,style],['placeholder',placeholder,getComputedStyle(el,'::placeholder')]]) {
        if(!label)continue;
        const bg=background(el), fg=blend(rgb(computed.color),bg);
        const a=luminance(fg), b=luminance(bg), ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        const large=parseFloat(style.fontSize)>=24 || (parseFloat(style.fontSize)>=18.66 && parseInt(style.fontWeight)>=700);
        rows.push({kind,text:label.slice(0,65),selector:el.id?'#'+el.id:el.tagName.toLowerCase()+'.'+[...el.classList].join('.'),ratio:+ratio.toFixed(2),minimum:large?3:4.5});
      }
    }
    return {count:rows.length,manual:manual.length,failures:rows.filter(r=>r.ratio<r.minimum),download:rows.find(r=>r.text.includes('下载文件'))};
  };
  const results=[];
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const dark of [false,true]) {
    for(const route of ['/','/personal','/library','/vocab','/herb']) {
      await page.goto(base+route);
      await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});
      await page.evaluate(dark=>{document.body.classList.toggle('dark-theme',dark);document.body.classList.add('garden-motion-off');},dark);
      results.push({route,dark,...await page.evaluate(audit)});
      if(route==='/library') {
        await page.evaluate(()=>openResourcePreview({id:999999,title:'文字可读性检查',file_url:'/readability.xlsx',file_name:'学习笔记.xlsx',category:'学习笔记'}));
        results.push({route:'preview',dark,...await page.evaluate(audit)});
        await page.locator('.preview-footer a').hover();
        results.push({route:'preview:hover',dark,...await page.evaluate(audit)});
        await page.mouse.move(0,0);
        await page.locator('.preview-footer a').focus();
        results.push({route:'preview:focus',dark,...await page.evaluate(audit)});
        await page.keyboard.press('Escape');
        await page.evaluate(()=>openAuthModal('login'));
        results.push({route:'login',dark,...await page.evaluate(audit)});
        await page.keyboard.press('Escape');
      }
    }
  }
  await page.emulateMedia({reducedMotion:null});
  const failed=results.filter(result=>result.failures.length);
  if(failed.length)throw new Error(JSON.stringify(failed));
  if(results.filter(result=>result.route.startsWith('preview') && result.download).length!==6)throw new Error('Download button was not measured in both themes and all three states');
  return results;
}
