// Çetele: the daily spiritual minimums. Tap +/− or the check; long lists and
// targets are edited in a sheet. Past days can be filled in with the day switcher.
import * as db from '../db.js';
import * as CT from '../cetele.js';
import { html, raw, today, addDays, fmtDay, sheet, confirmSheet, haptic, toast } from '../util.js';
import { weekSegments } from './home.js';
import { icon } from '../icons.js';
import { openAssistant } from '../ai/assistant.js';

let day = today();

export function render(root) {
  const d = CT.day(day);
  const s = CT.streak();
  const pct = r => Math.min(100, (r.progress / Math.max(1, r.target)) * 100);

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="path">~/yaver <b>›</b> çetele</p><h1><span class="num ${raw(d.complete ? 'lit' : '')}">${d.done}/${d.total}</span> minimums</h1></div>
      <button class="icon-btn" data-edit aria-label="Edit list">${raw(icon('edit'))}</button>
    </header>
    <div class="switch"><button data-d="-1" aria-label="Previous day">${raw(icon('chevronLeft'))}</button><span>${fmtDay(day).toLowerCase()}</span><button data-d="1" ${raw(day === today() ? 'disabled' : '')} aria-label="Next day">${raw(icon('chevronRight'))}</button></div>

    <section class="card">
      <div class="card-head">
        <span class="tile-v ${raw(s.current && d.complete && day === today() ? 'lit' : '')}">${s.current}<small> day streak</small></span>
        <span class="small muted mono">best ${s.best}</span>
      </div>
      ${raw(weekSegments(s.perDay, 1))}
    </section>

    <section class="cetele">
      ${raw(d.rows.map(r => CT.isCheck(r) ? html`
        <div class="ct-row ${raw(r.met ? 'met' : '')}">
          <div class="ct-main"><b>${r.name}</b><small>${r.per === 'week' ? 'this week' : 'today'}</small></div>
          <button class="ct-check" data-toggle="${r.id}" aria-pressed="${r.met ? 'true' : 'false'}" aria-label="${r.name} done">${raw(icon('check'))}</button>
        </div>` : html`
        <div class="ct-row ${raw(r.met ? 'met' : '')}">
          <div class="ct-main">
            <b>${r.name}</b>
            <small class="mono">${r.progress} / ${r.target}${r.unit ? ' ' + r.unit : ''}${r.per === 'week' ? ' this week' : ''}</small>
            <div class="bar"><div style="width:${raw(pct(r))}%"></div></div>
          </div>
          <div class="ct-step">
            <button data-minus="${r.id}" aria-label="Less ${r.name}" ${raw(r.value ? '' : 'disabled')}>−</button>
            <button class="ct-num mono" data-set="${r.id}" aria-label="Type ${r.name}">${r.value}</button>
            <button data-plus="${r.id}" aria-label="More ${r.name}">+${r.step > 1 ? r.step : ''}</button>
          </div>
        </div>`).join('') || '<p class="small muted">No items yet. Tap the pencil to add your minimums.</p>')}
    </section>

    <div class="btn-row">
      <button class="btn ghost" data-add>${raw(icon('plus'))} Add an item</button>
      <button class="btn ghost" data-ai>${raw(icon('sparkle'))} Review my week</button>
    </div>`;

  const item = id => CT.items().find(i => i.id === id);
  root.querySelectorAll('[data-d]').forEach(b => (b.onclick = () => { day = addDays(day, Number(b.dataset.d)); render(root); }));
  root.querySelectorAll('[data-toggle]').forEach(b => (b.onclick = () => { haptic(); CT.setValue(b.dataset.toggle, CT.valueOn(b.dataset.toggle, day) ? 0 : 1, day); }));
  root.querySelectorAll('[data-plus]').forEach(b => (b.onclick = () => { haptic(); CT.add(b.dataset.plus, item(b.dataset.plus).step || 1, day); }));
  root.querySelectorAll('[data-minus]').forEach(b => (b.onclick = () => CT.add(b.dataset.minus, -(item(b.dataset.minus).step || 1), day)));
  root.querySelectorAll('[data-set]').forEach(b => (b.onclick = async () => {
    const it = item(b.dataset.set);
    const v = await sheet({ title: it.name, fields: [{ name: 'value', label: `${fmtDay(day)}${it.unit ? ` · ${it.unit}` : ''}`, type: 'number', value: CT.valueOn(it.id, day) }] });
    if (v && v.value !== null) CT.setValue(it.id, v.value, day);
  }));
  root.querySelector('[data-add]').onclick = () => itemForm();
  root.querySelector('[data-edit]').onclick = () => listSheet(root);
  root.querySelector('[data-ai]').onclick = () => openAssistant('Look at my çetele for this week: which minimums I kept and which slipped. Plain facts and one practical suggestion, no preaching.');
}

export async function itemForm(it = null) {
  const v = await sheet({
    title: it ? it.name : 'New çetele item',
    danger: it ? 'Remove' : undefined,
    fields: [
      { name: 'name', label: 'Name', value: it?.name || '', placeholder: 'Tesbihat, Risale, Evrad…', required: true },
      { name: 'target', label: 'Minimum', type: 'number', value: it?.target ?? 1 },
      { name: 'unit', label: 'Unit (leave empty for a simple done / not done)', value: it?.unit ?? '', placeholder: 'pages, times, parts…' },
      { name: 'per', label: 'Per', type: 'select', options: [['day', 'day'], ['week', 'week']], value: it?.per || 'day' },
      { name: 'step', label: 'The + button adds', type: 'number', value: it?.step ?? 1 },
    ],
  });
  if (!v) return;
  if (v.__danger) { if (await confirmSheet(`Remove ${it.name}?`, 'It leaves the list. Past days keep their record.', 'Remove')) await CT.archiveItem(it.id); return; }
  try { await CT.saveItem({ ...v, id: it?.id }); } catch (e) { toast(e.message); }
}

async function listSheet(root) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  const draw = () => {
    wrap.innerHTML = html`<div class="sheet" role="dialog" aria-label="Edit çetele">
      <div class="grabber"></div><h2>Edit çetele</h2>
      <div class="ct-edit">${raw(CT.items().map((it, i, a) => html`
        <div class="ct-edit-row"><button class="link" data-it="${it.id}"><b>${it.name}</b><small class="mono"> ${it.target}${it.unit ? ' ' + it.unit : ''} / ${it.per}</small></button>
        <span><button class="icon-btn" data-up="${it.id}" ${raw(i ? '' : 'disabled')} aria-label="Move up">↑</button><button class="icon-btn" data-down="${it.id}" ${raw(i < a.length - 1 ? '' : 'disabled')} aria-label="Move down">↓</button></span></div>`).join(''))}</div>
      <div class="sheet-actions"><button class="btn ghost" data-new>${raw(icon('plus'))} Add</button><button class="btn primary" data-done>Done</button></div></div>`;
    wrap.querySelectorAll('[data-it]').forEach(b => (b.onclick = async () => { await itemForm(db.get('ceteleItems', b.dataset.it)); draw(); }));
    wrap.querySelectorAll('[data-up]').forEach(b => (b.onclick = async () => { await CT.move(b.dataset.up, -1); draw(); }));
    wrap.querySelectorAll('[data-down]').forEach(b => (b.onclick = async () => { await CT.move(b.dataset.down, 1); draw(); }));
    wrap.querySelector('[data-new]').onclick = async () => { await itemForm(); draw(); };
    wrap.querySelector('[data-done]').onclick = close;
    wrap.querySelector('.sheet').classList.add('tall');
  };
  const close = () => { wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 250); render(root); };
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  draw();
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
}
