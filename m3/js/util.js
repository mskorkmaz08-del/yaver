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

// A short message at the top. opts: a duration in ms, or { ms, action: { label, run } } for an
// Undo-style button (undo beats "are you sure?": the change happens, and one tap takes it back).
let lastToast;
// Timers are stored as when they started (and when they were paused), so they survive the app
// being closed. Pausing keeps the time; resuming shifts the start by the paused gap.
export const elapsedMs = t => (t ? Math.max(0, (t.pausedAt ?? Date.now()) - t.start) : 0);
export const pauseTimer = t => (t && !t.pausedAt ? { ...t, pausedAt: Date.now() } : t);
export const resumeTimer = t => (t?.pausedAt ? { ...t, start: t.start + (Date.now() - t.pausedAt), pausedAt: null } : t);

export function toast(msg, opts = 2400) {
  const { ms = 2400, action } = typeof opts === 'number' ? { ms: opts } : opts;
  lastToast?.dismiss();
  const t = document.createElement('div');
  t.className = `toast${action ? ' has-act' : ''}`;
  t.setAttribute('role', 'status');
  t.append(Object.assign(document.createElement('span'), { textContent: msg }));
  const dismiss = () => { clearTimeout(timer); t.classList.remove('show'); setTimeout(() => t.remove(), 300); if (lastToast?.t === t) lastToast = null; };
  if (action) {
    const b = Object.assign(document.createElement('button'), { className: 'toast-act', textContent: action.label });
    b.onclick = () => { dismiss(); action.run(); };
    t.append(b);
  }
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  const timer = setTimeout(dismiss, action ? Math.max(ms, 5000) : ms);
  lastToast = { t, dismiss };
}

// A light tap you can feel. Android vibrates; on the iPhone, Safari plays its own haptic when a
// switch toggles, so a hidden switch is flicked. Kept for moments that matter: a count logged,
// a minimum met, something deleted. kind: 'tap' or 'success' (a double tap).
let hapticEl;
export function haptic(kind = 'tap') {
  if (navigator.vibrate) { navigator.vibrate(kind === 'success' ? [10, 60, 14] : 8); return; }
  if (!/iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) || !('ontouchend' in document)) return;
  if (!hapticEl) {
    hapticEl = document.createElement('label');
    hapticEl.dataset.haptic = '';
    hapticEl.setAttribute('aria-hidden', 'true');
    hapticEl.style.cssText = 'position:fixed;left:-200px;top:0;opacity:0;pointer-events:none';
    hapticEl.innerHTML = '<input type="checkbox" switch tabindex="-1">';
    document.body.append(hapticEl);
  }
  hapticEl.click();
  if (kind === 'success') setTimeout(() => hapticEl.click(), 110);
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
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } });
    dragToClose(wrap, () => close(null));
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

// Pull a bottom sheet down by its top edge to dismiss it, the way iOS sheets work.
export function dragToClose(wrap, close) {
  const el = wrap.querySelector('.sheet');
  if (!el || matchMedia('(min-width: 700px)').matches) return;
  let y0 = null, dy = 0, t0 = 0;
  el.addEventListener('pointerdown', e => {
    const r = el.getBoundingClientRect();
    if (e.clientY - r.top > 56 || e.target.closest('input, select, textarea, button')) return;
    y0 = e.clientY; dy = 0; t0 = Date.now();
    el.setPointerCapture?.(e.pointerId);
    el.style.transition = 'none';
  });
  el.addEventListener('pointermove', e => {
    if (y0 === null) return;
    dy = Math.max(0, e.clientY - y0);
    el.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (y0 === null) return;
    y0 = null;
    el.style.transition = '';
    const fast = dy / Math.max(1, Date.now() - t0) > 0.6;
    if (dy > 110 || (fast && dy > 30)) { el.style.transform = 'translateY(100%)'; close(); }
    else el.style.transform = '';
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
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
  s = s.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c.replace(/^[\w-]*\n/, '')}</code></pre>`);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/^#{1,4} (.*)$/gm, '<strong class="mdh">$1</strong>');
  s = s.replace(/^(?:[-*•] )(.*)$/gm, '<span class="li">$1</span>');
  s = s.replace(/^(\d+)\. (.*)$/gm, '<span class="li num" data-n="$1">$2</span>');
  return s.replace(/\n/g, '<br>').replace(/<\/span><br>/g, '</span>').replace(/<\/pre><br>/g, '</pre>');
}

// Fuller Markdown for lesson content: headings, paragraphs, lists, tables,
// code blocks with a language tag and a Copy button. Escapes first, like md().
export function mdDoc(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  const inline = s => esc(s)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const fence = /^```([\w-]*)\s*$/.exec(l);
    if (fence) {
      const buf = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) buf.push(lines[i]);
      i++;
      const lang = fence[1] || '';
      out.push(`<div class="code"><div class="code-bar"><span>${esc(lang.replace(/-snippet$/, ''))}</span><button class="copy" data-copy type="button">copy</button></div><pre><code>${esc(buf.join('\n'))}</code></pre></div>`);
      continue;
    }
    if (/^\s*$/.test(l)) { i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { out.push(`<h${Math.min(6, h[1].length + 2)} class="md-h">${inline(h[2])}</h${Math.min(6, h[1].length + 2)}>`); i++; continue; }
    if (/^\|.*\|\s*$/.test(l)) {
      const rows = [];
      for (; i < lines.length && /^\|.*\|\s*$/.test(lines[i]); i++) rows.push(lines[i]);
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const body = rows.filter(r => !/^\|[\s:|-]+\|\s*$/.test(r));
      const [head, ...rest] = body;
      out.push(`<div class="md-table"><table><thead><tr>${cells(head).map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rest.map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*•]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items = [];
      for (; i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i]); i++) {
        let item = lines[i].replace(/^\s*([-*•]|\d+\.)\s+/, '');
        while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*([-*•]|\d+\.)\s+/.test(lines[i + 1])) item += ' ' + lines[++i].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^>\s?/.test(l)) {
      const buf = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) buf.push(lines[i].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }
    const buf = [];
    for (; i < lines.length && !/^\s*$/.test(lines[i]) && !/^(```|#{1,4}\s|\||\s*([-*•]|\d+\.)\s|>)/.test(lines[i]); i++) buf.push(lines[i]);
    if (!buf.length) { out.push(`<p>${inline(l)}</p>`); i++; continue; }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return `<div class="md">${out.join('')}</div>`;
}

// One listener for every Copy button on code blocks.
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-copy]');
  if (!b) return;
  const code = b.closest('.code')?.querySelector('code')?.textContent || '';
  navigator.clipboard?.writeText(code).then(() => { b.textContent = 'copied'; setTimeout(() => (b.textContent = 'copy'), 1200); }, () => toast('Copy failed'));
});

// Save a text file: share sheet on the phone, download on a computer.
export async function saveFile(name, text, type = 'text/plain') {
  const file = new File([text], name, { type });
  if (matchMedia('(pointer:coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
