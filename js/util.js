import { setting } from './db.js';

// ---------- Dates (always local time; day keys look like "2026-10-14") ----------
const pad = n => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => dayKey();
export const parseDay = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (key, n) => { const d = parseDay(key); d.setDate(d.getDate() + n); return dayKey(d); };
export const monthKey = (key = today()) => key.slice(0, 7);
export const timeHM = iso => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const localInput = (d = new Date()) => `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function fmtDay(key, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (key === today()) return 'Today';
  if (key === addDays(today(), 1)) return 'Tomorrow';
  if (key === addDays(today(), -1)) return 'Yesterday';
  return parseDay(key).toLocaleDateString(undefined, opts);
}

export function weekStart(key = today()) {
  const d = parseDay(key);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return dayKey(d);
}

// ---------- Numbers ----------
export function money(n, currency = setting('currency', 'TRY')) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 }).format(n || 0);
  } catch {
    return `${(n || 0).toFixed(2)} ${currency}`;
  }
}
export const compact = n => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
export const mins = m => (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`);
export const sum = (arr, f = x => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);

// ---------- DOM ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function html(strings, ...vals) {
  // Tagged template: values are escaped unless wrapped with raw().
  return strings.reduce((out, s, i) => {
    const v = vals[i - 1];
    const str = v && v.__raw ? v.s : Array.isArray(v) ? v.map(x => (x && x.__raw ? x.s : esc(x))).join('') : esc(v);
    return out + str + s;
  });
}
export const raw = s => ({ __raw: true, s });

export function toast(msg, ms = 2400) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

export function haptic() {
  navigator.vibrate?.(8);
}

// Bottom sheet with a form. fields: [{name,label,type,value,options,step,placeholder,required}]
// Resolves with the form values, or null if dismissed.
export function sheet({ title, fields = [], submit = 'Save', danger, body }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = html`
      <div class="sheet" role="dialog" aria-label="${title}">
        <div class="grabber"></div>
        <h2>${title}</h2>
        ${raw(body || '')}
        <form>
          ${raw(fields.map(fieldHTML).join(''))}
          <div class="sheet-actions">
            ${danger ? raw(html`<button type="button" class="btn danger" data-danger>${danger}</button>`) : ''}
            <button type="button" class="btn ghost" data-cancel>Cancel</button>
            <button type="submit" class="btn primary">${submit}</button>
          </div>
        </form>
      </div>`;
    document.body.append(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    const close = val => {
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 250);
      resolve(val);
    };
    wrap.addEventListener('click', e => { if (e.target === wrap) close(null); });
    wrap.querySelector('[data-cancel]').onclick = () => close(null);
    const dz = wrap.querySelector('[data-danger]');
    if (dz) dz.onclick = () => close({ __danger: true });
    wrap.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const out = {};
      for (const f of fields) {
        let v = fd.get(f.name);
        if (f.type === 'number') v = v === '' ? null : Number(v);
        if (f.type === 'checkbox') v = fd.has(f.name);
        out[f.name] = v;
      }
      close(out);
    };
    const first = wrap.querySelector('input,select,textarea');
    if (first && fields[0]?.autofocus !== false) setTimeout(() => first.focus(), 300);
  });
}

function fieldHTML(f) {
  const v = f.value ?? '';
  let input;
  if (f.type === 'select') {
    input = html`<select name="${f.name}">${raw(f.options.map(o => {
      const [val, label] = Array.isArray(o) ? o : [o, o];
      return html`<option value="${val}" ${raw(String(val) === String(v) ? 'selected' : '')}>${label}</option>`;
    }).join(''))}</select>`;
  } else if (f.type === 'textarea') {
    input = html`<textarea name="${f.name}" rows="3" placeholder="${f.placeholder || ''}">${v}</textarea>`;
  } else if (f.type === 'checkbox') {
    input = html`<input type="checkbox" name="${f.name}" ${raw(v ? 'checked' : '')}>`;
  } else {
    input = html`<input name="${f.name}" type="${f.type || 'text'}" value="${v}" placeholder="${f.placeholder || ''}"
      ${raw(f.step ? `step="${f.step}"` : '')} ${raw(f.required ? 'required' : '')} ${raw(f.type === 'number' ? 'inputmode="decimal"' : '')}>`;
  }
  return html`<label class="field ${f.type === 'checkbox' ? 'check' : ''}"><span>${f.label}</span>${raw(input)}</label>`;
}

export function confirmSheet(title, message, okLabel = 'Delete') {
  return sheet({ title, body: html`<p class="muted">${message}</p>`, submit: okLabel }).then(Boolean);
}

// Resize a photo to keep Claude requests small and fast. Returns {media_type, data(base64), url}.
export async function shrinkImage(file, max = 1280) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  const dataUrl = c.toDataURL('image/jpeg', 0.82);
  return { media_type: 'image/jpeg', data: dataUrl.split(',')[1], url: dataUrl };
}

// Minimal, safe Markdown for chat replies: escape first, then format.
export function md(text) {
  let s = esc(text);
  s = s.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c.replace(/^\w*\n/, '')}</code></pre>`);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/^#{1,4} (.*)$/gm, '<strong class="mdh">$1</strong>');
  s = s.replace(/^(?:[-*•] )(.*)$/gm, '<span class="li">$1</span>');
  s = s.replace(/^(\d+)\. (.*)$/gm, '<span class="li num" data-n="$1">$2</span>');
  return s.replace(/\n/g, '<br>').replace(/<\/span><br>/g, '</span>').replace(/<\/pre><br>/g, '</pre>');
}
