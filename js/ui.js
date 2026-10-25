// Small reusable visual pieces (pure functions that return HTML strings).
import { html, raw, esc } from './util.js';

// Progress ring. value/goal, label in the middle.
export function ring(value, goal, { size = 92, stroke = 6, color = 'var(--accent)', label = '', sub = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = goal > 0 ? Math.min(1, value / goal) : 0;
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="var(--track)" stroke-width="${stroke}" fill="none"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${color}" stroke-width="${stroke}" fill="none" stroke-linecap="butt"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>
    <div class="ring-label"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
  </div>`;
}

// Horizontal bar list: [{label, value, display, color}]
export function barList(items, max = Math.max(1, ...items.map(i => i.value))) {
  if (!items.length) return '<p class="muted small">Nothing yet.</p>';
  return `<div class="barlist">${items.map(i => html`
    <div class="barrow">
      <span class="bl">${i.label}</span>
      <div class="bt"><div class="bf" style="width:${raw(((i.value / max) * 100).toFixed(1))}%;${raw(i.color ? `background:${i.color}` : '')}"></div></div>
      <span class="bv">${i.display ?? i.value}</span>
    </div>`).join('')}</div>`;
}

// Vertical column chart: [{label, value, highlight}]
export function columns(items, { color = 'var(--accent)', fmt = v => v } = {}) {
  const max = Math.max(1, ...items.map(i => i.value));
  return `<div class="cols">${items.map(i => html`
    <div class="col ${raw(i.highlight ? 'hl' : '')}" title="${fmt(i.value)}">
      <div class="cv">${i.value ? fmt(i.value) : ''}</div>
      <div class="cbar"><div style="height:${raw(((i.value / max) * 100).toFixed(1))}%"></div></div>
      <div class="cl">${i.label}</div>
    </div>`).join('')}</div>`;
}

export const empty = (text, hint = '') => html`<div class="empty"><p>${text}</p>${raw(hint ? html`<p class="small" style="margin-top:6px">try <code>${hint}</code></p>` : '')}</div>`;

// Roman numerals for step counters.
export const roman = n => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][n] || String(n);

// A lesson's steps as a rail of index marks with roman numerals: amber when done, lit for the current one.
// With jump, each step is a button carrying data-jump="<step number>".
export function stepStrip(steps, done, { current = -1, jump = false, names = false } = {}) {
  const tag = jump ? 'button' : 'span';
  return `<nav class="step-strip" aria-label="Steps">${steps.map((s, i) => html`
    <${raw(tag)} class="${raw(done.has(i) ? 'on' : '')} ${raw(i === current ? 'cur' : '')}" ${raw(jump ? `data-jump="${i + 1}"` : '')}><i></i><span>${roman(i + 1)}${raw(names ? html`<em> · ${s}</em>` : '')}</span></${raw(tag)}>`).join('')}</nav>`;
}

// A small chronograph subdial: value out of max over a 270° sweep, amber hand.
export function subdial(value, max, { size = 112, label = '' } = {}) {
  const c = 50, sweep = 270, start = -135;
  const top = Math.max(1, Math.ceil(max));
  const ang = v => (start + (Math.min(v, top) / top) * sweep) * Math.PI / 180;
  const pt = (v, r) => [c + r * Math.sin(ang(v)), c - r * Math.cos(ang(v))].map(n => n.toFixed(2));
  const step = top <= 20 ? 1 : Math.ceil(top / 20);
  const ticks = [];
  for (let v = 0; v <= top; v += step) {
    const major = v % (step * 5) === 0;
    const [x1, y1] = pt(v, major ? 36 : 39), [x2, y2] = pt(v, 43);
    ticks.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${major ? 1.1 : .6}"/>`);
    if (major) { const [tx, ty] = pt(v, 29); ticks.push(`<text x="${tx}" y="${ty}">${v}</text>`); }
  }
  return `<svg class="subdial" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${esc(label)} ${esc(String(value))} of ${top}">
    <circle cx="50" cy="50" r="49" class="sd-bezel"/><circle cx="50" cy="50" r="45.5" class="sd-face"/>
    <g class="sd-ticks">${ticks.join('')}</g>
    ${label ? `<text x="50" y="72" class="sd-label">${esc(label)}</text>` : ''}
    <line class="sd-hand" x1="50" y1="57" x2="50" y2="16" style="--a:${(start + (Math.min(value, top) / top) * sweep).toFixed(1)}deg"/>
    <circle cx="50" cy="50" r="2.6" class="sd-pin"/>
  </svg>`;
}

