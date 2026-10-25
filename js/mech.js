// Hextech mechanisms: the Yaver gear button with its hextech core, the gear pairs on page
// titles and the home header, the gear train behind the Çetele dial, the core on the Ask bar
// and the engine in an empty chat. Gears are flat brass and steel with no baked-in light, so
// they look right at every angle as they turn (v31); the core is a round, imperfect orb of
// hextech light like the show's hexcore. One drive shaft turns every gear on screen: it idles
// slowly, scrolling winds it, and every tap or save gives it a kick, so the UI behaves like
// one machine. Gears that touch mesh for real (teeth ratios and phases).

const SVGNS = 'http://www.w3.org/2000/svg';
const f = n => (Math.round(n * 100) / 100).toString();
const rad = d => (d * Math.PI) / 180;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Geometry ----------
// A gear outline with n trapezoid teeth on pitch radius rp, module m; a tooth is centred on angle 0.
// inward: teeth point to the centre (a ring gear's inside).
export function teeth(n, rp, m, inward = false) {
  const ro = inward ? rp - 0.9 * m : rp + 0.9 * m;
  const rr = inward ? rp + 1.1 * m : rp - 1.1 * m;
  const w = (2 * Math.PI) / n;
  const pts = [];
  for (let k = 0; k < n; k++) {
    // root, a curved flank (involute-like), a rounded tip, the other flank
    const rm = (rr + ro) / 2, rt = ro - 0.12 * m;
    for (const [fr, r] of [[-0.5, rr], [-0.31, rr], [-0.27, rr + 0.25 * (rm - rr)], [-0.22, rm], [-0.175, rt], [-0.13, ro], [0.13, ro], [0.175, rt], [0.22, rm], [0.27, rr + 0.25 * (rm - rr)], [0.31, rr]]) {
      const t = k * w + fr * w;
      pts.push(`${f(r * Math.cos(t))} ${f(r * Math.sin(t))}`);
    }
  }
  return `M${pts.join(' L')} Z`;
}
const ring = r => `M${f(r)} 0 A${f(r)} ${f(r)} 0 1 0 ${f(-r)} 0 A${f(r)} ${f(r)} 0 1 0 ${f(r)} 0 Z`;
// Angle of gear 2 so its teeth fall into gear 1's gaps. phi: direction from gear 1 to gear 2.
const meshExt = (n1, a1, n2, phi) => phi + 180 - 180 / n2 + (360 / n2) * ((phi - a1) / (360 / n1));
// Ring gear (internal teeth) driving a planet that sits in direction phi.
const meshInt = (nR, aR, nP, phi) => phi - (360 / nP) * (((phi - aR) / (360 / nR)) + 0.5);

// Flat metal: one colour per part, no gradients, so nothing lights up wrongly as a gear turns.
const BRASS = '#b88a44', BRASS_DK = '#7a5826', BRASS_LT = '#d9b46e', STEEL = '#8793a0', STEEL_DK = '#56616d', EDGE = '#1a1309';

const DEFS = `
  <radialGradient id="mx-glow"><stop offset="0" stop-color="#e9feff" stop-opacity=".95"/><stop offset=".25" stop-color="#7fe6f7" stop-opacity=".7"/><stop offset=".6" stop-color="#2aa6c4" stop-opacity=".22"/><stop offset="1" stop-color="#2aa6c4" stop-opacity="0"/></radialGradient>
  <radialGradient id="mx-orb" cx=".42" cy=".38" r=".68"><stop offset="0" stop-color="#f4feff"/><stop offset=".2" stop-color="#b4f4ff"/><stop offset=".5" stop-color="#4ccaf0"/><stop offset=".8" stop-color="#1b6fc2"/><stop offset="1" stop-color="#0b2c68"/></radialGradient>
  <radialGradient id="mx-core"><stop offset="0" stop-color="#ffffff" stop-opacity=".95"/><stop offset=".45" stop-color="#bff6ff" stop-opacity=".6"/><stop offset="1" stop-color="#5fd8ff" stop-opacity="0"/></radialGradient>
  <radialGradient id="mx-plate" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="#20262d"/><stop offset=".7" stop-color="#13171b"/><stop offset="1" stop-color="#0b0e11"/></radialGradient>`;

