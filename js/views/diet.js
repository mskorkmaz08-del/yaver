import * as D from '../data.js';
import * as db from '../db.js';
import { html, raw, today, addDays, fmtDay, shrinkImage, toast, haptic } from '../util.js';
import * as F from '../foodscan.js';
import { ring } from '../ui.js';
import { icon } from '../icons.js';
import { mealForm } from '../forms.js';
import { openAssistant } from '../ai/assistant.js';

let day = today();

export function render(root) {
  const d = D.dietDay(day);
  const g = d.goals;
  const macro = (label, v, goal, color) => html`
    <div><div class="macro-top"><span>${label}</span><b>${Math.round(v)}g<small> / ${goal}g</small></b></div>
    <div class="bar"><div style="width:${raw(goal ? Math.min(100, (v / goal) * 100) : 0)}%;background:${raw(color)}"></div></div></div>`;
  const carbsGoal = Math.round((g.dailyCalories * 0.45) / 4);
  const fatGoal = Math.round((g.dailyCalories * 0.3) / 9);

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="path">Yaver <b>·</b> diet</p><h1><span class="num">${Math.max(0, g.dailyCalories - Math.round(d.calories))}</span> kcal left</h1></div>
      <button class="icon-btn primary" data-add aria-label="Log meal">${raw(icon('plus'))}</button>
    </header>
    <div class="switch"><button data-d="-1" aria-label="Previous day">${raw(icon('chevronLeft'))}</button><span>${fmtDay(day).toLowerCase()}</span><button data-d="1" ${raw(day === today() ? 'disabled' : '')} aria-label="Next day">${raw(icon('chevronRight'))}</button></div>

    <section class="card diet-top">
      ${raw(ring(d.calories, g.dailyCalories, { size: 112, stroke: 7, color: d.calories > g.dailyCalories ? 'var(--red)' : 'var(--accent)', label: String(Math.round(d.calories)), sub: `/ ${g.dailyCalories}` }))}
      <div class="macros">
        ${raw(macro('Protein', d.protein, g.dailyProtein, 'var(--accent)'))}
        ${raw(macro('Carbs', d.carbs, carbsGoal, 'var(--blue)'))}
        ${raw(macro('Fat', d.fat, fatGoal, 'var(--amber)'))}
      </div>
    </section>

    <div class="btn-row">
      <button class="btn ghost" data-snap>${raw(icon('camera'))} Photo a meal</button>
      <button class="btn ghost" data-ai>${raw(icon('sparkle'))} What next?</button>
    </div>

    ${raw(D.MEAL_TYPES.map(type => {
      // Any spelling of the meal type counts (the assistant may write "lunch"); unknown types land in Snack.
      const kind = m => D.MEAL_TYPES.find(t => t.toLowerCase() === String(m.meal || '').trim().toLowerCase()) || 'Snack';
      const items = d.meals.filter(m => kind(m) === type);
      return html`<section class="list">
        <h4 class="list-day">${type} <span>${items.reduce((a, m) => a + m.calories, 0)} kcal</span></h4>
        ${raw(items.map(m => html`<button class="row" data-id="${m.id}"><span class="row-main"><b>${m.name}</b><small class="mono">P${m.protein} C${m.carbs} F${m.fat}${m.source === 'photo' ? ' · photo' : ''}</small></span><span class="row-amt">${m.calories}</span></button>`).join('') || `<button class="row add-row" data-type="${type}">+ ${type.toLowerCase()}</button>`)}
      </section>`;
    }).join(''))}

    ${raw(nutrients(d))}`;

  root.querySelector('[data-add]').onclick = () => mealForm(null, day);
  root.querySelectorAll('[data-type]').forEach(b => (b.onclick = () => mealForm(null, day, { meal: b.dataset.type })));
  root.querySelectorAll('[data-id]').forEach(b => (b.onclick = () => mealForm(db.get('meals', b.dataset.id))));
  root.querySelectorAll('[data-d]').forEach(b => (b.onclick = () => { day = addDays(day, Number(b.dataset.d)); render(root); }));
  root.querySelector('[data-snap]').onclick = () => pickPhoto(day);
  root.querySelector('[data-ai]').onclick = () => openAssistant('Given what I ate today and my goals, suggest 3 simple options for my next meal with rough calories and protein.');
}

// Fiber, sugar and sodium for the day, and vitamins and minerals from photo-logged meals.
function nutrients(d) {
  if (!d.fiber && !d.sugar && !d.sodium && !d.detailed) return '';
  const bar = (label, v, ref, unit, limit) => {
    const pct = ref ? (v / ref) * 100 : 0;
    return html`<div class="nut"><span>${label}</span><div class="bar"><div class="${raw(limit && pct > 100 ? 'over' : '')}" style="width:${raw(Math.min(100, pct).toFixed(1))}%"></div></div><b class="mono">${fmt(v)}${unit} <small>${Math.round(pct)}%</small></b></div>`;
  };
  const shown = F.MICROS.filter(([k]) => d.micros[k] > 0);
  return html`<section class="card nutrients">
    <div class="card-head"><p class="label">nutrients</p><span class="small muted">% of daily value</span></div>
    ${raw(bar('Fiber', d.fiber, F.DAILY.fiber, 'g'))}
    ${raw(bar('Sugar', d.sugar, F.DAILY.sugar, 'g', true))}
    ${raw(bar('Sodium', d.sodium, F.DAILY.sodium, 'mg', true))}
    ${raw(shown.map(([k, label, unit, ref]) => bar(label, d.micros[k], ref, unit, k === 'caffeine')).join(''))}
    ${raw(d.detailed ? html`<p class="small muted">Vitamins and minerals from ${d.detailed} photo-logged meal${d.detailed > 1 ? 's' : ''}. All estimates.</p>` : '')}
  </section>`;
}
const fmt = v => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString('en');

// ---------- Food photo: pick → (optional note) → Gemini estimate → check → log ----------
function pickPhoto(day) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try { photoSheet(await shrinkImage(file, 1024), day); } catch { toast('Could not open that photo.'); }
  };
  input.click();
}

export function photoSheet(image, day = today()) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  let result = null, items = [], busy = false, ctrl = null;
  const hour = new Date().getHours();
  let meal = hour < 11 ? 'Breakfast' : hour < 16 ? 'Lunch' : hour < 21 ? 'Dinner' : 'Snack';
  let note = '', dish = '';

  const close = () => { ctrl?.abort(); wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 250); };
  const draw = () => {
    const t = F.totals(items);
    wrap.innerHTML = html`<div class="sheet tall food-sheet" role="dialog" aria-label="Food photo">
      <div class="grabber"></div>
      <h2>${result ? 'Check and log' : 'Food photo'}</h2>
      <img class="food-img" src="${image.url}" alt="">
      ${raw(!result ? html`
        <label class="field"><span>Anything the photo doesn't show? (optional)</span><input name="note" value="${note}" placeholder="fried in butter, 2 sugars, ate half…" autocomplete="off"></label>
        <p class="small muted food-status">${busy ? 'Looking at your photo…' : 'Gemini estimates the weight of each item, then its nutrients.'}</p>
        <div class="sheet-actions"><button class="btn ghost" data-cancel>Cancel</button><button class="btn primary" data-go ${raw(busy ? 'disabled' : '')}>${busy ? 'Estimating…' : 'Estimate'}</button></div>` : html`
        <label class="field"><span>Name</span><input name="dish" value="${dish}"></label>
        <div class="food-items">
          ${raw(items.length ? items.map((it, i) => html`<div class="food-item">
            <span class="fi-name">${it.name}<small class="mono">${Math.round(it.calories)} kcal · P${Math.round(it.protein)}</small></span>
            <label class="fi-g"><input type="number" inputmode="decimal" min="0" data-g="${i}" value="${Math.round(it.grams)}"><span>g</span></label>
            <button class="icon-btn" data-x="${i}" aria-label="Remove ${it.name}">${raw(icon('close'))}</button>
          </div>`).join('') : '<p class="small muted">No food found in this photo.</p>')}
        </div>
        <div class="food-total">
          <b class="mono">${Math.round(t.calories)} kcal</b>
          <span class="mono">P ${Math.round(t.protein)}g · C ${Math.round(t.carbs)}g · F ${Math.round(t.fat)}g</span>
          <span class="mono small muted">Fiber ${fmt(t.fiber)}g · Sugar ${fmt(t.sugar)}g · Sodium ${Math.round(t.sodium)}mg</span>
          <span class="small muted">${F.MICROS.filter(([k]) => t[k] >= 0.05).map(([k, label, unit, ref]) => `${label} ${Math.round((t[k] / ref) * 100)}%`).join(' · ')}</span>
        </div>
        <p class="small muted">${result.confidence === 'low' ? 'Low confidence. ' : ''}${result.note || 'Change a weight if it looks off; everything else follows.'}</p>
        <label class="field"><span>Meal</span><select name="meal">${raw(D.MEAL_TYPES.map(m => `<option ${m === meal ? 'selected' : ''}>${m}</option>`).join(''))}</select></label>
        <div class="sheet-actions"><button class="btn ghost" data-again>Try again</button><button class="btn primary" data-log ${raw(items.length ? '' : 'disabled')}>Log ${Math.round(t.calories)} kcal</button></div>`)}
    </div>`;
    wrap.querySelector('[data-cancel]')?.addEventListener('click', close);
    const n = wrap.querySelector('[name=note]'); if (n) n.oninput = () => (note = n.value);
    const dn = wrap.querySelector('[name=dish]'); if (dn) dn.oninput = () => (dish = dn.value);
    const ms = wrap.querySelector('[name=meal]'); if (ms) ms.onchange = () => (meal = ms.value);
    wrap.querySelector('[data-go]')?.addEventListener('click', run);
    wrap.querySelector('[data-again]')?.addEventListener('click', () => { result = null; items = []; draw(); });
    wrap.querySelectorAll('[data-g]').forEach(inp => (inp.onchange = () => { const i = Number(inp.dataset.g); items[i] = F.scaleItem(result.items[i], Math.max(0, Number(inp.value) || 0)); setTimeout(draw); })); // redraw after the field's blur finishes
    wrap.querySelectorAll('[data-x]').forEach(b => (b.onclick = () => { items.splice(Number(b.dataset.x), 1); result.items.splice(Number(b.dataset.x), 1); draw(); }));
    wrap.querySelector('[data-log]')?.addEventListener('click', async () => {
      await D.logMeal(F.mealRow({ dish: dish.trim() || result.dish, items, meal, date: day, confidence: result.confidence }));
      haptic(); close();
      toast(`Logged ${Math.round(F.totals(items).calories)} kcal · ${Math.round(F.totals(items).protein)}g protein`);
    });
  };
  async function run() {
    busy = true; draw();
    ctrl = new AbortController();
    try {
      result = await F.scanFood(image, note, { signal: ctrl.signal });
      items = result.items.map(i => ({ ...i }));
      dish = result.dish;
      if (D.MEAL_TYPES.includes(result.meal)) meal = result.meal;
    } catch (e) {
      if (e.name === 'AbortError') return;
      toast(e.message, 5000);
    }
    busy = false;
    if (wrap.isConnected) draw();
  }
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  draw();
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
}
