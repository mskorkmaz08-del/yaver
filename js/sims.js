// The workshop: an interactive simulator for every lesson. pickSim() chooses a simulator and
// its setting from the lesson's track and title; mountSim() loads it (each lives in js/sims/)
// and gives it a blueprint stage, a timeline and controls. Everything animates on a canvas
// with easing between states, so scrubbing and stepping stay smooth.


// ---------- Which simulator for which lesson ----------
const RULES = [
  // [track regex, title regex, sim, mode]
  [/robo/, /arduino|blink|digital|button|debounc|analog|potentiom|serial|pwm|servo|sensor|library/i, 'circuit', 'arduino'],
  [/robo/, /parallel/i, 'circuit', 'parallel'],
  [/robo/, /series/i, 'circuit', 'series'],
  [/robo/, /divider/i, 'circuit', 'divider'],
  [/robo/, /kirchhoff/i, 'circuit', 'divider'],
  [/robo/, /diode|led|colour code|datasheet/i, 'circuit', 'led'],
  [/robo/, /capacit|rc time|decoupl/i, 'circuit', 'rc'],
  [/robo/, /transistor|load|flyback|relay|motor/i, 'circuit', 'transistor'],
  [/robo/, /power|battery|wattage/i, 'circuit', 'power'],
  [/robo/, /./, 'circuit', 'ohm'],
  [/algo|python|build|cpp/, /dijkstra/i, 'graph', 'dijkstra'],
  [/algo|python|build|cpp/, /breadth|bfs|graph/i, 'graph', 'bfs'],
  [/algo|python|build|cpp/, /depth-first|dfs|flood/i, 'graph', 'dfs'],
  [/algo|python|build|cpp/, /tree|bst/i, 'graph', 'bst'],
  [/algo|python|build|cpp/, /heap/i, 'structures', 'heap'],
  [/algo|python|build|cpp/, /hash|anagram|two-sum|frequenc|seen-before/i, 'structures', 'hash'],
  [/algo|python|build|cpp/, /linked list|pointer move/i, 'structures', 'list'],
  [/algo|python|build|cpp/, /stack|queue/i, 'structures', 'stack'],
  [/algo|python|build|cpp/, /recurs|backtrack|subsets|permutation|call stack/i, 'structures', 'recursion'],
  [/algo/, /merge sort/i, 'sort', 'merge'],
  [/algo/, /quick|divide and conquer/i, 'sort', 'quick'],
  [/algo/, /sort/i, 'sort', 'selection'],
  [/algo/, /binary search|big-o/i, 'search', 'binary'],
  [/algo/, /two pointers|3sum|rain water/i, 'search', 'twopointers'],
  [/algo/, /sliding window/i, 'search', 'window'],
  [/algo/, /diagnostic|arrays/i, 'search', 'binary'],
  [/math/, /3d|cross product/i, 'vectors', '3d'],
  [/math/, /eigen|power iteration/i, 'vectors', 'eigen'],
  [/math/, /determinant|inverse|rank|null space|solve/i, 'vectors', 'det'],
  [/math/, /dot product|cosine|projection|duality/i, 'vectors', 'dot'],
  [/math/, /basis|frame/i, 'vectors', 'basis'],
  [/math/, /transform|matri|rotation|composition|nonsquare|linear algebra/i, 'vectors', 'transform'],
  [/math/, /vector|span/i, 'vectors', 'span'],
  [/math/, /gradient|descent|fit a line/i, 'calculus', 'descent'],
  [/math/, /chain rule|product rule|implicit|number e|derivative formulas/i, 'calculus', 'tangent'],
  [/math/, /derivative|finite difference|gradient check|partial/i, 'calculus', 'secant'],
  [/math|ai/, /central limit|standard error|sampling distribution/i, 'probability', 'clt'],
  [/math|ai/, /bootstrap|confidence/i, 'probability', 'bootstrap'],
  [/math|ai/, /conditional|bayes/i, 'probability', 'conditional'],
  [/math|ai/, /probab|random|simulat|distribution/i, 'probability', 'dice'],
  [/ai|build|python/, /join|merge|reshap/i, 'data', 'join'],
  [/ai|build|python/, /group|aggregat|pivot|metrics|per-student|per-topic|statistic/i, 'data', 'group'],
  [/ai|build|python/, /clean|missing|duplicat|messy|anonymiz|categorical|string/i, 'data', 'clean'],
  [/ai|build/, /sql|select|where|sorting|insert|schema/i, 'data', 'filter'],
  [/ai|build/, /chart|plot|visuali|honest/i, 'data', 'chart'],
  [/cpp/, /vector|array/i, 'memory', 'vector'],
  [/cpp/, /smart pointer|unique_ptr|raii|dynamic|heap/i, 'memory', 'heap'],
  [/cpp/, /pointer|memory|reference|const/i, 'memory', 'pointers'],
  [/tools|build/, /branch|merg|git|github|remote|pull request/i, 'git', 'branch'],
  [/tools/, /pipe|redirect|grep|find/i, 'shell', 'pipes'],
  [/tools/, /./, 'shell', 'tree'],
];

