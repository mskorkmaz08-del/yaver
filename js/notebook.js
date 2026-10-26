// The lesson as an open notebook on wide screens. The lesson's sections flow into side-by-side
// pages (CSS columns in a fixed-height box, shifted a spread at a time) and a paper leaf swings
// over the spine on each turn. Below 1100px nothing changes: the lesson is one scrolling page.
// The open spread is kept per lesson, so a redraw (revealing an answer) stays on the same pages.
const MQ = matchMedia('(min-width: 1100px)');
const GAP = 76; // the gutter between pages; half of it is each page's outer margin
const PAD = 28; // paper above and below the text: one ruled line
const TURN_MS = 820;
const pageOf = new Map();
let nb = null;

const ARROW = d => `<svg viewBox="0 0 24 24" class="i" aria-hidden="true"><path d="${d < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}"/></svg>`;

export function mount(art, id) {
  unmount();
  const flow = art?.querySelector('.nb-flow');
  if (!flow) return;
  const win = document.createElement('div');
  win.className = 'nb-win';
  flow.replaceWith(win);
  win.append(flow);
  const end = document.createElement('i');
  end.className = 'nb-end';
  flow.append(end);
  const pages = document.createElement('div');
  pages.className = 'nb-pages';
  pages.setAttribute('aria-hidden', 'true');
  pages.innerHTML = '<div class="nb-page left"></div><div class="nb-page right"></div><div class="nb-spine"></div>';
  art.prepend(pages);
  const nav = document.createElement('nav');
  nav.className = 'nb-nav';
  nav.setAttribute('aria-label', 'Notebook pages');
  nav.innerHTML = `<button class="icon-btn" data-nb="-1" aria-label="Previous pages">${ARROW(-1)}</button><span class="nb-at mono"></span><button class="icon-btn" data-nb="1" aria-label="Next pages">${ARROW(1)}</button>`;
  art.after(nav);
  nav.querySelectorAll('[data-nb]').forEach(b => (b.onclick = () => turn(Number(b.dataset.nb))));

  nb = { art, flow, win, end, nav, id, strip: art.querySelector('.step-strip'), k: pageOf.get(id) || 0, n: 1, cols: 1, W: 0, H: 0, busy: null };
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => requestAnimationFrame(refit)) : null;
  ro?.observe(art);
  // sections grow when a simulator loads or an answer opens: recount the pages
  ro && [...flow.children].forEach(c => ro.observe(c));
  // focusing a field on a hidden page scrolls the clipped box: turn to that page instead
  win.addEventListener('scroll', () => {
    if (!win.scrollLeft && !win.scrollTop) return;
    win.scrollLeft = win.scrollTop = 0;
    const el = document.activeElement;
    if (el && flow.contains(el)) go(spreadOf(el));
  });
  let acc = 0, quiet = 0;
  win.addEventListener('wheel', e => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    if (Date.now() < quiet) return;
    acc += e.deltaX;
    if (Math.abs(acc) > 60) { turn(Math.sign(acc)); acc = 0; quiet = Date.now() + TURN_MS + 200; }
  }, { passive: false });
  nb.ro = ro;
  edgeDrag(art);
  nb.onResize = () => refit();
  addEventListener('resize', nb.onResize);
  MQ.addEventListener?.('change', nb.onResize);
  document.fonts?.ready.then(() => nb && nb.art === art && refit());
  refit();
}

export function unmount() {
  if (!nb) return;
  nb.ro?.disconnect();
  removeEventListener('resize', nb.onResize);
  MQ.removeEventListener?.('change', nb.onResize);
  finishTurn();
  document.body.classList.remove('nb-spread');
  nb = null;
}

const spreading = () => !!nb && nb.art.classList.contains('spread');