// The hextech core: a round, slightly irregular orb of blue light (like the show's hexcore),
// brighter at its heart, with energy swirling inside, fine fracture lines and a glint, held
// in a thin brass ring with four prongs. The orb never turns, so its light can stay fixed.
const blob = (r, k = 0) => {
  const pts = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const w = 1 + 0.045 * Math.sin(3 * a + 0.7 + k) + 0.03 * Math.sin(5 * a + 2.1 + k) + 0.02 * Math.sin(8 * a + 0.4);
    pts.push(`${f(r * w * Math.cos(a))} ${f(r * w * Math.sin(a))}`);
  }
  return `M${pts.join(' L')} Z`;
};
function gem(s, cls = '') {
  const R = s * 1.15;
  const P = (x, y) => `${f(x * R)} ${f(y * R)}`;
  // fracture lines: an imperfect crystal under the glow
  const cracks = [[[-0.62, -0.18], [-0.2, -0.32], [0.1, -0.7]], [[-0.2, -0.32], [0.05, 0.12], [0.6, 0.22]], [[0.05, 0.12], [-0.28, 0.55]], [[0.3, -0.45], [0.62, -0.2]]]
    .map(l => `M${l.map(([x, y]) => P(x, y)).join(' L')}`).join(' ');
  const swirl = [0, 120, 240].map(a => `<path d="M${P(0.12, -0.05)} C${P(0.5, -0.1)} ${P(0.62, 0.3)} ${P(0.34, 0.52)}" transform="rotate(${a})"/>`).join('');
  const prong = a => `<path d="M${P(-0.12, -1.02)} L${P(-0.07, -1.24)} L${P(0.07, -1.24)} L${P(0.12, -1.02)} Z" transform="rotate(${a})" fill="${BRASS}" stroke="${EDGE}" stroke-width="${f(R * 0.03)}"/>`;
  return `<g class="mx-gem ${cls}">
    <circle class="mx-halo" r="${f(R * 2.3)}" fill="url(#mx-glow)"/>
    <g class="mx-crystal">
      <path d="${blob(R)}" fill="url(#mx-orb)"/>
      <path class="mx-core" d="${blob(R * 0.42, 1.3)}" fill="url(#mx-core)"/>
      <g class="mx-swirl" fill="none" stroke="#e9feff" stroke-opacity=".7" stroke-width="${f(R * 0.06)}" stroke-linecap="round">${swirl}</g>
      <path d="${cracks}" fill="none" stroke="#e9feff" stroke-opacity=".32" stroke-width="${f(R * 0.03)}" stroke-linejoin="round"/>
      <path d="${blob(R)}" fill="none" stroke="#9feeff" stroke-opacity=".7" stroke-width="${f(R * 0.05)}"/>
      <ellipse class="mx-spark" cx="${f(-R * 0.36)}" cy="${f(-R * 0.4)}" rx="${f(R * 0.22)}" ry="${f(R * 0.12)}" transform="rotate(-38 ${f(-R * 0.36)} ${f(-R * 0.4)})" fill="#fff" opacity=".6"/>
    </g>
    <circle r="${f(R * 1.1)}" fill="none" stroke="${BRASS}" stroke-width="${f(R * 0.09)}"/>
    ${[45, 135, 225, 315].map(prong).join('')}
  </g>`;
}