// Lessons with a runnable Python example get the code tracer unless a picture explains them better.
const TRACE_FIRST = /python|build/;

export function firstCode(l, lang = 'python') {
  const steps = [...(l.steps || [])].sort((a, b) => (a.kind === 'example' ? -1 : 0) - (b.kind === 'example' ? -1 : 0));
  for (const s of steps) {
    const m = (s.body || '').match(new RegExp('```' + lang + '\\n([\\s\\S]*?)```'));
    if (m && m[1].trim().split('\n').length >= 2) return m[1].replace(/\s+$/, '');
  }
  return null;
}

export function pickSim(l) {
  if (!l || !l.track) return null;
  const title = `${l.title} ${l.lane || ''}`;
  const code = firstCode(l);
  if (TRACE_FIRST.test(l.track) && code && !/^(ai|math)$/.test(l.track)) {
    const rule = RULES.find(([t, re, sim]) => t.test(l.track) && re.test(title) && ['graph', 'structures', 'data'].includes(sim));
    if (!rule) return { sim: 'trace', mode: 'python', code };
  }
  for (const [t, re, sim, mode] of RULES) if (t.test(l.track) && re.test(title)) return { sim, mode, code };
  // Fallbacks so every lesson has a workshop.
  if (code) return { sim: 'trace', mode: 'python', code };
  return {
    python: { sim: 'structures', mode: 'stack' }, build: { sim: 'data', mode: 'group' }, algo: { sim: 'sort', mode: 'selection' },
    math: { sim: 'vectors', mode: 'transform' }, ai: { sim: 'data', mode: 'filter' }, cpp: { sim: 'memory', mode: 'pointers' },
    tools: { sim: 'shell', mode: 'tree' }, robo: { sim: 'circuit', mode: 'ohm' }, mixed: { sim: 'sort', mode: 'quick' },
  }[l.track] || { sim: 'sort', mode: 'selection' };
}

export const SIM_NAMES = {
  circuit: 'Circuit bench', sort: 'Sorting engine', search: 'Search rig', graph: 'Graph explorer', structures: 'Data structures',
  vectors: 'Vector loom', calculus: 'Slope machine', probability: 'Probability mill', data: 'Table press', trace: 'Code tracer',
  memory: 'Memory map', git: 'Branch loom', shell: 'Shell workshop',
};

// ---------- Mounting ----------
export function simHTML(l) {
  const p = pickSim(l);
  if (!p) return '';
  return `<section class="card sim-card" data-sim="${p.sim}" data-mode="${p.mode}">
    <div class="card-head"><p class="label">workshop · ${SIM_NAMES[p.sim]}</p><button class="link sim-full" data-sim-full aria-label="Bigger">⤢</button></div>
    <div class="sim" data-sim-host><p class="sim-loading">Winding up the workshop…</p></div>
  </section>`;
}

