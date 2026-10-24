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

// Roman numerals for step and section counters (the Clockwork look numbers things this way).
export const roman = n => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][n] || String(n);

// A lesson's steps as a row of thin bars with roman numerals: teal when done, brighter for the current one.
// With jump, each step is a button carrying data-jump="<step number>".
export function stepStrip(steps, done, { current = -1, jump = false, names = false } = {}) {
  const tag = jump ? 'button' : 'span';
  return `<nav class="step-strip" aria-label="Steps">${steps.map((s, i) => html`
    <${raw(tag)} class="${raw(done.has(i) ? 'on' : '')} ${raw(i === current ? 'cur' : '')}" ${raw(jump ? `data-jump="${i + 1}"` : '')}><i></i><span>${roman(i + 1)}${raw(names ? html`<em> · ${s}</em>` : '')}</span></${raw(tag)}>`).join('')}</nav>`;
}

// A small enamel subdial with a blued hand: value out of max over a 270° sweep.
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

// A brass stopwatch for the lesson timer. The lesson's steps sit around the dial as brass
// segments; elapsed time fills them with teal light; the hand sweeps the seconds.
export function stopwatch(steps, planned) {
  const R = 45, C2 = 2 * Math.PI * R;
  const arc = (from, to) => { const a = (from / planned) * 360, b = (to / planned) * 360; return { off: f2(C2 * (1 - a / 360) + C2 * 0.25), len: f2(Math.max(0, (b - a - 2.2) / 360) * C2) }; };
  const segs = steps.map((s, i) => { const { off, len } = arc(s.from, s.to); return `<circle class="sw-seg" data-seg="${i}" r="${R}" stroke-dasharray="${len} ${f2(C2)}" stroke-dashoffset="${off}"/>`; }).join('');
  const ticks = Array.from({ length: 60 }, (_, i) => `<line class="${i % 5 ? 'sw-t' : 'sw-t5'}" x1="0" y1="${i % 5 ? -37 : -35}" x2="0" y2="-40" transform="rotate(${i * 6})"/>`).join('');
  return `<svg class="stopwatch" viewBox="-60 -66 120 126" aria-hidden="true">
    <rect class="sw-crown" x="-6" y="-66" width="12" height="7" rx="1.5"/><rect class="sw-stem" x="-3" y="-60" width="6" height="5"/>
    <circle r="55" class="sw-bezel"/><circle r="50.5" class="sw-face"/>
    <circle r="${R}" class="sw-track"/>${segs}
    <circle r="${R}" class="sw-fill" stroke-dasharray="0 ${f2(C2)}" stroke-dashoffset="${f2(C2 * 0.25)}" data-fill/>
    ${ticks}
    <text class="sw-time" y="24" text-anchor="middle" data-clock>00:00</text>
    <g class="sw-hand" data-hand><line y1="9" y2="-38"/><circle cy="-38" r="1.6" class="sw-tip"/></g>
    <circle r="3.4" class="sw-hub"/>
  </svg>`;
}
const f2 = v => Math.round(v * 100) / 100;
