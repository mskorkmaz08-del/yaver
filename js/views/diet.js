import * as D from '../data.js';
import * as db from '../db.js';
import { html, raw, today, addDays, fmtDay } from '../util.js';
import { ring } from '../ui.js';
import { mealForm } from '../forms.js';
import { openAssistant } from '../ai/assistant.js';

let day = today();

export function render(root) {
  const d = D.dietDay(day);
  const g = d.goals;
  const macro = (label, v, goal, color) => html`
    <div class="macro"><div class="macro-top"><span>${label}</span><b>${Math.round(v)}g${raw(goal ? `<small> / ${goal}g</small>` : '')}</b></div>
    <div class="bt"><div class="bf" style="width:${raw(goal ? Math.min(100, (v / goal) * 100) : Math.min(100, v))}%;background:${raw(color)}"></div></div></div>`;
  const carbsGoal = Math.round((g.dailyCalories * 0.45) / 4);
  const fatGoal = Math.round((g.dailyCalories * 0.3) / 9);

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="eyebrow">Diet</p><h1>${fmtDay(day, { weekday: 'long', day: 'numeric', month: 'short' })}</h1></div>
      <button class="icon-btn accent" data-add aria-label="Log meal">＋</button>
    </header>
    <div class="month-switch"><button data-d="-1" aria-label="Previous day">‹</button><span>${day === today() ? 'Today' : day}</span><button data-d="1" ${raw(day === today() ? 'disabled' : '')} aria-label="Next day">›</button></div>

    <section class="card diet-top">
      ${raw(ring(d.calories, g.dailyCalories, { size: 128, stroke: 12, color: d.calories > g.dailyCalories ? 'var(--red)' : 'var(--green)', label: String(Math.round(d.calories)), sub: `of ${g.dailyCalories} kcal` }))}
      <div class="macros">
        ${raw(macro('Protein', d.protein, g.dailyProtein, 'var(--accent)'))}
        ${raw(macro('Carbs', d.carbs, carbsGoal, 'var(--amber)'))}
        ${raw(macro('Fat', d.fat, fatGoal, 'var(--pink)'))}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>Water</h3><span class="muted small">${d.water} / ${g.dailyWater} glasses</span></div>
      <div class="water">${raw(Array.from({ length: Math.max(g.dailyWater, d.water) }, (_, i) => `<button class="glass ${i < d.water ? 'full' : ''}" data-w="${i + 1}" aria-label="${i + 1} glasses"></button>`).join(''))}</div>
    </section>

    <div class="btn-row">
      <button class="btn ghost" data-snap>📷 Snap a meal</button>
      <button class="btn ghost" data-ai>✨ What should I eat?</button>
    </div>

    ${raw(D.MEAL_TYPES.map(type => {
      const items = d.meals.filter(m => m.meal === type);
      return html`<section class="list">
        <h4 class="list-day">${type} <span>${items.reduce((a, m) => a + m.calories, 0)} kcal</span></h4>
        ${raw(items.map(m => html`<button class="row" data-id="${m.id}"><span class="row-main"><b>${m.name}</b><small>P ${m.protein}g · C ${m.carbs}g · F ${m.fat}g</small></span><span class="row-amt">${m.calories}</span></button>`).join('') || `<button class="row add-row" data-type="${type}">+ Add ${type.toLowerCase()}</button>`)}
      </section>`;
    }).join(''))}`;

  root.querySelector('[data-add]').onclick = () => mealForm(null, day);
  root.querySelectorAll('[data-type]').forEach(b => (b.onclick = () => mealForm(null, day, { meal: b.dataset.type })));
  root.querySelectorAll('[data-id]').forEach(b => (b.onclick = () => mealForm(db.get('meals', b.dataset.id))));
  root.querySelectorAll('[data-d]').forEach(b => (b.onclick = () => { day = addDays(day, Number(b.dataset.d)); render(root); }));
  root.querySelectorAll('[data-w]').forEach(b => (b.onclick = () => {
    const n = Number(b.dataset.w);
    db.setSetting(`water:${day}`, d.water === n ? n - 1 : n);
  }));
  root.querySelector('[data-snap]').onclick = () => { openAssistant(); document.querySelector('[data-file]').click(); };
  root.querySelector('[data-ai]').onclick = () => openAssistant('Based on what I have eaten today and my goals, what should I eat for my next meal? Give 3 easy options with rough calories and protein.');
}