export async function mountSim(card, l) {
  if (!card || card._mounted) return;
  card._mounted = true;
  const p = pickSim(l);
  const host = card.querySelector('[data-sim-host]');
  // Bigger: the workshop takes the whole screen, above everything (focus mode's notebook too);
  // the same button, or Esc, brings it back onto the page.
  const btn = card.querySelector('[data-sim-full]');
  let spot = null;
  const setFull = on => {
    // the card moves to the top level while it's full, so nothing on the page can clip or cover it
    if (on && !spot) { spot = document.createComment('sim'); card.before(spot); document.body.append(card); }
    if (!on && spot) { spot.isConnected ? spot.replaceWith(card) : card.remove(); spot = null; }
    card.classList.toggle('full', on);
    document.body.classList.toggle('sim-open', on);
    if (btn) { btn.textContent = on ? '✕' : '⤢'; btn.setAttribute('aria-label', on ? 'Back to the page' : 'Bigger'); }
    host._resize?.();
  };
  btn?.addEventListener('click', () => setFull(!card.classList.contains('full')));
  addEventListener('keydown', e => { if (e.key === 'Escape' && card.classList.contains('full')) { e.stopImmediatePropagation(); setFull(false); } }, true);
  try {
    const mod = await import(`./sims/${p.sim}.js`);
    host.innerHTML = '';
    mod.default(host, { mode: p.mode, code: p.code, lesson: l, kit: KIT });
  } catch (e) {
    host.innerHTML = `<p class="sim-loading">The workshop couldn't start: ${String(e.message || e).replace(/</g, '&lt;')}</p>`;
  }
}

// ---------- The kit every simulator uses ----------
export const C = {
  bg: '#111519', bg2: '#181d23', grid: 'rgba(159,180,200,.07)', ink: '#e9edf1', dim: 'rgba(233,237,241,.55)', faint: 'rgba(233,237,241,.18)',
  brass: '#ffb547', brassHi: '#ffd89a', teal: '#7fb2d9', glow: '#cfe3f3', red: '#ef7a6d', green: '#7dd3a8', amber: '#ffb547', violet: '#b4a6f2',
};
const FONT = '"Archivo", "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

export const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// A canvas that fills the host's width at the device's pixel ratio. draw(ctx, w, h) is yours.
function stage(host, { height = 260, aspect } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sim-stage';
  const cv = document.createElement('canvas');
  wrap.append(cv);
  host.append(wrap);
  const ctx = cv.getContext('2d');
  const st = { cv, ctx, w: 300, h: height, wrap };
  st.resize = () => {
    const cs = getComputedStyle(wrap);
    const w = Math.max(220, wrap.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0));
    const h = aspect ? Math.round(w / aspect) : (host.closest('.full') ? Math.round(Math.min(innerHeight * 0.62, w * 0.8)) : height);
    const r = Math.min(2.5, devicePixelRatio || 1);
    cv.width = Math.round(w * r); cv.height = Math.round(h * r);
    cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    st.w = w; st.h = h;
  };
  st.resize();
  host._resize = () => { st.resize(); st.dirty = true; };
  if ('ResizeObserver' in window) new ResizeObserver(() => host._resize()).observe(wrap);
  // Pointer helper in canvas coordinates.
  st.pointer = (handlers) => {
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    let down = false;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', e => { down = true; cv.setPointerCapture(e.pointerId); handlers.down?.(pos(e), e); st.dirty = true; });
    cv.addEventListener('pointermove', e => { handlers.move?.(pos(e), down, e); if (down) st.dirty = true; });
    const up = e => { if (!down) return; down = false; handlers.up?.(pos(e), e); st.dirty = true; };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  };
  return st;
}