// A spur gear in flat brass (or steel): rounded teeth, a recessed web with deco spokes, a hub
// boss with bolts and a hex bore. Every detail is a flat colour, so it reads cleanly at any angle.
function spur(n, rp, m, { spokes = 5, hub = 0.22, fill = BRASS, hollow = 0 } = {}) {
  const dark = fill === STEEL ? STEEL_DK : BRASS_DK;
  const rim = rp - 1.1 * m - Math.max(2, rp * 0.1);
  const sw = f(Math.max(0.4, rp * 0.022));
  const out = [`<path d="${teeth(n, rp, m)} ${ring(hollow || rim)}" fill-rule="evenodd" fill="${fill}" stroke="${EDGE}" stroke-width="${sw}" stroke-linejoin="round"/>`];
  if (!hollow) {
    out.push(`<circle r="${f(rim)}" fill="${dark}" fill-opacity=".55"/>`);
    for (let i = 0; i < spokes; i++) {
      const w = Math.max(1.4, rp * 0.085);
      out.push(`<path d="M${f(-w)} ${f(-rp * hub * 0.9)} L${f(-w * 0.6)} ${f(-rim - 0.3)} L${f(w * 0.6)} ${f(-rim - 0.3)} L${f(w)} ${f(-rp * hub * 0.9)} Z" fill="${fill}" stroke="${EDGE}" stroke-width="${sw}" stroke-linejoin="round" transform="rotate(${f((360 / spokes) * i)})"/>`);
    }
    out.push(`<circle r="${f(rp * hub)}" fill="${fill}" stroke="${EDGE}" stroke-width="${sw}"/>`);
    out.push(`<circle r="${f(rp * hub * 0.74)}" fill="none" stroke="${dark}" stroke-width="${f(rp * 0.025)}"/>`);
    if (rp > 7) for (let i = 0; i < spokes; i++) {
      const a = rad((360 / spokes) * (i + 0.5) - 90), d = rp * hub * 0.74;
      out.push(`<circle cx="${f(d * Math.cos(a))}" cy="${f(d * Math.sin(a))}" r="${f(Math.max(0.35, rp * 0.022))}" fill="${EDGE}"/>`);
    }
    out.push(`<path d="${hexPath(rp * hub * 0.42)}" fill="${EDGE}"/>`);
  }
  out.push(`<circle r="${f(rp - 1.1 * m - 0.5)}" fill="none" stroke="${dark}" stroke-width="${f(Math.max(0.4, rp * 0.03))}"/>`);
  return out.join('');
}
const hexPath = r => `M${Array.from({ length: 6 }, (_, i) => `${f(r * Math.cos(rad(60 * i + 30)))} ${f(r * Math.sin(rad(60 * i + 30)))}`).join(' L')} Z`;

// Small engraved marks for the rings: original geometric glyphs, not lettering.
function glyphs(r, count, size) {
  const shapes = [
    s => `M${-s} ${s} L0 ${-s} L${s} ${s}`,
    s => `M${-s} 0 L${s} 0 M0 ${-s} L0 ${s}`,
    s => `M${-s} ${-s} L${s} ${-s} L0 ${s} Z`,
    s => hexPath(s),
    s => `M${-s} ${s} L${-s} ${-s} L${s} ${-s}`,
    s => `M${-s} 0 A${s} ${s} 0 1 1 ${s} 0`,
  ];
  return Array.from({ length: count }, (_, i) => {
    const a = (360 / count) * i;
    return `<path d="${shapes[(i * 7) % shapes.length](size)}" transform="rotate(${f(a)}) translate(0 ${f(-r)})" fill="none" stroke="#f3dfa4" stroke-opacity=".55" stroke-width=".7" stroke-linecap="round"/>`;
  }).join('');
}

// ---------- The hextech engine ----------
// Planetary train inside a ring gear (60 internal teeth), three 12-tooth planets on a fixed carrier,
// a hollow 36-tooth sun around the gemstone in its gimbal, and side gears on the ring's
// outside teeth that crank two pistons. Ratios: planets 5x the ring, sun -5/3x, side gears -72/14x.
const E = { NR: 60, NRo: 72, NP: 12, NS: 36, NX: 14, R: 100, Ro: 116, P: 20, S: 60 };
E.m = (2 * E.R) / E.NR;
E.mo = (2 * E.Ro) / E.NRo;
E.X = (E.NX * E.mo) / 2;
E.cx = E.Ro + E.X; // side gear centre distance
const PLANETS = [90, 210, 330];
const SIDES = [158, 22];