// The lesson timer as a hextech gauge (after the gauge from the show): a steel case, one hex
// window per lesson step that lights teal while you're in that step, teal glass below, a ring
// that fills gold with elapsed time, a brass gear at the centre and a white needle sweeping
// the seconds.
const gearPath = (n, r1, r2) => {
  const pts = [];
  for (let k = 0; k < n; k++) for (const [fr, r] of [[-0.5, r1], [-0.22, r1], [-0.13, r2], [0.13, r2], [0.22, r1]]) {
    const t = ((k + fr) / n) * Math.PI * 2;
    pts.push(`${f2(r * Math.cos(t))} ${f2(r * Math.sin(t))}`);
  }
  return `M${pts.join(' L')} Z`;
};
const hexAt = (x, y, r, rot = 0) => `M${Array.from({ length: 6 }, (_, i) => { const t = ((60 * i + 30 + rot) * Math.PI) / 180; return `${f2(x + r * 1.18 * Math.cos(t))} ${f2(y + r * 0.86 * Math.sin(t))}`; }).join(' L')} Z`;
export function stopwatch(steps, planned) {
  const R = 45, C2 = 2 * Math.PI * R;
  const n = Math.max(1, steps.length);
  // hex windows on an arc over the top half, one per step
  const span = Math.min(150, 26 * n), a0 = -90 - span / 2;
  const wins = steps.map((s, i) => {
    const a = ((a0 + (n === 1 ? span / 2 : (span * i) / (n - 1))) * Math.PI) / 180;
    const x = 32 * Math.cos(a), y = 32 * Math.sin(a);
    return `<g class="sw-seg" data-seg="${i}"><path class="sw-win" d="${hexAt(x, y, 6.2, ((a * 180) / Math.PI) + 90)}"/><line class="sw-mark" x1="${f2(x - 2.4 * Math.sin(a))}" y1="${f2(y + 2.4 * Math.cos(a))}" x2="${f2(x + 2.4 * Math.sin(a))}" y2="${f2(y - 2.4 * Math.cos(a))}"/></g>`;
  }).join('');
  return `<svg class="stopwatch" viewBox="-60 -66 120 126" aria-hidden="true">
    <rect class="sw-crown" x="-7" y="-66" width="14" height="7" rx="2"/><rect class="sw-stem" x="-3" y="-60" width="6" height="5"/>
    <circle r="55" class="sw-bezel"/><circle r="51.5" class="sw-case"/><circle r="49" class="sw-face"/>
    <path class="sw-glass" d="M-47 6 A47 47 0 0 0 47 6 L18 6 L0 24 L-18 6 Z"/>
    <circle r="${R}" class="sw-track"/>
    <circle r="${R}" class="sw-fill" stroke-dasharray="0 ${f2(C2)}" stroke-dashoffset="${f2(C2 * 0.25)}" data-fill/>
    ${wins}
    <path class="sw-plate" d="M0 -16 L16 0 L0 16 L-16 0 Z"/>
    <path class="sw-gear" d="${gearPath(12, 9, 11.4)}"/><circle r="6" class="sw-gear-in"/>
    <text class="sw-time" y="37" text-anchor="middle" data-clock>00:00</text>
    <g class="sw-hand" data-hand><path class="sw-needle" d="M-2.4 4 L0 -34 L2.4 4 Z"/><path class="sw-tip" d="M-1.4 -27 L0 -34 L1.4 -27 Z"/></g>
    <circle r="3.4" class="sw-hub"/>
  </svg>`;
}
const f2 = v => Math.round(v * 100) / 100;

