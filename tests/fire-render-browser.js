// Sample the production WebGL program with its real photograph, independent of CSS compositing.
async (page, options = {}) => {
  const origin = 'http://127.0.0.1:8766';
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
  const checks = [], errors = [];
  const check = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  try {
    if (options.runtimeSource) await context.route('**/season-atmosphere.js*', route => route.fulfill({ contentType: 'text/javascript', body: options.runtimeSource }));
    await context.addInitScript(() => {
      localStorage.setItem('blog_appearance', 'winter');
      localStorage.setItem('garden_motion_paused', 'false');
      localStorage.setItem('garden_atmosphere_winter', 'true');
      window.fireRenderProbe = { gl: null, program: null, time: null, frames: [], shaderTime: 0 };
      const prototype = WebGLRenderingContext.prototype;
      const locate = prototype.getUniformLocation, uniform = prototype.uniform1f, draw = prototype.drawArrays;
      prototype.getUniformLocation = function(program, name) {
        const location = locate.call(this, program, name);
        if (this.canvas.classList.contains('atmosphere-fire-canvas') && name === 'time') {
          Object.assign(fireRenderProbe, { gl: this, program, time: location });
        }
        return location;
      };
      prototype.uniform1f = function(location, value) {
        if (location === fireRenderProbe.time) fireRenderProbe.shaderTime = value;
        return uniform.call(this, location, value);
      };
      prototype.drawArrays = function(...args) {
        if (this === fireRenderProbe.gl) fireRenderProbe.frames.push({ now: performance.now(), time: fireRenderProbe.shaderTime });
        return draw.apply(this, args);
      };
    });
    const target = await context.newPage();
    target.on('pageerror', error => errors.push(error.message));
    await target.goto(`${origin}/library`);
    await target.waitForFunction(() => document.querySelector('.season-atmosphere')?.dataset.fireRenderer === 'webgl');
    await target.evaluate(() => {
      fireRenderProbe.frames.length = 0;
      fireRenderProbe.referenceFrames = 0;
      const observe = () => { fireRenderProbe.referenceFrames++; fireRenderProbe.referenceRequest = requestAnimationFrame(observe); };
      fireRenderProbe.referenceRequest = requestAnimationFrame(observe);
    });
    await target.waitForTimeout(2200);
    const cadence = await target.evaluate(() => {
      cancelAnimationFrame(fireRenderProbe.referenceRequest);
      const frames = fireRenderProbe.frames;
      const gaps = frames.slice(1).map((frame, index) => frame.now - frames[index].now);
      const sorted = [...gaps].sort((a, b) => a - b);
      const mean = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
      return {
        frames: frames.length, referenceFrames: fireRenderProbe.referenceFrames, meanMs: mean,
        p50Ms: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)],
        maxMs: sorted.at(-1),
        gapBuckets: gaps.reduce((buckets, value) => { const key = Math.round(value / (1000 / 60)); buckets[key] = (buckets[key] || 0) + 1; return buckets; }, {})
      };
    });
    await target.locator('.atmosphere-toggle').click();
    const samples = await target.evaluate(() => {
      const { gl, program, time } = fireRenderProbe;
      const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
      gl.useProgram(program);
      function render(seconds) {
        gl.uniform1f(time, seconds); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const bytes = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        return bytes;
      }
      function difference(first, second) {
        let sum = 0, changedPixels = 0, maximum = 0;
        for (let index = 0; index < first.length; index += 4) {
          let changed = false;
          for (let channel = 0; channel < 4; channel++) {
            const delta = Math.abs(first[index + channel] - second[index + channel]);
            sum += delta; maximum = Math.max(maximum, delta); changed ||= delta > 2;
          }
          if (changed) changedPixels++;
        }
        return { mean: sum / first.length, changedFraction: changedPixels / (first.length / 4), maximum };
      }
      const epsilon = 1 / 60;
      const start = render(0), next = render(epsilon), middle = render(5), middleNext = render(5 + epsilon);
      const beforeEnd = render(10 - epsilon), end = render(10), afterEnd = render(10 + epsilon);
      let visible = 0;
      for (let index = 3; index < start.length; index += 4) if (start[index] > 20) visible++;
      // Display only the production fine displacement field, so flame edges cannot hide a broken noise lattice.
      const originalShaders = gl.getAttachedShaders(program);
      const vertexSource = gl.getShaderSource(originalShaders.find(shader => gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.VERTEX_SHADER));
      const fragmentSource = gl.getShaderSource(originalShaders.find(shader => gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER));
      const fieldSource = fragmentSource.replace(/gl_FragColor\s*=\s*fire\s*;/, 'gl_FragColor = vec4(vec3(fine), 1.);');
      if (fieldSource === fragmentSource) throw new Error('The fine-field diagnostic could not locate the production output');
      const fieldProgram = gl.createProgram(), fieldShaders = [];
      let fineField;
      try {
        for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fieldSource]]) {
          const shader = gl.createShader(type); fieldShaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
          gl.attachShader(fieldProgram, shader);
        }
        gl.bindAttribLocation(fieldProgram, gl.getAttribLocation(program, 'position'), 'position');
        gl.linkProgram(fieldProgram);
        if (!gl.getProgramParameter(fieldProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(fieldProgram));
        const fit = gl.getUniform(program, gl.getUniformLocation(program, 'fit'));
        gl.useProgram(fieldProgram);
        gl.uniform2fv(gl.getUniformLocation(fieldProgram, 'fit'), fit);
        const fieldTime = gl.getUniformLocation(fieldProgram, 'time');
        const fieldSamples = [];
        for (const seconds of [0, 2.7, 5, 10 - epsilon]) {
          gl.uniform1f(fieldTime, seconds);
          gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          const field = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, field);
          let maxHorizontal = 0, maxVertical = 0, discontinuities = 0;
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const index = (y * width + x) * 4;
            if (x + 1 < width) {
              const delta = Math.abs(field[index] - field[index + 4]);
              maxHorizontal = Math.max(maxHorizontal, delta); if (delta > 40) discontinuities++;
            }
            if (y + 1 < height) {
              const delta = Math.abs(field[index] - field[index + width * 4]);
              maxVertical = Math.max(maxVertical, delta); if (delta > 40) discontinuities++;
            }
          }
          fieldSamples.push({ seconds, maxHorizontal, maxVertical, discontinuities });
        }
        fineField = {
          maxHorizontal: Math.max(...fieldSamples.map(sample => sample.maxHorizontal)),
          maxVertical: Math.max(...fieldSamples.map(sample => sample.maxVertical)),
          discontinuities: fieldSamples.reduce((sum, sample) => sum + sample.discontinuities, 0),
          samples: fieldSamples
        };
      } finally {
        gl.useProgram(program);
        gl.deleteProgram(fieldProgram); fieldShaders.forEach(shader => gl.deleteShader(shader));
      }
      return {
        width, height, visibleFraction: visible / (width * height),
        fineField,
        firstLast: difference(start, end), middle: difference(start, middle),
        ordinaryStep: difference(start, next), middleStep: difference(middle, middleNext),
        seamStep: difference(beforeEnd, start), repeatedStep: difference(next, afterEnd),
        glError: gl.getError()
      };
    });
    const result = { cadence, samples, checks, pageErrors: errors };
    check(samples.width * samples.height <= 501000, 'The production renderer retains the half-million-pixel budget');
    check(samples.visibleFraction > .1 && samples.glError === 0, 'The real shader renders a nonempty fire without WebGL errors');
    check(samples.middle.mean > .1 && samples.middle.changedFraction > .02, 'The fire moves during the middle of the cycle');
    if (options.assertCadence !== false) check(cadence.frames > 0 && Math.abs(cadence.frames - cadence.referenceFrames) <= 2, 'The renderer follows every display refresh without a timer gate');
    if (options.assertContinuity !== false) check(samples.fineField.discontinuities === 0, 'The real fine displacement field has no abrupt lattice boundaries');
    if (options.assertLoop !== false) {
      check(samples.firstLast.mean <= .05 && samples.firstLast.changedFraction <= .001, 'The actual fire pixels at zero and ten seconds form a seamless loop');
      check(samples.repeatedStep.mean <= .05, 'The first frame after ten seconds matches the first frame of the next cycle');
      check(samples.seamStep.mean <= Math.max(.1, samples.ordinaryStep.mean, samples.middleStep.mean) * 3, 'The loop boundary has no larger jump than ordinary motion');
    }
    check(errors.length === 0, `No page errors: ${errors.join('; ')}`);
    return result;
  } finally { await context.close(); }
}