export function engineSVG({ core = true } = {}) {
  const sunrays = Array.from({ length: 48 }, (_, i) => `<line x1="0" y1="${i % 2 ? -66 : -70}" x2="0" y2="-98" transform="rotate(${f(i * 7.5)})"/>`).join('');
  // Art-deco keys on the outer frame, left out where the side gears sit.
  const deco = Array.from({ length: 12 }, (_, i) => i * 30 + 15).filter(a => SIDES.every(sa => Math.abs(((a - (sa + 90) + 540) % 360) - 180) > 22)).map(a => `<path d="M-7 -126 L7 -126 L4 -134 L-4 -134 Z" transform="rotate(${a})" fill="${BRASS_LT}" stroke="#120d06" stroke-width=".5"/>`).join('');
  // Crank-slider pistons hang under each side gear; their glass windows charge as they compress.
  const sides = SIDES.map(a => {
    const x = E.cx * Math.cos(rad(a)), y = E.cx * Math.sin(rad(a));
    const cy = y + E.X + 26;
    return `<g class="mx-piston">
      <g class="mx-link"><line x1="0" y1="0" x2="0" y2="0" stroke="${BRASS}" stroke-width="4.5" stroke-linecap="round"/></g>
      <g class="mx-rod"><rect x="${f(x - 3)}" y="0" width="6" height="30" rx="1.5" fill="${STEEL}" stroke="#1b1f24" stroke-width=".5"/></g>
      <rect x="${f(x - 11)}" y="${f(cy)}" width="22" height="44" rx="2" fill="${STEEL}" stroke="#1b1f24" stroke-width=".7"/>
      <rect x="${f(x - 5)}" y="${f(cy + 7)}" width="10" height="30" rx="1" fill="#0c3a4c"/>
      <rect x="${f(x - 5)}" y="${f(cy + 7)}" width="10" height="30" rx="1" fill="#7fe6f7" class="mx-charge" opacity=".2"/>
      <rect x="${f(x - 13)}" y="${f(cy - 4)}" width="26" height="6" rx="1" fill="${BRASS}" stroke="#120d06" stroke-width=".5"/>
      <rect x="${f(x - 13)}" y="${f(cy + 42)}" width="26" height="6" rx="1" fill="${BRASS}" stroke="#120d06" stroke-width=".5"/>
      <g class="mx-side" transform="translate(${f(x)} ${f(y)})"><g class="mx-rot">${spur(E.NX, E.X, E.mo, { spokes: 4, hub: 0.3 })}<circle cx="${f(E.X * 0.55)}" cy="0" r="3.2" fill="${BRASS_LT}" stroke="#120d06" stroke-width=".5"/></g></g>
    </g>`;
  }).join('');
  const planets = PLANETS.map(a => {
    const o = E.R - E.P;
    return `<g transform="translate(${f(o * Math.cos(rad(a)))} ${f(o * Math.sin(rad(a)))})"><g class="mx-planet">${spur(E.NP, E.P, E.m, { spokes: 3, hub: 0.34 })}</g></g>`;
  }).join('');
  const carrier = PLANETS.map(a => `<path d="M-5 -20 L-7 -80 L7 -80 L5 -20 Z" transform="rotate(${a + 90})" fill="#161a1f" stroke="#6b5530" stroke-width=".7"/>`).join('');
  return `<svg class="mx-engine" viewBox="-172 -142 344 300" role="img" aria-label="A hextech engine turning">
    
    ${sides}
    <circle r="138" fill="none" stroke="#c9a25a" stroke-opacity=".35" stroke-width=".8"/>
    ${deco}
    <circle r="${E.Ro + 1.6 * E.mo}" fill="url(#mx-plate)" stroke="#3a424c" stroke-width="1"/>
    <g stroke="#d9b56c" stroke-opacity=".18" stroke-width=".6">${sunrays}</g>
    <g class="mx-ringA"><path d="${teeth(E.NRo, E.Ro, E.mo)} ${teeth(E.NR, E.R, E.m, true)}" fill-rule="evenodd" fill="${BRASS}" stroke="#120d06" stroke-width=".7"/>
      <circle r="${E.R + 6}" fill="none" stroke="#120d06" stroke-opacity=".6" stroke-width="1"/>
      <g class="mx-runes">${glyphs(E.R + 8.5, 24, 2.2)}</g></g>
    ${carrier}
    <circle r="16" fill="#161a1f" stroke="#6b5530" stroke-width=".8"/>
    ${planets}
    <g class="mx-sun">${spur(E.NS, E.S, E.m, { hollow: 42 })}<g>${glyphs(49, 12, 1.8)}</g></g>
    <circle r="40" fill="#07090b" opacity=".85"/>
    <circle r="40" fill="none" stroke="#3fb6c9" stroke-opacity=".25" stroke-width=".8"/>
    <g class="mx-arcs" stroke="#9ff0ff" stroke-width=".9" fill="none" stroke-linecap="round"></g>
    ${core ? `<g class="mx-gimbal">
      <ellipse class="mx-g1" rx="34" ry="34" fill="none" stroke="${BRASS}" stroke-width="3"/>
      <ellipse class="mx-g2" rx="27" ry="27" fill="none" stroke="${BRASS_LT}" stroke-width="2.4"/>
      ${gem(13)}
    </g>` : ''}
  </svg>`;
}