// Instrument plate: graphite, a fine grid, amber corner marks.
function plate(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, C.bg2); g.addColorStop(1, C.bg);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0.5; x < w; x += 20) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = 0.5; y < h; y += 20) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,181,71,.5)'; ctx.lineWidth = 1.5;
  for (const [x, y, sx, sy] of [[6, 6, 1, 1], [w - 6, 6, -1, 1], [6, h - 6, 1, -1], [w - 6, h - 6, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(x, y + 14 * sy); ctx.lineTo(x, y); ctx.lineTo(x + 14 * sx, y); ctx.stroke();
  }
}

function text(ctx, s, x, y, { size = 14, color = C.ink, align = 'left', base = 'alphabetic', mono = false, weight = 500, italic = false } = {}) {
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${mono ? MONO : FONT}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
  // shrink a left-aligned line that would run off the plate on a narrow phone
  if (align === 'left') {
    const room = ctx.canvas.width / (ctx.getTransform().a || 1) - x - 10, wide = ctx.measureText(s).width;
    if (wide > room && room > 40) ctx.font = `${italic ? 'italic ' : ''}${weight} ${Math.max(8, size * room / wide)}px ${mono ? MONO : FONT}`;
  }
  ctx.fillText(s, x, y);
}

function roundRect(ctx, x, y, w, h, r = 4) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function arrow(ctx, x1, y1, x2, y2, { color = C.brass, width = 1.6, head = 7, dash } = {}) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
  ctx.setLineDash(dash || []);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.setLineDash([]);
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath(); ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(a - 0.4), y2 - head * Math.sin(a - 0.4));
  ctx.lineTo(x2 - head * Math.cos(a + 0.4), y2 - head * Math.sin(a + 0.4));
  ctx.closePath(); ctx.fill();
}

// A brass dial gauge, for meters.
function gauge(ctx, x, y, r, value, max, label, unit, color = C.glow) {
  ctx.save();
  ctx.translate(x, y);
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r);
  g.addColorStop(0, '#eef1f4'); g.addColorStop(1, '#c4ccd4');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.brass; ctx.lineWidth = 3; ctx.stroke();
  ctx.strokeStyle = '#3b3f4a'; ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (0.75 + 1.5 * (i / 10));
    const r1 = i % 5 ? r * 0.78 : r * 0.68;
    ctx.beginPath(); ctx.moveTo(r1 * Math.cos(a), r1 * Math.sin(a)); ctx.lineTo(r * 0.88 * Math.cos(a), r * 0.88 * Math.sin(a)); ctx.stroke();
  }
  const a = Math.PI * (0.75 + 1.5 * clamp(value / max, 0, 1.04));
  ctx.strokeStyle = '#1a1f25'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-r * 0.12 * Math.cos(a), -r * 0.12 * Math.sin(a)); ctx.lineTo(r * 0.8 * Math.cos(a), r * 0.8 * Math.sin(a)); ctx.stroke();
  ctx.fillStyle = '#1a1f25'; ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
  text(ctx, label, 0, r * 0.42, { size: Math.max(8, r * 0.26), color: '#4c5262', align: 'center', weight: 600 });
  ctx.restore();
  text(ctx, `${fmt(value)} ${unit}`, x, y + r + 15, { size: 13, color, align: 'center', mono: true });
}
export const fmt = v => String(Number(v.toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2)));

// The animation loop: runs while the workshop is on screen and something moves.
function loop(host, st, frame) {
  let last = performance.now(), visible = true, raf = 0;
  const tick = now => {
    raf = 0;
    if (!host.isConnected) return;
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    const busy = frame(dt, now / 1000);
    st.dirty = false;
    if (visible && (busy || st.dirty)) raf = requestAnimationFrame(tick);
  };
  const kick = () => { if (!raf && visible) { last = performance.now(); raf = requestAnimationFrame(tick); } };
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); }).observe(host);
  const origResize = host._resize;
  host._resize = () => { origResize?.(); kick(); };
  st.kick = kick;
  kick();
  return kick;
}