// Size the pages to the window, recount them and put the open spread back in place.
export function refit() {
  if (!nb || !nb.art.isConnected) return;
  const on = MQ.matches;
  nb.art.classList.toggle('spread', on);
  document.body.classList.toggle('nb-spread', on);
  const { art, flow, strip } = nb;
  if (strip) on ? strip.parentNode === art && art.before(strip) : strip.parentNode !== art && art.querySelector('.nb-pages').after(strip);
  if (!on) { flow.removeAttribute('style'); return; }
  const W = Math.floor(nb.win.clientWidth);
  const top = stickyTop();
  // focus mode: the notebook is the whole screen, so the pages take its full height
  const cs = getComputedStyle(art);
  const H = document.body.classList.contains('focus-lesson')
    ? Math.max(PAD * 13, Math.floor((innerHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / PAD) * PAD)
    : Math.max(PAD * 13, Math.min(PAD * 36, Math.floor((innerHeight - top - nb.nav.offsetHeight - PAD * 2 - 22) / PAD) * PAD));
  if (W !== nb.W || H !== nb.H) {
    nb.W = W; nb.H = H;
    Object.assign(flow.style, { width: `${W}px`, height: `${H}px`, columnCount: '2', columnGap: `${GAP}px` });
    art.style.setProperty('--nb-h', `${H}px`);
  }
  const P = (W - GAP) / 2;
  nb.cols = Math.max(1, Math.floor((nb.end.getBoundingClientRect().left - flow.getBoundingClientRect().left + 2) / (P + GAP)) + 1);
  nb.n = Math.ceil(nb.cols / 2);
  place(Math.min(nb.k, nb.n - 1));
}

function stickyTop() {
  // in focus mode the notebook fills the screen from the top edge
  if (document.body.classList.contains('focus-lesson')) return 0;
  const bar = document.querySelector('.lesson-bar');
  return bar && bar.offsetParent ? bar.offsetHeight + 20 : 70;
}

function place(k) {
  nb.k = Math.max(0, k);
  pageOf.set(nb.id, nb.k);
  nb.flow.style.marginLeft = `${-nb.k * (nb.W + GAP)}px`;
  const a = nb.k * 2 + 1, b = Math.min(nb.cols, a + 1);
  nb.nav.querySelector('.nb-at').textContent = `${a === b ? a : `${a}–${b}`} of ${nb.cols}`;
  nb.nav.querySelector('[data-nb="-1"]').disabled = nb.k === 0;
  nb.nav.querySelector('[data-nb="1"]').disabled = nb.k >= nb.n - 1;
}

function spreadOf(el) {
  const P = (nb.W - GAP) / 2;
  const x = el.getBoundingClientRect().left - nb.flow.getBoundingClientRect().left;
  return Math.floor(Math.max(0, x + 4) / (P + GAP) / 2);
}

// Bring the whole notebook on screen (under the sticky timer bar) if part of it is hidden.
// Returns how long to wait before turning, so the page never scrolls and turns at the same time.
function inView() {
  if (document.body.classList.contains('focus-lesson')) return 0;
  const r = nb.art.getBoundingClientRect(), top = stickyTop();
  if (r.top < top - 4 || r.bottom + nb.nav.offsetHeight > innerHeight) { scrollBy({ top: r.top - top, behavior: 'smooth' }); return 380; }
  return 0;
}

function go(k, animate = true) {
  if (!nb) return;
  k = Math.max(0, Math.min(nb.n - 1, k));
  if (k === nb.k) return;
  const d = k - nb.k;
  if (animate && Math.abs(d) === 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) leaf(d);
  place(k);
}

// Turn one spread forward (1) or back (-1). False when the lesson isn't a notebook right now.
export function turn(d) {
  if (!spreading()) return false;
  refit();
  later(inView(), () => go(nb.k + d));
  return true;
}

let wait = 0;
function later(ms, fn) {
  clearTimeout(wait);
  if (!ms) return fn();
  const n = nb;
  wait = setTimeout(() => nb === n && fn(), ms);
}

// Open the notebook at the pages holding el. False when the lesson isn't a notebook right now.
export function show(el) {
  if (!spreading() || !nb.flow.contains(el)) return false;
  refit();
  later(inView(), () => go(spreadOf(el), true));
  return true;
}

// The page turn. A paper leaf hinged on the rings swings over the spine while the real pages
// underneath already show the new spread; a copy of the page being covered sits on its side
// until the leaf lands. The leaf is six hinged strips, so it curls as it lifts and flattens as
// it lands; each strip darkens as it turns away from the light, and the leaf casts a shadow on
// the page below it. The same animation can be dragged by the page's outer edge.
const STRIPS = 6, BEND = 7, FRAMES = 30;
// the gutter shadow by the rings, the same as the pages' in css/app.css
const GUTTER_L = 'linear-gradient(270deg, rgba(90, 60, 10, .26), rgba(90, 60, 10, .08) 14px, rgba(90, 60, 10, 0) 34px)';
const GUTTER_R = GUTTER_L.replace('270deg', '90deg');
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) * 0.85 + t * 0.15;