// The Yaver button: a chunky brass gear with the hextech crystal in its hub.
export function buttonGearSVG() {
  return `<svg class="mx-button" viewBox="-34 -34 68 68" aria-hidden="true">
    <g class="mx-bgear">${spur(12, 26, 3.4, { spokes: 6, hub: 0.42 })}</g>
    <circle r="11.5" fill="#06080a" stroke="#120d06" stroke-width=".6"/>
    ${gem(6.5)}
  </svg>`;
}

// A small gear for headings; pairs of these mesh where they sit together.
export function smallGearSVG(n = 10) {
  return `<svg class="mx-small" viewBox="-15 -15 30 30" aria-hidden="true"><g class="mx-sg">${spur(n, 11, 2, { spokes: 4, hub: 0.36 })}</g></svg>`;
}

// Two small gears meshing, for the rule under screen titles.
export function pairSVG() {
  return `<svg class="mx-pair" viewBox="-12 -12 44 24" aria-hidden="true"><g class="mx-pa">${spur(10, 8, 1.6, { spokes: 4, hub: 0.36 })}</g><g transform="translate(17.6 0)"><g class="mx-pb">${spur(12, 9.6, 1.6, { spokes: 4, hub: 0.36 })}</g></g></svg>`;
}

// The crystal alone, for the Ask bar.
export function gemSVG() {
  return `<svg class="mx-gemsvg" viewBox="-16 -20 32 40" aria-hidden="true">${gem(9)}</svg>`;
}

// Three gears meshing (24, 12 and 16 teeth), to sit half hidden behind the Çetele dial.
const TR = { m: 3, A: 24, B: 12, C: 16, phiB: -38, phiC: 62 };
export function trainSVG() {
  const ra = (TR.A * TR.m) / 2, rb = (TR.B * TR.m) / 2, rc = (TR.C * TR.m) / 2;
  const pb = [(ra + rb) * Math.cos(rad(TR.phiB)), (ra + rb) * Math.sin(rad(TR.phiB))];
  const pc = [pb[0] + (rb + rc) * Math.cos(rad(TR.phiC)), pb[1] + (rb + rc) * Math.sin(rad(TR.phiC))];
  return `<svg class="mx-train" viewBox="-44 -70 150 120" aria-hidden="true">
    <g class="mx-ta">${spur(TR.A, ra, TR.m, { spokes: 6, hub: 0.24 })}</g>
    <g transform="translate(${f(pb[0])} ${f(pb[1])})"><g class="mx-tb">${spur(TR.B, rb, TR.m, { spokes: 4, hub: 0.36, fill: STEEL })}</g></g>
    <g transform="translate(${f(pc[0])} ${f(pc[1])})"><g class="mx-tc">${spur(TR.C, rc, TR.m, { spokes: 5, hub: 0.3 })}</g></g>
  </svg>`;
}
function mountTrain(host) {
  host.innerHTML = trainSVG();
  const a = host.querySelector('.mx-ta'), b = host.querySelector('.mx-tb'), c = host.querySelector('.mx-tc');
  register(host, th => {
    const aa = th * 2.5;
    const ab = meshExt(TR.A, aa, TR.B, TR.phiB);
    rot(a, aa); rot(b, ab); rot(c, meshExt(TR.B, ab, TR.C, TR.phiC));
  });
}

// The crystal on the Ask bar breathes and floats; a tap makes it flare.
function mountGem(host) {
  host.innerHTML = gemSVG();
  const halo = host.querySelector('.mx-halo'), core = host.querySelector('.mx-core'), crystal = host.querySelector('.mx-crystal');
  register(host, (th, t, v) => {
    halo.setAttribute('transform', `scale(${f(0.8 + 0.12 * Math.sin(t * 2.2) + Math.min(0.4, v / 900))})`);
    core.setAttribute('opacity', f(Math.min(1, 0.55 + 0.25 * Math.sin(t * 3.1) + 0.12 * Math.sin(t * 11.7))));
    crystal.setAttribute('transform', `translate(0 ${f(Math.sin(t * 1.3) * 0.7)})`);
  });
}

// ---------- The drive shaft ----------
let theta = 0;      // ring angle, degrees
let vel = 0;        // extra speed from kicks and scrolling, deg/s
let last = 0, raf = 0;
const IDLE = 5;     // deg/s at rest
const parts = new Set();

