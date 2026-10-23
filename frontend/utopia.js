/** Utopia motion: one visibility-aware canvas loop; native scroll and focus. */
(() => {
  const body = document.body;
  if (!body.classList.contains('utopia-site')) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(pointer: fine)');
  const toggle = document.querySelector('#motion-toggle');
  const hero = document.querySelector('.utopia-hero');
  const art = document.querySelector('.hero-art');
  const canvas = document.querySelector('#garden-canvas');
  const ctx = canvas?.getContext('2d');
  let paused = safeStorage.getItem('garden_motion_paused') === 'true';
  let heroVisible = !!hero;
  let frame = 0;
  let lastTime = 0;
  let elapsed = 0;
  let width = 0;
  let height = 0;
  let targetX = 0;
  let targetY = 0;
  let pointerX = 0;
  let pointerY = 0;
  const particles = Array.from({length: 26}, (_, index) => ({
    x: ((index * 0.61803398875) % 1), y: ((index * 0.38196601125 + .13) % 1),
    radius: index % 4 === 0 ? 1.6 : .7, speed: .13 + index % 5 * .025,
  }));

  function enabled() { return !paused && !reduced.matches; }
  function artVisible() { return !document.documentElement.dataset.appearance || document.documentElement.dataset.appearance === 'art'; }
  function resizeCanvas() {
    if (!canvas || !hero || !ctx) return;
    const rect = hero.getBoundingClientRect();
    width = rect.width; height = rect.height;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }
  function draw() {
    if (!ctx || !width || !height) return;
    ctx.clearRect(0, 0, width, height);
    const centerX = width * .7 + pointerX * 12;
    const centerY = height * .5 + pointerY * 8;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(-.52 + Math.sin(elapsed * .035) * .025);
    ctx.strokeStyle = 'rgba(219,245,138,.2)';
    ctx.lineWidth = .65;
    ctx.beginPath();
    ctx.ellipse(0,0,width*.27,height*.28,0,-.5,Math.PI*1.2);
    ctx.stroke();
    const orbit = elapsed * .09;
    ctx.fillStyle = 'rgba(219,245,138,.8)';
    ctx.beginPath();
    ctx.arc(Math.cos(orbit)*width*.27,Math.sin(orbit)*height*.28,2.5,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
    for (const particle of particles) {
      const x = width * (.35 + particle.x * .62) + Math.sin(elapsed * particle.speed + particle.x * 9) * 12;
      const y = height * ((particle.y + elapsed * .003 * particle.speed) % 1);
      ctx.fillStyle = `rgba(231,242,193,${.2 + .22 * Math.sin(elapsed*.4+particle.x*7)**2})`;
      ctx.beginPath(); ctx.arc(x,y,particle.radius,0,Math.PI*2); ctx.fill();
    }
  }
  function tick(time) {
    frame = 0;
    if (!enabled() || !artVisible() || !heroVisible || document.hidden) { lastTime = 0; return; }
    const delta = lastTime ? Math.min((time - lastTime)/1000,.05) : 0;
    lastTime = time; elapsed += delta;
    pointerX += (targetX - pointerX) * .045;
    pointerY += (targetY - pointerY) * .045;
    if (art) {
      const scroll = Math.max(0, Math.min(window.scrollY / Math.max(height,1),1));
      art.style.setProperty('--art-x',`${pointerX * 13}px`);
      art.style.setProperty('--art-y',`${pointerY * 10 + scroll * 45}px`);
      art.style.setProperty('--art-scale',String(1 + scroll * .055));
    }
    draw();
    frame = requestAnimationFrame(tick);
  }
  function schedule() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0; lastTime = 0;
    if (ctx && enabled() && artVisible() && heroVisible && !document.hidden) frame = requestAnimationFrame(tick);
    else if (artVisible()) draw();
  }
  function syncMotion() {
    const active = enabled();
    body.classList.toggle('garden-motion-off', !active);
    if (toggle) {
      toggle.setAttribute('aria-pressed',String(!active));
      toggle.setAttribute('aria-label',reduced.matches ? '已遵循系统减少动态效果设置' : active ? '暂停装饰动效' : '播放装饰动效');
      toggle.querySelector('span').textContent = active ? 'Ⅱ' : '▷';
      toggle.disabled = reduced.matches;
    }
    schedule();
  }
  toggle?.addEventListener('click',() => {
    paused = !paused;
    safeStorage.setItem('garden_motion_paused',String(paused));
    syncMotion();
  });
  reduced.addEventListener('change',syncMotion);
  document.addEventListener('visibilitychange',schedule);
  document.addEventListener('appearance-changed',schedule);
  window.addEventListener('pagehide',() => { if(frame) cancelAnimationFrame(frame); frame=0; lastTime=0; });
  window.addEventListener('pageshow',schedule);
  hero?.addEventListener('pointermove',event => {
    if (!finePointer.matches || !enabled()) return;
    const rect = hero.getBoundingClientRect();
    targetX = (event.clientX - rect.left)/rect.width * 2 - 1;
    targetY = (event.clientY - rect.top)/rect.height * 2 - 1;
  },{passive:true});
  hero?.addEventListener('pointerleave',() => {targetX=0;targetY=0;});
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {entry.target.classList.add('is-revealed');revealObserver.unobserve(entry.target);}
      });
    },{threshold:.08,rootMargin:'0px 0px 0px 0px'});
    document.querySelectorAll('[data-reveal]').forEach(element => revealObserver.observe(element));
    if (hero) new IntersectionObserver(entries => { heroVisible=entries[0].isIntersecting; schedule(); },{threshold:0}).observe(hero);
    body.classList.add('garden-motion-ready');
  }
  if (hero && 'ResizeObserver' in window) new ResizeObserver(resizeCanvas).observe(hero);
  else window.addEventListener('resize',resizeCanvas,{passive:true});

  document.querySelector('#garden-write-btn')?.addEventListener('click',() => {
    if (!isLoggedIn()) openAuthModal('login');
    else GardenUI.openPanel('#publish-section',{title:'让一个念头，落在纸上。',eyebrow:'A NEW FIELD NOTE'});
  });
  document.addEventListener('auth-changed',() => {
    if (!isLoggedIn()) document.querySelector('#garden-compose')?.classList.remove('is-open');
  });
  document.querySelectorAll('a[href="#journal"], a[href="#utopia-title"]').forEach(link => {
    link.addEventListener('click',event => {
      const destination = document.querySelector(link.getAttribute('href'));
      if(!destination) return;
      event.preventDefault();
      destination.setAttribute('tabindex','-1');
      destination.focus({preventScroll:true});
      destination.scrollIntoView({behavior:enabled()?'smooth':'auto',block:'start'});
    });
  });
  resizeCanvas();
  syncMotion();
})();
