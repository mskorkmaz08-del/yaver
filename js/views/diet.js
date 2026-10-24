import * as D from '../data.js';
import * as db from '../db.js';
import { html, raw, today, addDays, fmtDay } from '../util.js';
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

    <section class="card">
      <div class="card-head"><p class="label">water</p><span class="small muted mono">${d.water}/${g.dailyWater}</span></div>
      <div class="water">${raw(Array.from({ length: Math.max(g.dailyWater, d.water) }, (_, i) => `<button class="glass ${i < d.water ? 'full' : ''}" data-w="${i + 1}" aria-label="${i + 1} glasses"></button>`).join(''))}</div>
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
        ${raw(items.map(m => html`<button class="row" data-id="${m.id}"><span class="row-main"><b>${m.name}</b><small class="mono">P${m.protein} C${m.carbs} F${m.fat}</small></span><span class="row-amt">${m.calories}</span></button>`).join('') || `<button class="row add-row" data-type="${type}">+ ${type.toLowerCase()}</button>`)}
      </section>`;
    }).join(''))}`;

  root.querySelector('[data-add]').onclick = () => mealForm(null, day);
  root.querySelectorAll('[data-type]').forEach(b => (b.onclick = () => mealForm(null, day, { meal: b.dataset.type })));
  root.querySelectorAll('[data-id]').forEach(b => (b.onclick = () => mealForm(db.get('meals', b.dataset.id))));
  root.querySelectorAll('[data-d]').forEach(b => (b.onclick = () => { day = addDays(day, Number(b.dataset.d)); render(root); }));
  root.querySelectorAll('[data-w]').forEach(b => (b.onclick = () => {
    const n = Number(b.dataset.w);
    D.setWater(d.water === n ? n - 1 : n, day);
  }));
  root.querySelector('[data-snap]').onclick = () => { openAssistant(); document.querySelector('[data-file]').click(); };
  root.querySelector('[data-ai]').onclick = () => openAssistant('Given what I ate today and my goals, suggest 3 simple options for my next meal with rough calories and protein.');
}