export function kick(amount = 40) { if (!reduced()) { vel = Math.min(vel + amount, 520); wake(); } }

function wake() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

function frame(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  vel *= Math.pow(0.12, dt); // the kick bleeds off in about a second
  if (Math.abs(vel) < 0.05) vel = 0;
  theta += (IDLE + vel) * dt;
  for (const p of parts) {
    if (!p.el.isConnected) { parts.delete(p); continue; }
    if (p.visible === false) continue;
    p.update(theta, now / 1000, vel);
  }
  raf = parts.size && !document.hidden ? requestAnimationFrame(frame) : 0;
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

function register(el, update) {
  if (el._mech) return;
  const p = { el, update, visible: true };
  el._mech = p;
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { p.visible = e.isIntersecting; }).observe(el);
  parts.add(p);
  update(theta, performance.now() / 1000, 0);
  if (!reduced()) wake();
}

const rot = (el, a, x = 0, y = 0) => el && el.setAttribute('transform', `rotate(${f(a % 360)} ${f(x)} ${f(y)})`);

function mountEngine(host) {
  host.innerHTML = engineSVG({ core: host.dataset.core !== 'off' });
  const svg = host.firstElementChild;
  const ringA = svg.querySelector('.mx-ringA');
  const planets = [...svg.querySelectorAll('.mx-planet')];
  const sun = svg.querySelector('.mx-sun');
  const sides = [...svg.querySelectorAll('.mx-piston')].map((g, i) => {
    const a = SIDES[i];
    return { a, x: E.cx * Math.cos(rad(a)), y: E.cx * Math.sin(rad(a)), rot: g.querySelector('.mx-rot'), rod: g.querySelector('.mx-rod'), link: g.querySelector('.mx-link line'), charge: g.querySelector('.mx-charge') };
  });
  const g1 = svg.querySelector('.mx-g1'), g2 = svg.querySelector('.mx-g2');
  const gemEl = svg.querySelector('.mx-gem'), halo = svg.querySelector('.mx-halo'), core = svg.querySelector('.mx-core'), crystal = svg.querySelector('.mx-crystal');
  const arcs = svg.querySelector('.mx-arcs');
  let flare = 0;
  host.addEventListener('pointerdown', () => { kick(260); flare = 1; navigator.vibrate?.(8); onSpin?.(); });
  register(host, (th, t, v) => {
    const aR = th;
    rot(ringA, aR);
    PLANETS.forEach((phi, i) => rot(planets[i], meshInt(E.NR, aR, E.NP, phi)));
    // Sun phase from planet 0 (assembly condition makes the other two agree).
    const aP = meshInt(E.NR, aR, E.NP, PLANETS[0]);
    rot(sun, meshExt(E.NP, aP, E.NS, PLANETS[0] + 180) );
    for (const s of sides) {
      const aX = meshExt(E.NRo, aR, E.NX, s.a);
      rot(s.rot, aX);
      // Crank pin -> connecting rod (length L) -> piston sliding straight down.
      const pa = rad(aX), r = E.X * 0.55, L = 30;
      const pinX = s.x + r * Math.cos(pa), pinY = s.y + r * Math.sin(pa);
      const top = pinY + Math.sqrt(L * L - (pinX - s.x) ** 2);
      s.rod.setAttribute('transform', `translate(0 ${f(top)})`);
      s.link.setAttribute('x1', f(pinX)); s.link.setAttribute('y1', f(pinY));
      s.link.setAttribute('x2', f(s.x)); s.link.setAttribute('y2', f(top));
      s.charge.setAttribute('opacity', f(0.12 + 0.7 * Math.max(0, (top - s.y - 18) / (2 * r))));
    }
    if (g1) {
      // Gimbal rings tumble in 3D: an ellipse is a ring seen at an angle.
      g1.setAttribute('rx', f(34 * Math.abs(Math.cos(rad(th * 6)))) || '0.5');
      g1.setAttribute('transform', `rotate(${f(th * 2.2 % 360)})`);
      g2.setAttribute('ry', f(27 * Math.abs(Math.cos(rad(th * 4.4 + 40)))) || '0.5');
      g2.setAttribute('transform', `rotate(${f(-th * 3 % 360)})`);
      flare *= 0.94;
      const pulse = 0.82 + 0.12 * Math.sin(t * 2.4) + Math.min(0.5, v / 900) + flare * 0.6;
      halo.setAttribute('transform', `scale(${f(pulse)})`);
      gemEl.setAttribute('transform', `scale(${f(1 + flare * 0.15)})`);
      // the light inside breathes and shivers; the core floats a little in its ring
      core?.setAttribute('opacity', f(Math.min(1, 0.55 + 0.25 * Math.sin(t * 3.1) + 0.12 * Math.sin(t * 11.7) + flare * 0.5 + Math.min(0.3, v / 800))));
      crystal?.setAttribute('transform', `translate(0 ${f(Math.sin(t * 1.3) * 0.8)})`);
    }
    // Energy arcs flicker between the gem and the sun's inner rim, more when the engine runs fast.
    if (arcs && Math.random() < 0.18 + Math.min(0.6, v / 300) + flare) {
      const n = 1 + (Math.random() < 0.3 + flare ? 1 : 0);
      let d = '';
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        let x = 14 * Math.cos(a), y = 14 * Math.sin(a);
        d += `M${f(x)} ${f(y)}`;
        for (let j = 1; j <= 4; j++) {
          const rr = 14 + j * 6.5, aa = a + (Math.random() - 0.5) * 0.5;
          x = rr * Math.cos(aa); y = rr * Math.sin(aa);
          d += ` L${f(x)} ${f(y)}`;
        }
      }
      arcs.innerHTML = `<path d="${d}" opacity="${f(0.5 + Math.random() * 0.5)}"/>`;
    } else if (arcs && Math.random() < 0.5) arcs.innerHTML = '';
  });
}