// Çetele as the clock from the show's poster: an ivory face with a chapter ring of tall gold
// Roman numerals, a ring of segments (one per minimum: teal underway, gold when met), a green
// subdial holding the count, a bronze subdial turning, a gold hand pointing at how much of
// the day's minimums are done and a long hand sweeping once a minute.
const ROMAN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
function numeral(t, k) {
  // drawn as strokes, tall and narrow, standing on the inner ring and facing the centre
  const W = { I: 1.5, V: 3.6, X: 3.6 }, gap = 1.1, top = -56.5, bot = -46;
  const total = [...t].reduce((a, c) => a + W[c], 0) + gap * (t.length - 1);
  let x = -total / 2, d = '';
  for (const c of t) {
    const w = W[c];
    if (c === 'I') d += `M${f2(x + w / 2)} ${top}V${bot}`;
    if (c === 'V') d += `M${f2(x)} ${top}L${f2(x + w / 2)} ${bot}L${f2(x + w)} ${top}`;
    if (c === 'X') d += `M${f2(x)} ${top}L${f2(x + w)} ${bot}M${f2(x + w)} ${top}L${f2(x)} ${bot}`;
    x += w + gap;
  }
  return `<path d="${d}" transform="rotate(${k * 30})"/>`;
}
export function cetDial(rows, { done = rows.filter(r => r.met).length, label = 'minimums' } = {}) {
  const n = Math.max(1, rows.length), r = 39, C = 2 * Math.PI * r, gap = n > 1 ? 3.5 : 0, seg = C / n;
  const segs = rows.map((row, i) => {
    const f = row.met ? 1 : Math.max(0, Math.min(1, row.target ? row.progress / row.target : 0));
    const rot = -90 + (i * 360) / n + (gap / C) * 180;
    return `<circle class="cd-track" r="${r}" stroke-dasharray="${f2(seg - gap)} ${f2(C)}" transform="rotate(${f2(rot)})"/>`
      + (f ? `<circle class="cd-seg ${row.met ? 'met' : ''}" r="${r}" stroke-dasharray="${f2((seg - gap) * f)} ${f2(C)}" transform="rotate(${f2(rot)})"/>` : '');
  }).join('');
  let ticks = '';
  for (let k = 0; k < 60; k++) if (k % 5) ticks += `<line class="cd-t" y1="-44.6" y2="-42.8" transform="rotate(${k * 6})"/>`;
  const s = new Date().getSeconds();
  const frac = rows.length ? done / rows.length : 0;
  return `<svg class="cetdial" viewBox="-66 -66 132 132" role="img" aria-label="Çetele: ${done} of ${rows.length} ${esc(label)} met">
    <circle class="cd-bezel" r="63.5"/><circle class="cd-rim" r="60.5"/><circle class="cd-face" r="58.5"/>
    <circle class="cd-ring" r="57.2"/><circle class="cd-ring" r="45.6"/><circle class="cd-ring thin" r="44.4"/>
    <g class="cd-roman">${ROMAN.map(numeral).join('')}</g>${ticks}
    ${segs}
    <g transform="translate(15 -15)"><circle class="cd-sub-rim" r="15.5"/><circle class="cd-sub-face" r="13.6"/><circle class="cd-sub-ring" r="10.8"/>
      <text class="cd-num" y="2.4" text-anchor="middle">${done}<tspan class="cd-of">/${rows.length}</tspan></text>
      <text class="cd-sub" y="8.2" text-anchor="middle">${esc(label.toUpperCase())}</text></g>
    <g transform="translate(17 20)"><circle class="cd-bronze" r="10"/><circle class="cd-bronze-2" r="7"/><circle class="cd-bronze-3" r="3.6"/>
      <g class="cd-hand2"><line y1="1.5" y2="-8.4"/></g></g>
    <g class="cd-hour" transform="rotate(${f2(frac * 360)})"><path d="M-1.6 5 L-1.1 -12 Q-3.2 -15 0 -18.5 Q3.2 -15 1.1 -12 L1.6 5 Z"/><path d="M0 -18.5 L-.8 -26 L0 -28 L.8 -26 Z"/><circle class="cd-jewel" cy="-15" r="1.4"/></g>
    <g class="cd-hand" style="animation-delay:-${s}s"><path d="M-1.1 7 L-.6 -34 L0 -41 L.6 -34 L1.1 7 Z"/><circle cy="-22" r="1.8" class="cd-loop"/></g>
    <circle class="cd-cap" r="3.6"/><circle class="cd-jewel" r="1.6"/>
  </svg>`;
}

// A small arc gauge for readouts: fraction f (0..1) of a half circle, in a tone (lume, steel, ok, warn, over).
export function arc(f, tone = 'lume') {
  const L = 59.7;
  return `<svg class="arc ${tone}" viewBox="0 0 46 26" aria-hidden="true"><path class="arc-t" d="M4 23a19 19 0 0 1 38 0"/>${f > 0 ? `<path class="arc-v" d="M4 23a19 19 0 0 1 38 0" stroke-dasharray="${f2(L * Math.min(1, f))} ${L}"/>` : ''}</svg>`;
}
