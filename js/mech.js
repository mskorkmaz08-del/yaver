// Working mechanisms: the hextech engine on Home, the gear button, and the small
// gears beside page titles. One drive shaft turns every gear on screen: it idles
// slowly, scrolling winds it, and every tap or save gives it a kick, so the UI
// behaves like one machine. Gear pairs mesh for real (teeth ratios and phases).

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
    for (const [fr, r] of [[-0.5, rr], [-0.3, rr], [-0.17, ro], [0.17, ro], [0.3, rr]]) {
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

const DEFS = `
  <linearGradient id="mx-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6dfa0"/><stop offset=".45" stop-color="#c79a4a"/><stop offset="1" stop-color="#7a5622"/></linearGradient>
  <linearGradient id="mx-gold2" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#8d6a2e"/><stop offset=".5" stop-color="#d8b469"/><stop offset="1" stop-color="#fff0c4"/></linearGradient>
  <linearGradient id="mx-steel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9dde2"/><stop offset=".5" stop-color="#7f8790"/><stop offset="1" stop-color="#3a4048"/></linearGradient>
  <radialGradient id="mx-glow"><stop offset="0" stop-color="#e9feff" stop-opacity=".95"/><stop offset=".25" stop-color="#7fe6f7" stop-opacity=".7"/><stop offset=".6" stop-color="#2aa6c4" stop-opacity=".22"/><stop offset="1" stop-color="#2aa6c4" stop-opacity="0"/></radialGradient>
  <linearGradient id="mx-gemA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2feff"/><stop offset=".4" stop-color="#8eeaff"/><stop offset="1" stop-color="#2a9fd0"/></linearGradient>
  <linearGradient id="mx-gemB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7ee3ff"/><stop offset=".5" stop-color="#2f9fe0"/><stop offset="1" stop-color="#1557a8"/></linearGradient>
  <linearGradient id="mx-gemC" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a7fc8"/><stop offset="1" stop-color="#0b2f6b"/></linearGradient>
  <linearGradient id="mx-gemD" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f6bb8"/><stop offset="1" stop-color="#0a2457"/></linearGradient>
  <radialGradient id="mx-core"><stop offset="0" stop-color="#ffffff" stop-opacity=".95"/><stop offset=".45" stop-color="#bff6ff" stop-opacity=".6"/><stop offset="1" stop-color="#5fd8ff" stop-opacity="0"/></radialGradient>
  <radialGradient id="mx-plate" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="#2a241b"/><stop offset=".7" stop-color="#15120d"/><stop offset="1" stop-color="#0b0a08"/></radialGradient>`;

// The hextech gemstone: a tall six-sided crystal with pointed ends, its facets shaded from
// ice-white to deep sapphire, a living white-blue light inside, held by four brass claws.
function gem(s, cls = '') {
  const P = (x, y) => `${f(x * s)} ${f(y * s)}`;
  const W = 0.5, T = 1.45, B = 0.82, R = 0.1; // half width, tip height, shoulder height, ridge offset
  // Seen slightly turned: a left face, a broad front face and a narrow right face.
  const faces = [
    ['url(#mx-gemA)', [[-W, -B], [-0.18, -B - 0.06], [R - 0.05, T * -1], [-W, -B]]],
    ['url(#mx-gemB)', [[-0.18, -B - 0.06], [0.3, -B + 0.02], [R - 0.05, -T]]],
    ['url(#mx-gemC)', [[0.3, -B + 0.02], [W, -B], [R - 0.05, -T]]],
    ['url(#mx-gemA)', [[-W, -B], [-0.18, -B - 0.06], [-0.18, B + 0.06], [-W, B]]],
    ['url(#mx-gemB)', [[-0.18, -B - 0.06], [0.3, -B + 0.02], [0.3, B - 0.02], [-0.18, B + 0.06]]],
    ['url(#mx-gemC)', [[0.3, -B + 0.02], [W, -B], [W, B], [0.3, B - 0.02]]],
    ['url(#mx-gemC)', [[-W, B], [-0.18, B + 0.06], [R - 0.05, T]]],
    ['url(#mx-gemD)', [[-0.18, B + 0.06], [0.3, B - 0.02], [R - 0.05, T]]],
    ['url(#mx-gemA)', [[0.3, B - 0.02], [W, B], [R - 0.05, T]]],
  ].map(([fill, pts]) => `<path d="M${pts.map(([x, y]) => P(x, y)).join(' L')} Z" fill="${fill}"/>`).join('');
  const claw = (sx, sy) => `<path d="M${P(sx * 0.9, sy * 0.02)} Q${P(sx * 0.78, sy * 0.52)} ${P(sx * 0.44, sy * 0.74)} L${P(sx * 0.38, sy * 0.56)} Q${P(sx * 0.58, sy * 0.4)} ${P(sx * 0.62, sy * 0.02)} Z" fill="url(#mx-gold)" stroke="#2b1d0b" stroke-width="${f(s * 0.03)}"/>`;
  return `<g class="mx-gem ${cls}">
    <circle class="mx-halo" r="${f(s * 2.6)}" fill="url(#mx-glow)"/>
    <g class="mx-crystal">
      ${faces}
      <ellipse class="mx-core" rx="${f(s * 0.26)}" ry="${f(s * 0.62)}" cx="${f(s * 0.04)}" fill="url(#mx-core)"/>
      <path d="M${P(R - 0.05, -T)} L${P(-0.18, -B - 0.06)} L${P(-0.18, B + 0.06)} L${P(R - 0.05, T)} M${P(R - 0.05, -T)} L${P(0.3, -B + 0.02)} L${P(0.3, B - 0.02)} L${P(R - 0.05, T)}" fill="none" stroke="#e9fdff" stroke-opacity=".55" stroke-width="${f(s * 0.025)}"/>
      <path d="M${P(R - 0.05, -T)} L${P(-W, -B)} L${P(-W, B)} L${P(R - 0.05, T)} L${P(W, B)} L${P(W, -B)} Z" fill="none" stroke="#bdf6ff" stroke-width="${f(s * 0.035)}"/>
      <path class="mx-spark" d="M${P(-0.1, -1.05)} L${P(-0.02, -0.55)} L${P(-0.12, -0.5)} Z" fill="#fff" opacity=".85"/>
    </g>
    ${claw(-1, -1)}${claw(1, -1)}${claw(-1, 1)}${claw(1, 1)}
  </g>`;
}

// A spur gear with deco spokes and a bolted hub.
function spur(n, rp, m, { spokes = 5, hub = 0.22, fill = 'url(#mx-gold)', hollow = 0 } = {}) {
  const rim = rp - 1.1 * m - Math.max(2, rp * 0.1);
  const out = [`<path d="${teeth(n, rp, m)} ${ring(hollow || rim)}" fill-rule="evenodd" fill="${fill}" stroke="#2b1d0b" stroke-width=".6"/>`];
  if (!hollow) {
    for (let i = 0; i < spokes; i++) {
      const w = Math.max(1.6, rp * 0.09);
      out.push(`<path d="M${f(-w)} ${f(-rp * hub)} L${f(-w * 0.55)} ${f(-rim - 0.5)} L${f(w * 0.55)} ${f(-rim - 0.5)} L${f(w)} ${f(-rp * hub)} Z" fill="${fill}" stroke="#2b1d0b" stroke-width=".5" transform="rotate(${f((360 / spokes) * i)})"/>`);
    }
    out.push(`<circle r="${f(rp * hub)}" fill="url(#mx-gold2)" stroke="#2b1d0b" stroke-width=".6"/>`);
    out.push(`<path d="${hexPath(rp * hub * 0.45)}" fill="#1a140b" stroke="#f3dfa4" stroke-opacity=".5" stroke-width=".4"/>`);
  }
  out.push(`<circle r="${f(rp - 1.1 * m - 0.6)}" fill="none" stroke="#fff3c9" stroke-opacity=".28" stroke-width=".5"/>`);
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
  const deco = Array.from({ length: 12 }, (_, i) => i * 30 + 15).filter(a => SIDES.every(sa => Math.abs(((a - (sa + 90) + 540) % 360) - 180) > 22)).map(a => `<path d="M-7 -126 L7 -126 L4 -134 L-4 -134 Z" transform="rotate(${a})" fill="url(#mx-gold2)" stroke="#2b1d0b" stroke-width=".5"/>`).join('');
  // Crank-slider pistons hang under each side gear; their glass windows charge as they compress.
  const sides = SIDES.map(a => {
    const x = E.cx * Math.cos(rad(a)), y = E.cx * Math.sin(rad(a));
    const cy = y + E.X + 26;
    return `<g class="mx-piston">
      <g class="mx-link"><line x1="0" y1="0" x2="0" y2="0" stroke="url(#mx-gold)" stroke-width="4.5" stroke-linecap="round"/></g>
      <g class="mx-rod"><rect x="${f(x - 3)}" y="0" width="6" height="30" rx="1.5" fill="url(#mx-steel)" stroke="#1b1f24" stroke-width=".5"/></g>
      <rect x="${f(x - 11)}" y="${f(cy)}" width="22" height="44" rx="2" fill="url(#mx-steel)" stroke="#1b1f24" stroke-width=".7"/>
      <rect x="${f(x - 5)}" y="${f(cy + 7)}" width="10" height="30" rx="1" fill="#0c3a4c"/>
      <rect x="${f(x - 5)}" y="${f(cy + 7)}" width="10" height="30" rx="1" fill="#7fe6f7" class="mx-charge" opacity=".2"/>
      <rect x="${f(x - 13)}" y="${f(cy - 4)}" width="26" height="6" rx="1" fill="url(#mx-gold)" stroke="#2b1d0b" stroke-width=".5"/>
      <rect x="${f(x - 13)}" y="${f(cy + 42)}" width="26" height="6" rx="1" fill="url(#mx-gold)" stroke="#2b1d0b" stroke-width=".5"/>
      <g class="mx-side" transform="translate(${f(x)} ${f(y)})"><g class="mx-rot">${spur(E.NX, E.X, E.mo, { spokes: 4, hub: 0.3 })}<circle cx="${f(E.X * 0.55)}" cy="0" r="3.2" fill="url(#mx-gold2)" stroke="#2b1d0b" stroke-width=".5"/></g></g>
    </g>`;
  }).join('');
  const planets = PLANETS.map(a => {
    const o = E.R - E.P;
    return `<g transform="translate(${f(o * Math.cos(rad(a)))} ${f(o * Math.sin(rad(a)))})"><g class="mx-planet">${spur(E.NP, E.P, E.m, { spokes: 3, hub: 0.34 })}</g></g>`;
  }).join('');
  const carrier = PLANETS.map(a => `<path d="M-5 -20 L-7 -80 L7 -80 L5 -20 Z" transform="rotate(${a + 90})" fill="#211a10" stroke="#8a6a35" stroke-width=".7"/>`).join('');
  return `<svg class="mx-engine" viewBox="-172 -142 344 300" role="img" aria-label="A hextech engine turning">
    
    ${sides}
    <circle r="138" fill="none" stroke="#c9a25a" stroke-opacity=".35" stroke-width=".8"/>
    ${deco}
    <circle r="${E.Ro + 1.6 * E.mo}" fill="url(#mx-plate)" stroke="#5c4420" stroke-width="1"/>
    <g stroke="#d9b56c" stroke-opacity=".18" stroke-width=".6">${sunrays}</g>
    <g class="mx-ringA"><path d="${teeth(E.NRo, E.Ro, E.mo)} ${teeth(E.NR, E.R, E.m, true)}" fill-rule="evenodd" fill="url(#mx-gold)" stroke="#2b1d0b" stroke-width=".7"/>
      <circle r="${E.R + 6}" fill="none" stroke="#2b1d0b" stroke-opacity=".6" stroke-width="1"/>
      <g class="mx-runes">${glyphs(E.R + 8.5, 24, 2.2)}</g></g>
    ${carrier}
    <circle r="16" fill="#211a10" stroke="#8a6a35" stroke-width=".8"/>
    ${planets}
    <g class="mx-sun">${spur(E.NS, E.S, E.m, { hollow: 42 })}<g>${glyphs(49, 12, 1.8)}</g></g>
    <circle r="40" fill="#07090b" opacity=".85"/>
    <circle r="40" fill="none" stroke="#3fb6c9" stroke-opacity=".25" stroke-width=".8"/>
    <g class="mx-arcs" stroke="#9ff0ff" stroke-width=".9" fill="none" stroke-linecap="round"></g>
    ${core ? `<g class="mx-gimbal">
      <ellipse class="mx-g1" rx="34" ry="34" fill="none" stroke="url(#mx-gold)" stroke-width="3"/>
      <ellipse class="mx-g2" rx="27" ry="27" fill="none" stroke="url(#mx-gold2)" stroke-width="2.4"/>
      ${gem(13)}
    </g>` : ''}
  </svg>`;
}

// The Yaver button: a chunky gear (шестерёнка) with the gemstone in its hub.
export function buttonGearSVG() {
  return `<svg class="mx-button" viewBox="-34 -34 68 68" aria-hidden="true">
    <g class="mx-bgear">${spur(12, 26, 3.4, { spokes: 6, hub: 0.42 })}</g>
    <circle r="11.5" fill="#06080a" stroke="#2b1d0b" stroke-width=".6"/>
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
      // the light inside breathes and shivers; the crystal floats a little in its claws
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
