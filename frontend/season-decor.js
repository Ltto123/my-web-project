/** Four independent seasons, distributed across real page surfaces. No canvas loop. */
(() => {
  'use strict';
  if (!document.body.classList.contains('utopia-site')) return;
  const root = document.documentElement;
  const seasons = new Set(['spring','summer','autumn','winter']);
  const SVG = (viewBox, content) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" aria-hidden="true" focusable="false">${content}</svg>`;
  const petal = `<path d="M0 0C-12-18-25-10-18 1C-31 6-21 22-9 15C-4 29 12 23 10 11C26 11 24-8 11-8C11-23-4-23 0 0Z" fill="var(--season-petal)"/><circle cx="0" cy="4" r="3" fill="var(--season-gold)"/>`;
  const leaf = `<path d="M0 0C-19-13-24-28-18-38L-6-28L0-53L9-33L26-43L24-20L39-15L22-4L26 8L8 7L0 19L-4 5L-22 7L-17-7Z" fill="var(--season-petal)"/><path d="M0 19L0-35M0-7L-14-24M0-4L22-23" stroke="var(--season-deep)" stroke-width="1"/>`;
  const osmanthus = `<g fill="var(--season-gold)"><ellipse cy="-5" rx="3" ry="5"/><ellipse cy="5" rx="3" ry="5"/><ellipse cx="-5" rx="5" ry="3"/><ellipse cx="5" rx="5" ry="3"/></g><circle r="2" fill="var(--season-deep)"/>`;
  const steam = `<g stroke="var(--season-deep)" stroke-width="2" stroke-linecap="round"><path class="season-steam" d="M90 58C72 43 105 30 88 15"/><path class="season-steam" d="M109 58C92 44 123 28 108 12"/><path class="season-steam" d="M128 58C111 44 143 32 127 18"/></g>`;
  const art = {
    willow: SVG('0 0 180 150', `<g class="season-drift"><path d="M12-3C42 28 120 6 168 35M55 16C36 65 42 101 25 147M83 18C61 56 76 103 57 133M116 23C107 60 125 94 112 125M149 30C144 57 153 82 145 102" stroke="var(--season-deep)" stroke-width="1.5"/>${[[40,55],[32,79],[29,104],[66,49],[65,77],[65,105],[110,52],[114,76],[116,99],[146,58],[148,79]].map(([x,y],i)=>`<path d="M${x} ${y}q${i%2?18:-16} 7 ${i%2?8:-9} 22q-1-13 ${i%2?-8:9}-22" fill="var(--season-leaf)"/>`).join('')}</g>`),
    blossom: SVG('0 0 100 120', `<path d="M15 118C35 78 50 49 91 8M32 82L11 40M53 52L76 78" stroke="var(--season-deep)" stroke-width="2"/><g transform="translate(40 70) scale(.7)">${petal}</g><g transform="translate(75 31) scale(.9)">${petal}</g><g transform="translate(13 40) scale(.6)">${petal}</g><g class="season-petal"><path d="M71 102Q83 84 87 95Q92 111 71 102" fill="var(--season-petal)"/></g>`),
    spring: SVG('0 0 280 210', `<circle cx="190" cy="54" r="31" fill="var(--season-gold)" opacity=".6"/><path d="M9 185Q70 128 150 162Q206 124 273 171V201H9" fill="var(--season-sky)"/><g class="season-drift"><path d="M73 190Q68 115 30 49M119 185Q139 123 119 54M175 191Q182 148 217 125" stroke="var(--season-leaf)" stroke-width="3"/><path d="M65 149Q17 116 28 98Q66 102 65 149M124 133Q166 98 170 119Q159 145 124 133M184 165Q213 140 227 156Q214 177 184 165" fill="var(--season-leaf)"/><g transform="translate(29 50) scale(1.2)">${petal}</g><g transform="translate(121 55) scale(1.4)">${petal}</g><g transform="translate(219 124) scale(.8)">${petal}</g></g><path d="M18 201H265" stroke="var(--season-deep)"/>`),
    icecream: SVG('0 0 100 145', `<path d="M21 62H79L52 137Z" fill="var(--season-gold)"/><path d="M29 82L61 113M39 65L70 96M69 78L43 111M58 66L34 93" stroke="var(--season-deep)" opacity=".45"/><path d="M17 58C2 38 21 28 31 30C22 5 58-7 63 17C84 6 104 33 81 46C95 63 71 79 59 65C47 79 31 70 31 62C25 67 18 65 17 58Z" fill="var(--season-petal)"/><path d="M32 29Q45 42 59 24M43 53Q53 44 64 50" stroke="var(--c-surface)" stroke-width="3" stroke-linecap="round"/>`),
    summer: SVG('0 0 280 210', `<circle cx="222" cy="48" r="28" fill="var(--season-gold)"/><path d="M7 142Q54 130 105 144T205 143T275 143V190H7Z" fill="var(--season-sky)"/><path class="season-wave-line" d="M0 155Q45 142 90 156T180 154T280 157M0 177Q45 166 90 179T180 177T280 178" stroke="var(--season-deep)" stroke-width="2"/><path d="M20 195Q129 163 280 188V208H20Z" fill="var(--season-gold)"/><path d="M102 65L84 194" stroke="var(--season-deep)" stroke-width="3"/><path d="M38 91Q91 15 160 91Z" fill="var(--season-petal)"/><path d="M70 91Q86 43 102 44Q119 56 127 91" stroke="var(--c-surface)" stroke-width="12"/><path d="M64 175L119 174L133 194H77Z" fill="var(--c-surface)"/><path d="M68 181L124 181M73 188L129 188" stroke="var(--season-deep)"/>`),
    maple: SVG('0 0 120 135', `<g class="season-drift" transform-origin="50px 65px"><g transform="translate(48 61) rotate(-15)">${leaf}</g><g transform="translate(82 104) rotate(35) scale(.65)" style="--season-petal:var(--season-leaf)">${leaf}</g><path d="M45 80L35 119M82 117L78 130" stroke="var(--season-deep)" stroke-width="2"/></g>`),
    autumn: SVG('0 0 280 210', `<path d="M28 192Q122 178 245 193" stroke="var(--season-deep)"/><g transform="translate(90 107) rotate(-20) scale(1.65)">${leaf}</g><g transform="translate(176 147) rotate(30) scale(1.15)" style="--season-petal:var(--season-leaf)">${leaf}</g><path d="M188 188Q230 144 243 55M212 151L263 111M230 106L203 70" stroke="var(--season-deep)" stroke-width="2"/><g transform="translate(240 60)">${osmanthus}</g><g transform="translate(251 85)">${osmanthus}</g><g transform="translate(234 101)">${osmanthus}</g><g transform="translate(205 72)">${osmanthus}</g><g transform="translate(262 114)">${osmanthus}</g>`),
    tea: SVG('0 0 220 180', `${steam}<ellipse cx="109" cy="151" rx="75" ry="10" fill="var(--c-parchment)"/><path d="M58 75H149V124Q149 151 108 151Q67 151 64 126Z" fill="var(--season-petal)"/><path d="M149 87C191 75 191 128 149 127" stroke="var(--season-petal)" stroke-width="12"/><ellipse cx="103" cy="76" rx="45" ry="9" fill="var(--season-deep)"/><path d="M91 92V118H110V101" stroke="var(--c-surface)" stroke-width="2"/><path d="M83 116H101V136H83Z" fill="var(--season-gold)"/>`),
    winter: SVG('0 0 280 210', `<path d="M36 20H238V173H36Z" fill="var(--season-sky)" stroke="var(--season-deep)" stroke-width="4"/><path d="M135 20V173M36 95H238" stroke="var(--c-surface)" stroke-width="8"/><path d="M43 149Q91 104 134 152Q187 120 233 153V170H43Z" fill="var(--c-surface)"/><g fill="var(--c-surface)"><circle cx="70" cy="54" r="3"/><circle cx="174" cy="54" r="4"/><circle cx="211" cy="80" r="2"/><circle cx="98" cy="112" r="3"/><circle cx="192" cy="121" r="3"/></g><path d="M29 177Q57 166 88 177Q132 160 173 175Q208 165 247 178V188H29Z" fill="var(--c-surface)" stroke="var(--c-border)"/><path d="M20 190H257" stroke="var(--season-deep)" stroke-width="7"/><path d="M66 190L66 207M220 190V207" stroke="var(--season-deep)" stroke-width="3"/>`),
    sofa: SVG('0 0 310 210', `<ellipse cx="151" cy="187" rx="138" ry="19" fill="var(--c-parchment)"/><path d="M49 99V56Q49 32 73 32H227Q251 32 251 57V99" fill="var(--season-petal)"/><path d="M147 35V105M54 98H249" stroke="var(--season-deep)" opacity=".5"/><path d="M42 99Q17 83 20 114L27 169H273L280 113Q283 83 256 99L249 137H48Z" fill="var(--season-deep)"/><rect x="49" y="113" width="201" height="40" rx="13" fill="var(--season-petal)"/><path d="M41 169V183M259 169V183" stroke="var(--season-deep)" stroke-width="7"/><path d="M72 58L112 65L105 107L63 98Z" fill="var(--c-surface)"/><path d="M186 100Q204 87 221 100L244 161L199 160Z" fill="var(--season-gold)"/><path d="M192 109L224 119M196 122L230 132M201 137L236 145" stroke="var(--c-surface)" opacity=".5"/><path d="M126 118L157 111L179 118V133L154 128L126 136Z" fill="var(--c-surface)"/><path d="M155 113V127" stroke="var(--season-deep)"/>`),
    osmanthus: SVG('0 0 150 175', `<path d="M43 173Q93 106 101 12M66 127L22 75M81 85L132 49" stroke="var(--season-deep)" stroke-width="2"/><path d="M64 124Q28 132 30 111Q44 100 64 124M90 60Q115 61 118 81Q100 88 90 60" fill="var(--season-leaf)"/>${[[99,19],[107,38],[92,50],[129,51],[23,75],[38,94],[84,84]].map(([x,y])=>`<g transform="translate(${x} ${y})">${osmanthus}</g>`).join('')}`)
  };
  const AC = SVG('0 0 240 145', `<rect x="15" y="20" width="210" height="68" rx="12" fill="var(--c-surface)" stroke="var(--season-deep)" stroke-width="2"/><path d="M29 66H211L204 78H36Z" fill="var(--season-sky)"/><path d="M40 70H200M46 74H194" stroke="var(--season-deep)"/><rect x="176" y="35" width="25" height="15" rx="2" fill="var(--c-primary-light)"/><path d="M181 40H196M181 45H191" stroke="var(--season-deep)"/><g class="season-air-stream" stroke="var(--season-deep)" stroke-width="2" stroke-linecap="round"><path d="M65 94C48 109 76 122 57 138"/><path d="M119 94C101 111 131 121 113 139"/><path d="M170 94C151 110 183 121 166 137"/></g>`);
  const FIRE = SVG('0 0 240 145', `<path d="M36 124V31H205V124" fill="var(--c-surface)" stroke="var(--season-deep)" stroke-width="3"/><path d="M66 125V72Q66 46 120 46Q174 46 174 72V125Z" fill="var(--season-deep)"/><path d="M24 28H216M26 128H214" stroke="var(--season-deep)" stroke-width="8"/><g class="season-fire-lit"><path class="season-flame" d="M91 112C66 90 117 85 107 59C146 82 137 90 150 89C168 118 103 134 91 112Z" fill="var(--season-petal)"/><path class="season-flame" d="M111 113C98 101 117 91 123 83C123 96 148 110 133 119Z" fill="var(--season-gold)"/></g><path d="M88 120L153 113M95 112L147 123" stroke="var(--c-border)" stroke-width="6" stroke-linecap="round"/>`);
  const content = {
    spring:{label:'春日小憩',title:'把日子，种进花里。',note:'风经过嫩柳，花瓣落在新翻开的那一页。',nav:'willow',intro:'spring',card:'blossom',reader:'willow'},
    summer:{label:'夏日放空',title:'山野很远，凉风很近。',note:'一边惦记海，一边想去那拉提。此刻，只想吃口冰淇淋。',nav:'summer',intro:'summer',card:'icecream',reader:'summer'},
    autumn:{label:'秋日收藏',title:'夹住一片，金色的时间。',note:'红叶、黄叶，和走过树下才闻到的桂花香。',nav:'osmanthus',intro:'autumn',card:'maple',reader:'osmanthus'},
    winter:{label:'冬日窝居',title:'外面下雪，就再读一页。',note:'脚边是软毯，手里是热饮，沙发把整个冬天接住。',nav:'winter',intro:'winter',card:'tea',reader:'tea'}
  };
  let current = '';
  let observer;

  function makeArt(key, className) {
    const span = document.createElement('span');
    span.className = `season-decoration ${className || ''}`;
    span.dataset.seasonOwned = '';
    span.dataset.seasonArt = key;
    span.setAttribute('aria-hidden','true');
    span.innerHTML = art[key] || '';
    return span;
  }
  function footerArt(season) {
    if (season === 'summer') return SVG('0 0 1200 100', `<path d="M-20 42Q120 0 260 42T540 42T820 42T1220 42V100H-20Z" fill="var(--season-sky)"/><path class="season-wave-line" d="M-20 54Q120 14 260 54T540 54T820 54T1220 54M-20 78Q120 38 260 78T540 78T820 78T1220 78" stroke="var(--season-deep)" stroke-width="2"/><path d="M0 94Q350 67 660 93T1200 90V100H0Z" fill="var(--season-gold)"/>`);
    if (season === 'winter') return SVG('0 0 1200 130', `<path d="M0 100Q150 58 300 100Q450 77 600 96Q800 45 1000 92Q1110 71 1200 100V130H0Z" fill="var(--c-surface)"/><path d="M86 100V27M74 46L86 31L98 46M67 65L86 43L106 65M59 85L86 57L115 85M1080 90V18M1065 41L1080 21L1097 41M1054 64L1080 34L1106 64M1043 87L1080 48L1117 87" stroke="var(--season-leaf)" stroke-width="6" stroke-linecap="round"/><g fill="var(--c-surface)"><circle cx="185" cy="34" r="3"/><circle cx="401" cy="56" r="3"/><circle cx="735" cy="27" r="4"/><circle cx="928" cy="52" r="3"/></g>`);
    if (season === 'autumn') return SVG('0 0 1200 130', `${Array.from({length:9},(_,i)=>`<g transform="translate(${35+i*139} ${70+(i%3)*17}) rotate(${i%2?32:-25}) scale(${.6+(i%3)*.17})"${i%2?' style="--season-petal:var(--season-leaf)"':''}>${leaf}</g>`).join('')}${[170,450,750,1050].map(x=>`<g transform="translate(${x} 106) scale(.8)">${osmanthus}</g>`).join('')}`);
    return SVG('0 0 1200 140', `<path d="M0 136Q450 122 1200 135" stroke="var(--season-leaf)"/>${Array.from({length:17},(_,i)=>{const x=20+i*73;const y=50+(i%4)*17;return `<g class="season-drift${i%2?' season-drift-late':''}"><path d="M${x+5} 139Q${x+13} ${y+40} ${x} ${y}" stroke="var(--season-leaf)" stroke-width="2"/><path d="M${x+5} ${y+50}q-23-26-26-8q6 16 26 8" fill="var(--season-leaf)"/><g transform="translate(${x} ${y}) scale(${.45+(i%3)*.12})">${petal}</g></g>`;}).join('')}`);
  }
  function figure(key, caption, extra='') {
    const figure = document.createElement('figure');
    figure.className = `season-vignette ${extra}`;
    figure.append(makeArt(key,''));
    const label = document.createElement('figcaption'); label.textContent=caption; figure.append(label);
    return figure;
  }
  function object(kind) {
    const box = document.createElement('div');
    box.className = 'season-object'; box.dataset.active='false';
    box.innerHTML = kind === 'air' ? AC : FIRE;
    const button = document.createElement('button');
    button.type='button'; button.className='season-object-toggle'; button.setAttribute('aria-pressed','false');
    button.innerHTML='<i aria-hidden="true"></i><span></span>';
    const label = button.querySelector('span');
    label.textContent=kind === 'air' ? '让凉风吹进来' : '点亮壁炉';
    button.addEventListener('click',() => {
      const active=box.dataset.active !== 'true'; box.dataset.active=String(active); button.setAttribute('aria-pressed',String(active));
      label.textContent=kind === 'air' ? active?'让凉风歇一会':'让凉风吹进来' : active?'让炉火歇一会':'点亮壁炉';
    });
    const note=document.createElement('p'); note.textContent=kind === 'air'?'夏日氛围 · 想象中的一阵凉风':'冬日氛围 · 给阅读添一点暖意';
    box.append(button,note); return box;
  }
  function restCorner(season) {
    const info=content[season];
    const section=document.createElement('section'); section.className='season-break'; section.dataset.season=season; section.dataset.seasonOwned='';
    section.setAttribute('aria-label',info.label);
    const copy=document.createElement('div'); copy.className='season-break-copy';
    const eyebrow=document.createElement('span'); eyebrow.textContent=info.label;
    const title=document.createElement('h2'); title.textContent=info.title;
    const note=document.createElement('p'); note.textContent=info.note;
    copy.append(eyebrow,title,note); section.append(copy);
    if (season==='summer') {
      const meadow=document.createElement('figure'); meadow.className='season-vignette season-meadow';
      const img=document.createElement('img'); img.src='assets/seasons/meadow.webp'; img.alt='那拉提的高山草甸，远山下是一望无际的绿色'; img.loading='lazy'; img.width=600; img.height=353;
      const caption=document.createElement('figcaption'); caption.textContent='把一小片那拉提，放在窗边。';
      meadow.append(img,caption,makeArt('icecream','season-icecream')); section.append(meadow,object('air'));
    } else if (season==='winter') { section.append(figure('sofa','沙发、软毯，和一本还没读完的书。','season-cozy-rug'),object('fire')); }
    else if (season==='spring') { section.append(figure('spring','小小花海，开到页边。'),figure('willow','一枝新绿，等风经过。')); }
    else { section.append(figure('autumn','一枚枫叶，一页秋天。'),figure('osmanthus','桂花藏在枝叶之间。')); }
    return section;
  }
  function enhance(container) {
    if (!seasons.has(current) || !(container instanceof Element)) return;
    const info=content[current];
    const find=(selector)=>[...(container.matches(selector)?[container]:[]),...container.querySelectorAll(selector)];
    for (const card of find('.blog-card,.vocab-set-card')) {
      if (card.querySelector(':scope > .season-card-sprig')) continue;
      card.classList.add('season-bookmark'); card.append(makeArt(info.card,'season-card-sprig'));
    }
    for (const reader of find('.reader-overlay .custom-modal-content')) {
      if (reader.querySelector(':scope > .season-reader-mark')) continue;
      reader.append(makeArt(info.reader,'season-reader-mark'));
    }
  }
  function sync() {
    const next=root.dataset.appearance || 'art';
    if (next===current) return;
    current=next;
    if (observer) observer.disconnect();
    document.querySelectorAll('[data-season-owned]').forEach(node=>node.remove());
    document.querySelectorAll('.season-bookmark').forEach(node=>node.classList.remove('season-bookmark'));
    if (!seasons.has(current)) return;
    const info=content[current];
    document.querySelector('.blog-header')?.append(makeArt(info.nav,'season-nav-sprig'));
    document.querySelectorAll('.inner-intro').forEach(node=>node.append(makeArt(info.intro,'season-intro-art')));
    const footer=document.querySelector('.garden-footer');
    if (footer) {
      const strip=makeArt('','season-footer-scene'); strip.innerHTML=footerArt(current); footer.prepend(strip);
      footer.before(restCorner(current));
    }
    enhance(document.body);
    // Observe additions only. Decorative nodes are skipped, so our own additions cannot loop.
    observer=new MutationObserver(records=> {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element) || node.hasAttribute('data-season-owned') || node.closest('[data-season-owned]')) continue;
        enhance(node);
      }
    });
    observer.observe(document.body,{childList:true,subtree:true});
  }
  document.addEventListener('appearance-changed',sync);
  document.addEventListener('visibilitychange',()=>document.body.classList.toggle('season-page-hidden',document.hidden));
  sync();
})();