function mountSimple(host, sel, ratio) {
  const g = host.querySelector(sel);
  register(host, th => rot(g, th * ratio + (Number(host.dataset.phase) || 0)));
}

// Gradients live once in the page (ids must be unique, and a hidden copy would blank the rest).
function defs() {
  if (document.getElementById('mx-defs')) return;
  const d = document.createElement('div');
  d.innerHTML = `<svg id="mx-defs" width="0" height="0" style="position:absolute;width:0;height:0" aria-hidden="true"><defs>${DEFS}</defs></svg>`;
  document.body.prepend(d.firstElementChild);
}

// Find and start every mechanism under root (call after a screen draws).
export function scan(root = document) {
  defs();
  root.querySelectorAll('[data-engine]').forEach(h => { if (!h._mech) mountEngine(h); });
  root.querySelectorAll('[data-train]').forEach(h => { if (!h._mech) mountTrain(h); });
  root.querySelectorAll('[data-gem]').forEach(h => { if (!h._mech) mountGem(h); });
  root.querySelectorAll('[data-gear]').forEach(h => {
    if (h._mech) return;
    if (h.dataset.gear === 'pair') {
      h.innerHTML = pairSVG();
      const a = h.querySelector('.mx-pa'), b = h.querySelector('.mx-pb');
      // 10 and 12 teeth, pitch radii 8 and 9.6: the second turns at -10/12 of the first.
      register(h, th => { const aa = th * 9; rot(a, aa); rot(b, meshExt(10, aa, 12, 0)); });
      return;
    }
    if (!h.firstElementChild) h.innerHTML = h.dataset.gear === 'button' ? buttonGearSVG() : smallGearSVG(Number(h.dataset.teeth) || 10);
    // The button gear: 12 teeth; small gears: 10. Turn rates chosen so neighbours look geared together.
    mountSimple(h, h.dataset.gear === 'button' ? '.mx-bgear' : '.mx-sg', Number(h.dataset.ratio) || (h.dataset.gear === 'button' ? -6 : 7));
  });
}

// Set by the app: what to play when the engine is tapped (keeps this file free of audio).
let onSpin = null;
export const onEngineTap = fn => { onSpin = fn; };

// Scrolling winds the shaft; taps and saves kick it.
let lastY = 0;
export function initDrive() {
  lastY = window.scrollY;
  addEventListener('scroll', () => {
    const dy = window.scrollY - lastY;
    lastY = window.scrollY;
    if (!reduced()) { vel = Math.max(-400, Math.min(520, vel + dy * 2.2)); wake(); }
  }, { passive: true });
  document.addEventListener('pointerdown', e => { if (e.target.closest('button, a, label, .chip')) kick(30); }, { capture: true, passive: true });
  document.addEventListener('submit', () => kick(160), true);
}
