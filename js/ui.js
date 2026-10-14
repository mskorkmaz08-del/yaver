// Small reusable visual pieces (pure functions that return HTML strings).
import { html, raw, esc } from './util.js';

// Progress ring. value/goal, label in the middle.
export function ring(value, goal, { size = 92, stroke = 9, color = 'var(--accent)', label = '', sub = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = goal > 0 ? Math.min(1, value / goal) : 0;
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="var(--track)" stroke-width="${stroke}" fill="none"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${color}" stroke-width="${stroke}" fill="none" stroke-linecap="round"
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
      <div class="cbar"><div style="height:${raw(((i.value / max) * 100).toFixed(1))}%;background:${raw(color)}"></div></div>
      <div class="cl">${i.label}</div>
    </div>`).join('')}</div>`;
}

export const empty = (icon, text) => html`<div class="empty"><div class="empty-icon">${icon}</div><p>${text}</p></div>`;