function leaf(d, drag = false) {
  finishTurn();
  const { k, flow, art, win } = nb;
  const ar = art.getBoundingClientRect(), wr = win.getBoundingClientRect();
  const half = ar.width / 2, shift = nb.W + GAP;
  // whole-pixel strips: each strip is its own 3D layer, and the compositor snaps layers to pixels
  const w = Math.floor(half / STRIPS), wOf = i => (i < STRIPS - 1 ? w : half - w * (STRIPS - 1)), at = i => i * w;
  const x0 = wr.left - ar.left, y0 = wr.top - ar.top;
  // the copy of the lesson with spread s's left (side 0) or right (side 1) page at a face's left edge
  const canvases = [...flow.querySelectorAll('canvas')];
  const fwd = d > 0;
  const face = (s, side, cut = 0, cls = '') => {
    const f = document.createElement('div');
    f.className = `nb-page nb-face ${cls}`;
    const c = flow.cloneNode(true);
    c.inert = true;
    c.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    c.querySelectorAll('canvas').forEach((cv, i) => { try { cv.getContext('2d')?.drawImage(canvases[i], 0, 0); } catch {} });
    // strips overlap their neighbour by a pixel so no seam shows; the paper and the gutter shadow
    // are a slice of the whole page's, so a strip looks exactly like the part of the page it covers
    const strip = cls === 'front' || cls === 'rear', lap = strip && !fwd ? 1 : 0;
    Object.assign(c.style, { marginLeft: `${x0 - s * shift - side * half - cut + lap}px`, marginTop: `${y0}px` });
    if (strip) {
      Object.assign(f.style, {
        left: `${-lap}px`, width: `calc(100% + 1px)`,
        backgroundImage: `${side ? GUTTER_R : GUTTER_L}, var(--paper)`, backgroundSize: `${half}px 100%`,
        backgroundPosition: `${lap - cut}px 0`, backgroundRepeat: 'no-repeat',
      });
    }
    f.append(c);
    const sh = document.createElement('i');
    sh.className = 'nb-shade';
    f.append(sh);
    return f;
  };
  const layer = document.createElement('div');
  layer.className = 'nb-turn';
  layer.setAttribute('aria-hidden', 'true');
  // forward: the right page lifts and lands on the left; back: the left page lands on the right
  layer.append(fwd ? face(k, 0, 0, 'left') : face(k, 1, 0, 'right'));
  const shadowUnder = document.createElement('i'), shadowOver = document.createElement('i');
  shadowUnder.className = `nb-cast ${fwd ? 'r' : 'l'}`;
  shadowOver.className = `nb-cast ${fwd ? 'l' : 'r'}`;
  layer.append(shadowUnder, shadowOver);
  const sheet = document.createElement('div');
  sheet.className = `nb-leaf ${fwd ? 'fwd' : 'back'}`;
  const strips = [];
  let parent = sheet;
  for (let i = 0; i < STRIPS; i++) {
    const st = document.createElement('div');
    st.className = 'nb-strip';
    st.style.width = `${wOf(i)}px`;
    // a strip i away from the spine shows that slice of the lifting page on its front and the
    // matching slice of the page coming into view on its back (mirrored by the 180° turn)
    const front = fwd ? face(k, 1, at(i), 'front') : face(k, 0, half - at(i) - wOf(i), 'front');
    const rear = fwd ? face(k + 1, 0, half - at(i) - wOf(i), 'rear') : face(k - 1, 1, at(i), 'rear');
    // the back turns about the strip's own middle (not the face's, which is a pixel wider)
    rear.style.transformOrigin = `${wOf(i) / 2 + (fwd ? 0 : 1)}px 50%`;
    st.append(front, rear);
    parent.append(st);
    strips.push({ st, front: front.lastChild, rear: rear.lastChild });
    parent = st;
  }
  layer.append(sheet);
  art.append(layer);

  const sg = fwd ? -1 : 1;
  const frames = Array.from({ length: FRAMES + 1 }, (_, n) => {
    const t = ease(n / FRAMES);
    return { th: 180 * t, bend: BEND * Math.sin(Math.PI * Math.pow(t, 0.8)) };
  });
  const opt = { duration: TURN_MS, easing: 'linear', fill: 'both' };
  const anims = [];
  anims.push(sheet.animate(frames.map(f => ({ transform: `rotateY(${sg * f.th}deg)` })), opt));
  strips.forEach(({ st, front, rear }, i) => {
    if (i) anims.push(st.animate(frames.map(f => ({ transform: `rotateY(${sg * f.bend}deg)` })), opt));
    const ang = f => Math.min(180, f.th + i * f.bend);
    anims.push(front.animate(frames.map(f => ({ opacity: 0.42 * Math.pow(Math.min(1, ang(f) / 90), 1.6) })), opt));
    anims.push(rear.animate(frames.map(f => ({ opacity: 0.42 * Math.pow(Math.max(0, Math.min(1, (180 - ang(f)) / 90)), 1.6) })), opt));
  });
  // the shadow the leaf throws: on the uncovered page while it lifts, on the covered one as it lands
  const rad = f => (f.th * Math.PI) / 180;
  anims.push(shadowUnder.animate(frames.map(f => ({ opacity: f.th < 90 ? Math.sin(rad(f)) * 0.9 : 0, transform: `scaleX(${Math.max(0.02, Math.cos(rad(f)))})` })), opt));
  anims.push(shadowOver.animate(frames.map(f => ({ opacity: f.th > 90 ? Math.sin(rad(f)) * 0.9 : 0, transform: `scaleX(${Math.max(0.02, -Math.cos(rad(f)))})` })), opt));
  nb.busy = { layer, anims, d };
  anims[0].onfinish = finishTurn;
  if (drag) anims.forEach(a => a.pause());
  else import('./sound.js').then(s => s.page?.()).catch(() => {});
  return nb.busy;
}

