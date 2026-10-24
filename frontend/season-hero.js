/** Four home compositions; content and working forms stay in their original DOM. */
(() => {
  const original=document.querySelector('.utopia-hero');
  if(!original)return;
  const root=document.documentElement;
  const worlds={
    spring:{en:'Spring',name:'花信',number:'01',eyebrow:'一座醒来的花园',title:'花开的时候，<br>把日子写下来。',note:'沿着碎石子的小路，走进明亮的春天。<br>柳梢的新绿，和那些值得记住的小事。',image:'spring-v5',alt:'明媚春光下，碎石子小路穿过花海与嫩绿的垂柳',caption:'沿着石子路，走到花开的地方。',entry:'沿着花径，读一篇',small:'嫩柳 / 花径 / 晴天',aside:'春风翻过的每一页，<br>都长出了新的念头。'},
    summer:{en:'Summer',name:'晴日漫游',number:'02',eyebrow:'给日常放一个长长的假',title:'去看海。<br>去那拉提。',note:'想念那拉提的风，也贪恋空调房的凉。<br>把夏天，过成冰淇淋融化前的慢时光。',image:'sea',alt:'清澈的蓝色海浪轻轻漫过细沙海滩',caption:'此刻在海边，把心事交给潮汐。',entry:'带一本书，去乘凉',small:'海风 / 草原 / 冰淇淋',aside:'出走与窝着，<br>都是喜欢夏天的方式。'},
    autumn:{en:'Autumn',name:'拾叶集',number:'03',eyebrow:'收集光，也收集落下来的时间',title:'风落在纸上，<br>就成了秋天。',note:'走进枫林，看红叶与金黄铺满小径。<br>拾起一枚喜欢的，夹进日常的页缝。',image:'autumn-v2',alt:'自然枫树林中透下暖阳，红色与金黄的枫叶铺满林间地面',caption:'只听脚步，和落叶的声音。',entry:'翻开这一季的手记',small:'红枫 / 金叶 / 秋光',aside:'不必追赶时间。<br>有些美好，会自己落下来。'},
    winter:{en:'Winter',name:'炉边来信',number:'04',eyebrow:'世界很冷，这里很暖',title:'把冬天，<br>窝成一本书。',note:'窗外的雪慢慢下，杯里的热气慢慢升。<br>在软软的沙发上，读到忘记时间。',image:'winter-v2',alt:'宽阔的冬日阅读客厅，雪景窗、柔软沙发、毛毯与桌上精致的热饮',caption:'雪留在窗外，温暖留在手心。',entry:'坐下来，再读一页',small:'白雪 / 炉火 / 热饮',aside:'允许自己慢一点，<br>在柔软的日子里打个滚。'}
  };
  const hero=document.createElement('section');
  hero.className='season-hero';hero.setAttribute('aria-labelledby','season-title');hero.hidden=true;
  original.before(hero);
  let current='';
  let destinationVersion=0;
  let sceneFade=null;
  const summerScenes={
    sea:{image:'sea',alt:'清澈的蓝色海浪轻轻漫过细沙海滩',caption:'此刻在海边，把心事交给潮汐。'},
    meadow:{image:'meadow-v6',alt:'那拉提开阔的绒绿草甸与起伏山丘，林线退到远处',caption:'去那拉提，让风把一整个夏天吹绿。'}
  };
  function update(){
    const season=root.dataset.appearance;
    if(current===season)return;
    current=season;destinationVersion++;sceneFade?.cancel();sceneFade=null;const info=worlds[season];hero.hidden=!info;
    if(!info){hero.replaceChildren();return;}
    hero.dataset.season=season;
    hero.innerHTML=`<div class="season-hero-top"><span>LTTO’S SEASONAL JOURNAL</span><span>${info.eyebrow}</span><span>VOLUME / ${info.number}</span></div>
      <div class="season-hero-display" aria-hidden="true">${info.en}<i>.</i></div>
      <div class="season-hero-copy"><span class="season-hero-kicker">${info.name} / ${info.en.toUpperCase()}</span><h1 id="season-title">${season==='summer'?'<button class="summer-destination-title" type="button" data-destination="sea" aria-pressed="true" aria-controls="season-scene-photo">去看海<span aria-hidden="true">。</span></button><button class="summer-destination-title" type="button" data-destination="meadow" aria-pressed="false" aria-controls="season-scene-photo">去那拉提<span aria-hidden="true">。</span></button>':info.title}</h1><p>${info.note}</p><a class="season-enter" href="#journal"><span>${info.entry}</span><span aria-hidden="true">↗</span></a></div>
      <figure class="season-hero-figure"><div class="season-photo-wrap"><img class="season-main-photo" id="season-scene-photo" data-scene="${season==='summer'?'sea':''}" src="assets/seasons/${info.image}.webp" alt="${info.alt}" width="1536" height="1024" fetchpriority="high"><span class="season-photo-mat" aria-hidden="true"></span></div><figcaption>${info.caption}</figcaption></figure>
      ${season==='spring'?'<span class="spring-field-note" aria-hidden="true">循着花香 · 慢慢走</span>':season==='summer'?'<span class="summer-travel-label" aria-hidden="true">OPEN TICKET / 无需赶路</span>':season==='autumn'?'<span class="autumn-folio-label" aria-hidden="true">拾叶集 / 第三个季节</span>':''}<aside class="season-hero-note"><span class="season-note-line" aria-hidden="true"></span><p>${info.aside}</p><span>— 给此刻的自己</span></aside>
      <div class="season-hero-bottom"><span>${info.small}</span><span>留一点时间，给喜欢的事。</span><a href="#journal" aria-label="向下阅读文章">往下读 <span aria-hidden="true">↓</span></a></div>`;
  }
  async function changeDestination(destination){
    const name=destination.dataset.destination;
    const next=summerScenes[name];
    if(!next||current!=='summer'||destination.getAttribute('aria-pressed')==='true')return;
    const version=++destinationVersion;
    const photo=hero.querySelector('.season-main-photo');
    const frame=photo.closest('.season-photo-wrap');
    const select=value=>hero.querySelectorAll('[data-destination]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.destination===value)));
    select(name);frame.setAttribute('aria-busy','true');
    const source=`assets/seasons/${next.image}.webp`;
    const preload=new Image();
    try{
      await new Promise((resolve,reject)=>{preload.onload=resolve;preload.onerror=reject;preload.src=source;});
    }catch{
      if(version===destinationVersion){select(photo.dataset.scene);frame.removeAttribute('aria-busy');}
      return;
    }
    if(version!==destinationVersion||current!=='summer')return;
    sceneFade?.cancel();frame.querySelector('.season-photo-fade')?.remove();
    const previous=photo.cloneNode();
    previous.removeAttribute('id');previous.removeAttribute('data-scene');previous.removeAttribute('fetchpriority');
    previous.className='season-photo-fade';previous.alt='';previous.setAttribute('aria-hidden','true');
    photo.src=source;photo.alt=next.alt;photo.dataset.scene=name;
    hero.querySelector('figcaption').textContent=next.caption;
    frame.removeAttribute('aria-busy');
    if(document.body.classList.contains('garden-motion-off')||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    frame.append(previous);
    sceneFade=previous.animate([{opacity:1},{opacity:0}],{duration:760,easing:'cubic-bezier(.22,.61,.36,1)'});
    sceneFade.finished.catch(()=>{}).finally(()=>previous.remove());
  }
  hero.addEventListener('click',event=>{
    const destination=event.target.closest('[data-destination]');
    if(destination)changeDestination(destination);
    const link=event.target.closest('a[href="#journal"]');
    if(link){
      const journal=document.querySelector('#journal');if(!journal)return;event.preventDefault();
      journal.tabIndex=-1;journal.focus({preventScroll:true});
      journal.scrollIntoView({behavior:document.body.classList.contains('garden-motion-off')?'auto':'smooth',block:'start'});
    }
  });
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  function settleSceneMotion(){
    if(!reducedMotion.matches&&!document.body.classList.contains('garden-motion-off'))return;
    sceneFade?.cancel();sceneFade=null;
    hero.querySelectorAll('.season-photo-fade').forEach(node=>node.remove());
  }
  new MutationObserver(settleSceneMotion).observe(document.body,{attributes:true,attributeFilter:['class']});
  reducedMotion.addEventListener('change',settleSceneMotion);
  document.addEventListener('appearance-changed',update);update();
})();