// Controls under the stage: buttons, sliders, selects. Returns elements by key.
function controls(host, items) {
  const bar = document.createElement('div');
  bar.className = 'sim-controls';
  const out = {};
  for (const it of items) {
    if (it.type === 'slider') {
      const l = document.createElement('label');
      l.className = 'sim-slider';
      l.innerHTML = `<span>${it.label}</span><input type="range" min="${it.min}" max="${it.max}" step="${it.step || 1}" value="${it.value}"><b></b>`;
      const inp = l.querySelector('input'), b = l.querySelector('b');
      const show = () => { b.textContent = it.format ? it.format(Number(inp.value)) : inp.value; };
      inp.addEventListener('input', () => { show(); it.onInput?.(Number(inp.value)); });
      show();
      out[it.key] = { el: inp, set: v => { inp.value = v; show(); } };
      bar.append(l);
    } else if (it.type === 'select') {
      const s = document.createElement('select');
      s.className = 'sim-select';
      s.innerHTML = it.options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
      s.value = it.value;
      s.addEventListener('change', () => it.onChange?.(s.value));
      out[it.key] = { el: s };
      bar.append(s);
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `sim-btn ${it.primary ? 'primary' : ''}`;
      b.innerHTML = it.label;
      b.addEventListener('click', () => it.onClick?.(b));
      out[it.key] = { el: b };
      bar.append(b);
    }
  }
  host.append(bar);
  return out;
}

function caption(host, html) {
  const p = document.createElement('p');
  p.className = 'sim-caption';
  p.innerHTML = html;
  host.append(p);
  return p;
}

// A timeline over precomputed frames: play, pause, step and a scrubber with a smooth position.
// draw(ctx, w, h, a, b, t, i) gets the frame before and after the position and how far between.
function timeline(host, st, { frames, draw, speed = 1.4, autoplay = true, label = f => f?.note || '' }) {
  let pos = 0, playing = autoplay, target = null;
  let list = frames;
  const note = caption(host, '');
  const ui = controls(host, [
    { key: 'back', label: '⟲', onClick: () => { pos = 0; target = null; playing = false; sync(); kick(); } },
    { key: 'step', label: '◂', onClick: () => { playing = false; target = Math.max(0, Math.ceil(pos) - 1); sync(); kick(); } },
    { key: 'play', label: playing ? 'Pause' : 'Play', primary: true, onClick: () => { if (pos >= list.length - 1) pos = 0; playing = !playing; target = null; sync(); kick(); } },
    { key: 'next', label: '▸', onClick: () => { playing = false; target = Math.min(list.length - 1, Math.floor(pos) + 1); sync(); kick(); } },
    { key: 'speed', type: 'slider', label: 'speed', min: 0.25, max: 4, step: 0.25, value: speed, format: v => `${v}×`, onInput: v => { speed = v; } },
  ]);
  const scrub = document.createElement('input');
  scrub.type = 'range'; scrub.className = 'sim-scrub'; scrub.min = 0; scrub.step = 0.001;
  scrub.addEventListener('input', () => { playing = false; target = null; pos = Number(scrub.value); sync(); kick(); });
  ui.play.el.parentElement.after(scrub);
  const sync = () => {
    scrub.max = Math.max(0, list.length - 1);
    scrub.value = pos;
    ui.play.el.textContent = playing ? 'Pause' : pos >= list.length - 1 ? 'Replay' : 'Play';
    const i = Math.min(list.length - 1, Math.round(pos));
    note.innerHTML = `<b>${i + 1}/${list.length}</b> ${label(list[i]) || ''}`;
  };
  const kick = loop(host, st, dt => {
    if (playing) { pos += dt * speed; if (pos >= list.length - 1) { pos = list.length - 1; playing = false; } }
    else if (target != null) { const d = target - pos; pos += Math.sign(d) * Math.min(Math.abs(d), dt * Math.max(3, speed * 3)); if (Math.abs(target - pos) < 1e-3) { pos = target; target = null; } }
    sync();
    const i = Math.floor(pos), t = ease(pos - i);
    plate(st.ctx, st.w, st.h);
    draw(st.ctx, st.w, st.h, list[i], list[Math.min(list.length - 1, i + 1)], t, i);
    return playing || target != null;
  });
  sync();
  return { set(frames2, play = true) { list = frames2; pos = 0; target = null; playing = play; sync(); kick(); }, kick, get pos() { return pos; } };
}

export const KIT = { stage, plate, text, roundRect, arrow, gauge, loop, controls, caption, timeline, C, ease, lerp, clamp, fmt, FONT, MONO };