function finishTurn() {
  if (!nb?.busy) return;
  nb.busy.anims[0].onfinish = null;
  nb.busy.anims.forEach(a => a.cancel());
  nb.busy.layer.remove();
  nb.busy = null;
}

// Drag a page by its outer edge: the leaf follows the pointer; let go past a third of the way
// (or with a flick) and it lands, otherwise it falls back.
function edgeDrag(art) {
  const EDGE = 40;
  art.addEventListener('pointerdown', e => {
    if (!spreading() || e.button !== 0 || e.target.closest('button, a, input, textarea, select, .sim-card, .code, [contenteditable]')) return;
    const r = art.getBoundingClientRect();
    const d = e.clientX > r.right - EDGE ? 1 : e.clientX < r.left + EDGE ? -1 : 0;
    if (!d || nb.k + d < 0 || nb.k + d > nb.n - 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    e.preventDefault();
    const x0 = e.clientX, span = r.width * 0.9;
    let started = false, p = 0, last = { x: e.clientX, t: e.timeStamp }, v = 0;
    const move = ev => {
      const dx = (x0 - ev.clientX) * d;
      if (!started) {
        if (dx < 6) return;
        started = true;
        art.setPointerCapture?.(e.pointerId);
        const old = nb.k;
        leaf(d, true);
        place(old + d);
      }
      p = Math.max(0, Math.min(1, dx / span));
      v = ((last.x - ev.clientX) * d) / Math.max(1, ev.timeStamp - last.t);
      last = { x: ev.clientX, t: ev.timeStamp };
      nb.busy?.anims.forEach(a => (a.currentTime = p * TURN_MS));
    };
    const up = () => {
      art.removeEventListener('pointermove', move);
      art.removeEventListener('pointerup', up);
      art.removeEventListener('pointercancel', up);
      if (!started || !nb?.busy) return;
      const done = p > 0.33 || v > 0.5;
      const b = nb.busy;
      if (!done) { place(nb.k - d); b.anims[0].onfinish = null; }
      b.anims.forEach(a => { a.playbackRate = done ? 1 : -1; a.play(); });
      b.anims[0].onfinish = finishTurn;
      if (done) import('./sound.js').then(s => s.page?.()).catch(() => {});
    };
    art.addEventListener('pointermove', move);
    art.addEventListener('pointerup', up);
    art.addEventListener('pointercancel', up);
  });
}
