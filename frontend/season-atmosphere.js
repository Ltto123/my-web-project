/** 夏风与冬火：全页氛围，受可见性和用户动效偏好统一控制。 */
(() => {
  'use strict';
  const body = document.body;
  if (!body.classList.contains('utopia-site') || body.dataset.atmosphereInitialized === 'true') return;
  body.dataset.atmosphereInitialized = 'true';
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const preferences = new Map();
  let current = '';
  let scene = null;
  let dock = null;
  let toggle = null;
  let label = null;
  let pageHidden = false;
  let fireRenderer = null;
  const storage = {
    read(key) { try { return localStorage.getItem(key); } catch { return null; } },
    write(key, value) { try { localStorage.setItem(key, value); } catch { /* Private mode keeps an in-memory preference. */ } }
  };
  const SVG = (viewBox, content, className) => `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" aria-hidden="true" focusable="false">${content}</svg>`;
  const windIcon = '<path d="M3 8h12c4 0 4-5 1-5-2 0-3 2-2 3M3 12h17M3 16h10c4 0 4 5 1 5-2 0-3-2-2-3"/>';
  const fireIcon = '<path d="M12 3c2 4-1 5 2 8 2-1 3-3 3-3 6 8 2 14-5 14S1 16 6 10c-1 4 3 4 3 1 0-3 3-5 3-8Z"/>';
  const summer = () => `<div class="atmosphere-summer-wash"></div><div class="atmosphere-cool-light"></div>
    ${SVG('0 0 1440 1000', `<g class="atmosphere-wind-bands"><path d="M-320 330C80 80 240 540 650 240S1180 140 1720-150"/><path d="M-300 400C110 150 220 590 680 290S1260 250 1750-90"/><path d="M-240 820C170 540 550 930 950 610S1440 490 1810 240"/><path d="M-280 870C190 580 540 970 990 660S1500 520 1850 310"/></g><g class="atmosphere-wind-echo"><path d="M-320 330C80 80 240 540 650 240S1180 140 1720-150"/><path d="M-240 820C170 540 550 930 950 610S1440 490 1810 240"/></g>`, 'atmosphere-wind-field')}
    <div class="atmosphere-curtain atmosphere-curtain-left"></div><div class="atmosphere-curtain atmosphere-curtain-right"></div>
    ${SVG('0 0 100 280', `<path d="M50 0V82" class="atmosphere-chime-thread"/><g class="atmosphere-chime-swing"><path d="M26 112C26 65 74 65 74 112Z" class="atmosphere-chime-glass"/><path d="M24 113Q50 123 76 113M50 94V161" class="atmosphere-chime-thread"/><path d="M39 156L61 160L60 227L42 223Z" class="atmosphere-chime-paper"/><path d="M49 168L51 209" class="atmosphere-chime-thread"/></g>`, 'atmosphere-wind-chime')}`;
  const winter = () => `<div class="atmosphere-fire-aura"></div><div class="atmosphere-fire-scene"><img class="atmosphere-fire-photo" src="assets/seasons/fire-soft.webp" alt="" decoding="async"/><canvas class="atmosphere-fire-canvas" aria-hidden="true"></canvas></div><div class="atmosphere-reading-veil"></div>`;

  /** One local texture, one quad, two texture samples. The image is also the no-WebGL fallback. */
  function createFireRenderer(container) {
    const canvas = container.querySelector('.atmosphere-fire-canvas');
    const photo = container.querySelector('.atmosphere-fire-photo');
    const surface = container.querySelector('.atmosphere-fire-scene');
    // Visible fire occupies only the lower part of this transparent photograph.
    // Crop into the charcoal bed so both the animated and static fire meet the floor.
    const fireCrop = { x: .02, y: .52, width: .96, height: .40 };
    const vertexSource = `
      attribute vec2 position;
      varying vec2 uv;
      void main() { uv = position * .5 + .5; gl_Position = vec4(position, 0., 1.); }
    `;
    const fragmentSource = `
      precision mediump float;
      varying vec2 uv;
      uniform sampler2D photograph;
      uniform vec2 fit;
      uniform vec4 crop;
      uniform float time;
      // A bounded polynomial hash avoids GPU-dependent sin-hash seams between cells.
      float hash(vec2 p, float period) {
        p.y = mod(p.y, period);
        vec3 p3 = fract(vec3(p.xyx) * .1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float noise(vec2 p, float period) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3. - 2. * f);
        return mix(mix(hash(i, period), hash(i + vec2(1., 0.), period), f.x),
                   mix(hash(i + vec2(0., 1.), period), hash(i + vec2(1., 1.), period), f.x), f.y);
      }
      vec4 flame(vec2 p) {
        float inside = step(0., p.x) * step(p.x, 1.) * step(0., p.y) * step(p.y, 1.);
        vec2 source = vec2(crop.x + p.x * crop.z, 1. - crop.y - crop.w + p.y * crop.w);
        return texture2D(photograph, clamp(source, .001, .999)) * inside;
      }
      void main() {
        // Preserve the photograph's proportions; its base stays anchored at the floor.
        vec2 p = vec2((uv.x - (1. - fit.x) * .5) / fit.x, uv.y / fit.y);
        float height = clamp(p.y, 0., 1.);
        // Both fields travel upward through one full spatial period in ten seconds.
        float phase = time * .628318530718;
        float broad = noise(vec2(p.x * 7., p.y * 4.5 - time * .6), 6.);
        float fine = noise(vec2(p.x * 16. + broad, p.y * 9. - time * .9), 9.);
        float lift = smoothstep(.08, .95, height);
        vec2 drift = vec2((broad - .5) * (.012 + .11 * lift),
                          (fine - .5) * (.006 + .085 * lift));
        drift.x += sin(p.y * 12. - phase + p.x * 9.) * .014 * lift;
        drift.y += sin(p.x * 14. + phase) * .019 * lift;
        // Keep the charcoal bed fixed to the viewport edge as flames rise above it.
        drift *= smoothstep(0., .08, height);
        vec4 first = flame(p + drift);
        vec4 second = flame(p + drift * .64 + vec2((fine - .5) * .025 * lift, (-.012 - broad * .032) * lift));
        // Two ascending fields break up the tongues within the image, rather than scaling a flat picture.
        vec4 fire = mix(first, second, .16 + height * .17);
        float shimmer = .95 + broad * .08;
        float coalShade = mix(.85, 1., smoothstep(.05, .23, height));
        fire.rgb *= vec3(.98, .94, .86) * shimmer * coalShade;
        fire *= 1. - smoothstep(.97, 1., p.y);
        gl_FragColor = fire;
      }
    `;
    let gl = null, program = null, buffer = null, texture = null;
    let fitLocation = null, timeLocation = null;
    let frame = 0, elapsed = 0, lastDraw = 0;
    let requested = false, disposed = false, failed = false, imageReady = false;

    function stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0; lastDraw = 0;
      container.dataset.fireAnimating = 'false';
    }
    function release(loseContext = false) {
      if (!gl) return;
      if (texture) gl.deleteTexture(texture);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      texture = buffer = program = null;
      if (loseContext) gl.getExtension('WEBGL_lose_context')?.loseContext();
      gl = null;
    }
    function fallback() {
      stop(); failed = true;
      container.dataset.fireRenderer = 'static';
      release();
    }
    function compile(type, source) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('No shader');
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('Shader unavailable'); }
      return shader;
    }
    function initialize() {
      if (disposed || failed || !imageReady || gl) return;
      let vertex = null, fragment = null;
      try {
        gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
        if (!gl) { fallback(); return; }
        vertex = compile(gl.VERTEX_SHADER, vertexSource);
        const highPrecision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision > 0;
        fragment = compile(gl.FRAGMENT_SHADER, highPrecision ? fragmentSource.replace('precision mediump float;', 'precision highp float;') : fragmentSource);
        program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Program unavailable');
        gl.deleteShader(vertex); gl.deleteShader(fragment); vertex = fragment = null;
        gl.useProgram(program);
        buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        fitLocation = gl.getUniformLocation(program, 'fit'); timeLocation = gl.getUniformLocation(program, 'time');
        gl.uniform4f(gl.getUniformLocation(program, 'crop'), fireCrop.x, fireCrop.y, fireCrop.width, fireCrop.height);
        texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        // Bound GPU texture memory even if a future photograph is replaced with a large original.
        const limit = Math.min(1536, gl.getParameter(gl.MAX_TEXTURE_SIZE));
        const ratio = Math.min(1, limit / Math.max(photo.naturalWidth, photo.naturalHeight));
        let source = photo;
        if (ratio < 1) {
          source = document.createElement('canvas'); source.width = Math.round(photo.naturalWidth * ratio); source.height = Math.round(photo.naturalHeight * ratio);
          const context = source.getContext('2d');
          if (!context) throw new Error('Texture scaling unavailable');
          context.drawImage(photo, 0, 0, source.width, source.height);
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.uniform1i(gl.getUniformLocation(program, 'photograph'), 0);
        gl.clearColor(0,0,0,0);
        resize();
      } catch {
        if (gl && vertex) gl.deleteShader(vertex);
        if (gl && fragment) gl.deleteShader(fragment);
        fallback();
      }
    }
    function resize() {
      if (disposed || !imageReady) return;
      const rect = surface.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const contentWidth = photo.naturalWidth * fireCrop.width;
      const contentHeight = photo.naturalHeight * fireCrop.height;
      // Portrait screens see the shorter central tongues; fill the same lower third more closely.
      const portraitFill = rect.width < 600 ? 1.18 : 1;
      const cover = Math.max(rect.width / contentWidth, rect.height / contentHeight) * portraitFill;
      // Apply the same crop to the fallback, including while animation is disabled.
      photo.style.width = `${photo.naturalWidth * cover}px`;
      photo.style.height = `${photo.naturalHeight * cover}px`;
      photo.style.left = `${(rect.width - contentWidth * cover) / 2 - photo.naturalWidth * fireCrop.x * cover}px`;
      photo.style.top = `${rect.height - contentHeight * cover - photo.naturalHeight * fireCrop.y * cover}px`;
      container.dataset.fireReady = 'true';
      if (!gl || !program) return;
      const scale = Math.min(devicePixelRatio || 1, 1, 780 / rect.width, 900 / rect.height, Math.sqrt(500000 / (rect.width * rect.height)));
      canvas.width = Math.max(1, Math.round(rect.width * scale));
      canvas.height = Math.max(1, Math.round(rect.height * scale));
      gl.viewport(0,0,canvas.width,canvas.height);
      gl.uniform2f(fitLocation, contentWidth * cover / rect.width, contentHeight * cover / rect.height);
      if (requested) draw(performance.now(), false);
    }
    function draw(now, advance = true) {
      if (disposed || !gl || !program) return;
      if (advance && lastDraw) elapsed = (elapsed + Math.max(0, now - lastDraw) / 1000) % 10;
      lastDraw = now;
      gl.uniform1f(timeLocation, elapsed);
      gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      attribute(container, 'data-fire-renderer', 'webgl');
    }
    function schedule() {
      if (disposed || failed || !requested || !gl || frame) return;
      // Follow the display clock directly: a timer plus RAF skips refreshes unevenly.
      frame = requestAnimationFrame(tick);
    }
    function tick(now) {
      frame = 0;
      if (disposed || !requested || document.hidden || pageHidden || reduced.matches || body.classList.contains('garden-motion-off')) { stop(); return; }
      draw(now);
      schedule();
    }
    function setRunning(value) {
      if (disposed) return;
      requested = value;
      if (!value) { stop(); return; }
      if (failed || !imageReady) return;
      initialize();
      if (!gl) return;
      container.dataset.fireAnimating = 'true';
      schedule();
    }
    const imageLoaded = () => {
      if (disposed) return;
      imageReady = photo.naturalWidth > 0;
      if (imageReady) { resize(); setRunning(requested); }
    };
    const imageFailed = () => { if (!disposed) fallback(); };
    const lost = event => { event.preventDefault(); stop(); container.dataset.fireRenderer = 'static'; gl = program = buffer = texture = null; };
    const restored = () => { if (!disposed) { failed = false; setRunning(requested); } };
    photo.addEventListener('load', imageLoaded); photo.addEventListener('error', imageFailed);
    canvas.addEventListener('webglcontextlost', lost); canvas.addEventListener('webglcontextrestored', restored);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(surface);
    if (!observer) window.addEventListener('resize', resize, { passive: true });
    if (photo.complete && photo.naturalWidth) imageLoaded();
    return {
      setRunning,
      dispose() {
        disposed = true; requested = false; stop(); observer?.disconnect();
        window.removeEventListener('resize', resize);
        photo.removeEventListener('load', imageLoaded); photo.removeEventListener('error', imageFailed);
        canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored);
        release(true);
      }
    };
  }
  function isSelected() {
    if (!preferences.has(current)) preferences.set(current, storage.read(`garden_atmosphere_${current}`) !== 'false');
    return preferences.get(current);
  }
  function attribute(element, name, value) {
    const next = String(value);
    if (element.getAttribute(name) !== next) element.setAttribute(name, next);
  }
  function syncState() {
    if (!scene) return;
    const globalPaused = body.classList.contains('garden-motion-off') || reduced.matches;
    const hidden = document.hidden || pageHidden;
    const selected = isSelected();
    const running = selected && !globalPaused && !hidden;
    attribute(scene, 'data-running', running);
    fireRenderer?.setRunning(running);
    attribute(toggle, 'aria-pressed', selected && !globalPaused);
    toggle.disabled = globalPaused;
    dock.inert = body.classList.contains('dialog-open') || body.classList.contains('vocab-focus-mode');
    const noun = current === 'summer' ? '凉风' : '炉火';
    const state = globalPaused ? '随动效暂停' : !selected ? '静止' : current === 'summer' ? '轻拂' : '徐燃';
    const nextLabel = `${noun} · ${state}`;
    if (label.textContent !== nextLabel) label.textContent = nextLabel;
    attribute(toggle, 'aria-label', reduced.matches ? `${noun}已遵循系统减少动态效果设置` : globalPaused ? `${noun}已暂停，请先打开顶部动效` : `${selected ? '暂停' : '开启'}${noun}氛围`);
    attribute(toggle, 'title', globalPaused ? '由顶部动效开关统一控制' : selected ? '暂停氛围，保留静态景色' : '让这一角重新流动');
  }
  function mount() {
    const next = root.dataset.appearance || 'art';
    if (next === current) { syncState(); return; }
    current = next;
    fireRenderer?.dispose(); fireRenderer = null;
    scene?.remove(); dock?.remove(); scene = dock = toggle = label = null;
    if (!['summer', 'winter'].includes(current)) return;
    scene = document.createElement('div');
    scene.className = `season-atmosphere atmosphere-${current}`;
    scene.dataset.atmosphereOwned = '';
    scene.setAttribute('aria-hidden', 'true');
    scene.innerHTML = current === 'summer' ? summer() : winter();
    if (current === 'summer') {
      const veil = document.createElement('div'); veil.className = 'atmosphere-reading-veil'; scene.append(veil);
    }
    dock = document.createElement('div');
    dock.className = 'atmosphere-dock'; dock.dataset.atmosphereOwned = '';
    toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'atmosphere-toggle';
    toggle.innerHTML = SVG('0 0 24 24', current === 'summer' ? windIcon : fireIcon, 'atmosphere-control-icon');
    label = document.createElement('span'); toggle.append(label); dock.append(toggle);
    toggle.addEventListener('click', () => {
      if (toggle.disabled) return;
      preferences.set(current, !isSelected());
      storage.write(`garden_atmosphere_${current}`, String(isSelected()));
      syncState();
    });
    body.prepend(scene); body.append(dock);
    if (current === 'winter') fireRenderer = createFireRenderer(scene);
    syncState();
  }
  document.addEventListener('appearance-changed', mount);
  document.addEventListener('visibilitychange', syncState);
  reduced.addEventListener('change', syncState);
  new MutationObserver(syncState).observe(body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('pagehide', () => { pageHidden = true; syncState(); });
  window.addEventListener('pageshow', () => { pageHidden = false; syncState(); });
  window.addEventListener('storage', event => {
    if (event.key === null) {
      preferences.clear(); syncState(); return;
    }
    const changedSeason = ['summer', 'winter'].find(season => event.key === `garden_atmosphere_${season}`);
    if (!changedSeason) return;
    preferences.delete(changedSeason);
    if (changedSeason === current) syncState();
  });
  mount();
})();
