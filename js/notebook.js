// The lesson as an open notebook on wide screens. The lesson's sections flow into side-by-side
// pages (CSS columns in a fixed-height box, shifted a spread at a time) and a paper leaf swings
// over the spine on each turn. Below 1100px nothing changes: the lesson is one scrolling page.
// The open spread is kept per lesson, so a redraw (revealing an answer) stays on the same pages.
const MQ = matchMedia('(min-width: 1100px)');
const GAP = 76; // the gutter between pages; half of it is each page's outer margin
const PAD = 28; // paper above and below the text: one ruled line
const TURN_MS = 700;
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

// The page turn, after Apple Books: the page folds back along a line that travels from its outer
// edge to the spine. The part still flat stays put, the folded part shows the back of the page
// (the next page, as it will lie when it lands), a soft sheen runs along the fold, and the page
// throws a light shadow on the paper it uncovers and on the page it is about to cover. It is all
// flat moves (no 3D), so every copy lines up with the real pages to the pixel. The real pages
// underneath already show the new spread; a copy of the page being covered waits on its side.
const FRAMES = 32;
const ease = t => 0.6 * (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) + 0.4 * (1 - Math.pow(1 - t, 3));

function leaf(d, drag = false) {
  finishTurn();
  const { k, flow, art, win } = nb;
  const ar = art.getBoundingClientRect(), wr = win.getBoundingClientRect();
  const P = ar.width / 2, S = P, E = 2 * P, shift = nb.W + GAP;
  const x0 = wr.left - ar.left, y0 = wr.top - ar.top;
  const fwd = d > 0;
  const canvases = [...flow.querySelectorAll('canvas')];
  // a copy of spread s's left (side 0) or right (side 1) page, laid out as that page
  const page = (s, side) => {
    const f = document.createElement('div');
    f.className = `nb-page nb-face ${side ? 'right' : 'left'}`;
    const c = flow.cloneNode(true);
    c.inert = true;
    c.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    c.querySelectorAll('canvas').forEach((cv, i) => { try { cv.getContext('2d')?.drawImage(canvases[i], 0, 0); } catch {} });
    Object.assign(c.style, { marginLeft: `${x0 - s * shift - side * P}px`, marginTop: `${y0}px` });
    f.append(c);
    return f;
  };
  const el = (cls, ...kids) => { const e = document.createElement('div'); e.className = cls; e.append(...kids); return e; };
  const at = (e, w) => Object.assign(e.style, { left: '0', width: `${w}px` });

  const layer = el('nb-turn');
  layer.setAttribute('aria-hidden', 'true');
  const cover = page(k, fwd ? 0 : 1);
  Object.assign(cover.style, { left: `${fwd ? 0 : S}px`, width: `${P}px`, right: 'auto' });
  const frontPage = page(k, fwd ? 1 : 0);
  const front = el('nb-win2', frontPage);
  const frontShade = el(`nb-fshade ${fwd ? 'r' : 'l'}`);
  front.append(frontShade);
  const backPage = page(fwd ? k + 1 : k - 1, fwd ? 0 : 1);
  const backClip = el('nb-win2', backPage);
  const shine = el(`nb-shine ${fwd ? 'r' : 'l'}`);
  const flap = el('nb-win2 nb-flap', backClip, shine);
  const cast = el(`nb-cast2 ${fwd ? 'r' : 'l'}`), under = el(`nb-under ${fwd ? 'r' : 'l'}`);
  [front, backClip, flap].forEach(e => at(e, P));
  [frontPage, backPage].forEach(e => Object.assign(e.style, { left: '0', right: 'auto', width: `${P}px` }));
  at(cast, 90); at(under, 48);
  layer.append(cover, under, front, cast, flap);
  art.append(layer);

  // x is the fold line, from the outer edge to the spine
  const frames = Array.from({ length: FRAMES + 1 }, (_, n) => {
    const e = ease(n / FRAMES);
    return { x: fwd ? E - P * e : P * e, s: Math.sin(Math.PI * e) };
  });
  const tx = v => `translateX(${v.toFixed(2)}px)`;
  const opt = { duration: TURN_MS, easing: 'linear', fill: 'both' };
  const track = (e, f) => e.animate(frames.map(f), opt);
  const anims = fwd ? [
    track(front, f => ({ transform: tx(f.x - P) })),
    track(frontPage, f => ({ transform: tx(S + P - f.x) })),
    track(flap, f => ({ transform: tx(f.x - P) })),
    track(backClip, f => ({ transform: tx(f.x - S) })),
    track(cast, f => ({ transform: tx(f.x), opacity: f.s })),
    track(under, f => ({ transform: tx(2 * f.x - S - P - 48), opacity: f.s })),
  ] : [
    track(front, f => ({ transform: tx(f.x) })),
    track(frontPage, f => ({ transform: tx(-f.x) })),
    track(flap, f => ({ transform: tx(f.x) })),
    track(backClip, f => ({ transform: tx(f.x - P) })),
    track(cast, f => ({ transform: tx(f.x - 90), opacity: f.s })),
    track(under, f => ({ transform: tx(2 * f.x), opacity: f.s })),
  ];
  anims.push(track(shine, f => ({ opacity: f.s })), track(frontShade, f => ({ opacity: f.s })));
  nb.busy = { layer, anims, d };
  anims[0].onfinish = finishTurn;
  if (drag) anims.forEach(a => a.pause());
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
    };
    art.addEventListener('pointermove', move);
    art.addEventListener('pointerup', up);
    art.addEventListener('pointercancel', up);
  });
}
