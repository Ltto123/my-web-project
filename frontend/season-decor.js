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
  const art = {
    willow: SVG('0 0 180 150', `<g class="season-drift"><path d="M12-3C42 28 120 6 168 35M55 16C36 65 42 101 25 147M83 18C61 56 76 103 57 133M116 23C107 60 125 94 112 125M149 30C144 57 153 82 145 102" stroke="var(--season-deep)" stroke-width="1.5"/>${[[40,55],[32,79],[29,104],[66,49],[65,77],[65,105],[110,52],[114,76],[116,99],[146,58],[148,79]].map(([x,y],i)=>`<path d="M${x} ${y}q${i%2?18:-16} 7 ${i%2?8:-9} 22q-1-13 ${i%2?-8:9}-22" fill="var(--season-leaf)"/>`).join('')}</g>`),
    blossom: SVG('0 0 100 120', `<path d="M15 118C35 78 50 49 91 8M32 82L11 40M53 52L76 78" stroke="var(--season-deep)" stroke-width="2"/><g transform="translate(40 70) scale(.7)">${petal}</g><g transform="translate(75 31) scale(.9)">${petal}</g><g transform="translate(13 40) scale(.6)">${petal}</g><g class="season-petal"><path d="M71 102Q83 84 87 95Q92 111 71 102" fill="var(--season-petal)"/></g>`),
    maple: SVG('0 0 120 135', `<g class="season-drift" transform-origin="50px 65px"><g transform="translate(48 61) rotate(-15)">${leaf}</g><g transform="translate(82 104) rotate(35) scale(.65)" style="--season-petal:var(--season-leaf)">${leaf}</g><path d="M45 80L35 119M82 117L78 130" stroke="var(--season-deep)" stroke-width="2"/></g>`),
    osmanthus: SVG('0 0 150 175', `<path d="M43 173Q93 106 101 12M66 127L22 75M81 85L132 49" stroke="var(--season-deep)" stroke-width="2"/><path d="M64 124Q28 132 30 111Q44 100 64 124M90 60Q115 61 118 81Q100 88 90 60" fill="var(--season-leaf)"/>${[[99,19],[107,38],[92,50],[129,51],[23,75],[38,94],[84,84]].map(([x,y])=>`<g transform="translate(${x} ${y})">${osmanthus}</g>`).join('')}`)
  };

  let current = '';
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    node.dataset.seasonOwned = '';
    if (text) node.textContent = text;
    return node;
  }
  function makeArt(key, className) {
    const node = element('span', `season-decoration ${className}`);
    node.setAttribute('aria-hidden', 'true');
    node.dataset.seasonArt = key;
    node.innerHTML = art[key] || '';
    return node;
  }
  function picture(file, alt, width, height) {
    const img = document.createElement('img');
    img.src = `assets/seasons/${file}.webp`;
    img.alt = alt; img.width = width; img.height = height;
    img.loading = 'lazy'; img.decoding = 'async';
    return img;
  }
  function copy(label, title, text) {
    const node = element('div', 'season-moment-copy');
    node.append(element('span', 'season-moment-label', label), element('h2', '', title), element('p', '', text));
    return node;
  }
  function placeNearReading(node) {
    const journal = document.querySelector('#journal');
    const intro = document.querySelector('.inner-intro');
    if (journal) journal.before(node);
    else if (intro) intro.after(node);
  }
  function spring(footer) {
    // Willow belongs to the upper edge. Cherry blossoms have their own garden below.
    document.querySelector('.blog-header')?.append(makeArt('willow', 'spring-canopy'));
    const garden = element('section', 'season-moment spring-garden');
    garden.setAttribute('aria-label', '樱花小径');
    garden.append(makeArt('blossom', 'spring-blossom-branch'), copy('春天的另一页', '花开的时候，慢一点。', '樱花在这里停留。风翻过几页，阳光就落进字里。'));
    const petals = makeArt('', 'spring-petal-trail');
    petals.innerHTML = SVG('0 0 900 100', Array.from({length:13}, (_,i)=>`<g class="season-petal" transform="translate(${25+i*67} ${18+(i%3)*24}) scale(${.2+(i%4)*.06})">${petal}</g>`).join(''));
    garden.append(petals); footer?.before(garden);
  }
  function summer(footer) {
    const treat = element('section', 'season-moment summer-gelato');
    treat.setAttribute('aria-label', '夏日冰淇淋');
    treat.append(copy('一口，慢下来的夏天', '先吃冰淇淋，\n再读下一篇。', '开心果的清香，香草的柔软。把最热的午后，留给一点冰凉。'));
    const cone = element('figure', 'summer-gelato-cone');
    cone.append(picture('icecream-v3', '真实质感的开心果与香草双球冰淇淋，配酥脆的华夫甜筒', 1024,1536));
    cone.append(element('figcaption', '', 'PISTACHIO / VANILLA'));
    treat.append(cone); placeNearReading(treat);
    const meadow = element('figure', 'season-moment summer-meadow-window');
    meadow.append(picture('meadow-v6', '那拉提细密柔软的绿色草坡与远方林线', 1536,1024));
    meadow.append(element('figcaption', '', '去那拉提。\n把心事放进旷野，让风带远一点。'));
    footer?.before(meadow);
  }
  function autumn(footer) {
    const leaves = makeArt('', 'autumn-leaf-passage');
    leaves.innerHTML = SVG('0 0 1200 130', Array.from({length:8}, (_,i)=>`<g transform="translate(${20+i*i*22} ${32+(i%3)*28}) rotate(${i*29-50}) scale(${.35+(i%3)*.14})"${i%2?' style="--season-petal:var(--season-leaf)"':''}>${leaf}</g>`).join(''));
    placeNearReading(leaves);
    // Osmanthus is a separate, quiet endnote, never mixed into the maple landscape.
    const scent = element('section', 'season-moment autumn-scent');
    scent.setAttribute('aria-label', '桂花香');
    scent.append(makeArt('osmanthus', 'autumn-osmanthus'), copy('走到这里，刚好闻见', '一缕桂花香。', '不急着往前走。秋天很长，还有许多值得收藏的时刻。'));
    footer?.before(scent);
  }
  function winter(footer) {
    const nook = element('section', 'season-moment winter-reading-nook');
    nook.setAttribute('aria-label', '冬日阅读角');
    nook.append(copy('今晚，就窝在这里', '书还没读完，\n冬天也还很长。', '靠进柔软的沙发，脚边是毛茸茸的地毯。热饮捧在手心，炉火慢慢燃着。'));
    const hem = element('span', 'winter-blanket-hem'); hem.setAttribute('aria-hidden','true'); nook.append(hem);
    footer?.before(nook);
  }
  function sync() {
    const next = root.dataset.appearance || 'art';
    if (next === current) return;
    current = next;
    document.querySelectorAll('[data-season-owned]').forEach(node => node.remove());
    if (!seasons.has(current)) return;
    const footer = document.querySelector('.garden-footer');
    ({ spring, summer, autumn, winter })[current](footer);
  }
  document.addEventListener('appearance-changed', sync);
  document.addEventListener('visibilitychange', () => document.body.classList.toggle('season-page-hidden', document.hidden));
  sync();
})();
