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

// Habits (the çetele) as an activity ring: one segment per daily minimum, filling as it is
// done, accent when met, with the count in the middle. (M1 drew an Arcane poster clock here.)
export function cetDial(rows, { done = rows.filter(r => r.met).length, label = 'done' } = {}) {
  const n = Math.max(1, rows.length), r = 46, C = 2 * Math.PI * r, gap = n > 1 ? 7 : 0, seg = C / n;
  const segs = rows.map((row, i) => {
    const f = row.met ? 1 : Math.max(0, Math.min(1, row.target ? row.progress / row.target : 0));
    const rot = -90 + (i * 360) / n + (gap / C) * 180;
    return `<circle class="cd-track" r="${r}" stroke-dasharray="${f2(Math.max(0.1, seg - gap))} ${f2(C)}" transform="rotate(${f2(rot)})"/>`
      + (f ? `<circle class="cd-seg ${row.met ? 'met' : ''}" r="${r}" stroke-dasharray="${f2(Math.max(0.1, (seg - gap) * f))} ${f2(C)}" transform="rotate(${f2(rot)})"/>` : '');
  }).join('');
  return `<svg class="cetdial m3ring" viewBox="-60 -60 120 120" role="img" aria-label="Habits: ${done} of ${rows.length} ${esc(label)}">
    ${rows.length ? segs : `<circle class="cd-track" r="${r}"/>`}
    <text class="cd-num" y="6" text-anchor="middle">${done}<tspan class="cd-of">/${rows.length}</tspan></text>
    <text class="cd-sub" y="22" text-anchor="middle">${esc(label.toUpperCase())}</text>
  </svg>`;
}

// A small arc gauge for readouts: fraction f (0..1) of a half circle, in a tone (lume, steel, ok, warn, over).
export function arc(f, tone = 'lume') {
  const L = 59.7;
  return `<svg class="arc ${tone}" viewBox="0 0 46 26" aria-hidden="true"><path class="arc-t" d="M4 23a19 19 0 0 1 38 0"/>${f > 0 ? `<path class="arc-v" d="M4 23a19 19 0 0 1 38 0" stroke-dasharray="${f2(L * Math.min(1, f))} ${L}"/>` : ''}</svg>`;
}
