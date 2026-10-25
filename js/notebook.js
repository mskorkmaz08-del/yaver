// The lesson as an open notebook on wide screens. The lesson's sections flow into side-by-side
// pages (CSS columns in a fixed-height box, shifted a spread at a time) and a paper leaf swings
// over the spine on each turn. Below 1100px nothing changes: the lesson is one scrolling page.
// The open spread is kept per lesson, so a redraw (revealing an answer) stays on the same pages.
const MQ = matchMedia('(min-width: 1100px)');
const GAP = 76; // the gutter between pages; half of it is each page's outer margin
const PAD = 28; // paper above and below the text: one ruled line
const TURN_MS = 620;
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
function inView() {
  const r = nb.art.getBoundingClientRect(), top = stickyTop();
  if (r.top < top - 4 || r.bottom + nb.nav.offsetHeight > innerHeight) scrollBy({ top: r.top - top, behavior: 'smooth' });
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
  inView();
  go(nb.k + d);
  return true;
}

// Open the notebook at the pages holding el. False when the lesson isn't a notebook right now.
export function show(el) {
  if (!spreading() || !nb.flow.contains(el)) return false;
  refit();
  inView();
  go(spreadOf(el), true);
  return true;
}

// The page turn: a paper leaf carrying copies of the pages swings over the spine while the real
// pages underneath already show the new spread; a copy of the page being uncovered sits on top
// of it until the leaf lands.
function leaf(d) {
  finishTurn();
  const { W, k, flow, art } = nb;
  const half = (W + GAP) / 2, shift = W + GAP;
  const layer = document.createElement('div');
  layer.className = 'nb-turn';
  layer.setAttribute('aria-hidden', 'true');
  const face = (x, cls = '') => {
    const f = document.createElement('div');
    f.className = `nb-page nb-face ${cls}`;
    const c = flow.cloneNode(true);
    c.inert = true;
    c.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    c.style.marginLeft = `${x}px`;
    f.append(c);
    return f;
  };
  // forward: the right page lifts and lands on the left; back: the left page lands on the right
  const cover = d > 0 ? face(GAP / 2 - k * shift, 'left') : face(GAP / 2 - k * shift - half, 'right');
  const sheet = document.createElement('div');
  sheet.className = `nb-leaf ${d > 0 ? 'fwd' : 'back'}`;
  sheet.append(
    d > 0 ? face(GAP / 2 - k * shift - half, 'front') : face(GAP / 2 - k * shift, 'front'),
    d > 0 ? face(GAP / 2 - (k + 1) * shift, 'rear') : face(GAP / 2 - (k - 1) * shift - half, 'rear'),
  );
  layer.append(cover, sheet);
  art.append(layer);
  const anim = sheet.animate([{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${d > 0 ? -180 : 180}deg)` }], { duration: TURN_MS, easing: 'cubic-bezier(.45, .05, .3, 1)' });
  nb.busy = { layer, anim };
  anim.onfinish = finishTurn;
  import('./sound.js').then(s => s.page?.()).catch(() => {});
}

function finishTurn() {
  if (!nb?.busy) return;
  nb.busy.anim.onfinish = null;
  nb.busy.layer.remove();
  nb.busy = null;
}
