import * as db from '../db.js';
import * as D from '../data.js';
import { html, raw, money, mins, timeHM, today, fmtDay, dayKey } from '../util.js';
import { ring } from '../ui.js';
import { expenseForm, meetingForm, studyForm, mealForm, taskForm } from '../forms.js';
import { openAssistant } from '../ai/assistant.js';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'İyi geceler' : h < 12 ? 'Günaydın' : h < 18 ? 'İyi günler' : 'İyi akşamlar';
}

export function render(root, go) {
  const name = db.setting('userName', '');
  const m = D.moneySummary();
  const s = D.studySummary();
  const d = D.dietDay();
  const upcoming = D.upcomingEvents(4);
  const tasks = D.openTasks().slice(0, 6);
  const now = new Date();

  root.innerHTML = html`
    <header class="page-head">
      <div>
        <p class="eyebrow">${now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1>${greeting()}${name ? `, ${name}` : ''}</h1>
      </div>
      <button class="icon-btn" data-go="settings" aria-label="Settings">⚙︎</button>
    </header>

    <button class="hero" data-ask>
      <span class="orb"></span>
      <span class="hero-text"><b>Ask Yaver</b><small>${db.setting('apiKey') ? 'Talk, type or snap a photo' : 'Add your Claude key in Settings to start'}</small></span>
      <span class="hero-cta" data-brief>Brief me</span>
    </button>

    <div class="quick">
      <button data-q="expense"><span>💸</span>Expense</button>
      <button data-q="meeting"><span>📅</span>Meeting</button>
      <button data-q="study"><span>📚</span>Study</button>
      <button data-q="meal"><span>🥗</span>Meal</button>
    </div>

    <div class="tiles">
      <button class="tile" data-go="money">
        <p class="tile-k">Spent today</p>
        <p class="tile-v">${money(m.today)}</p>
        <p class="tile-s">${m.budget ? `${money(Math.max(0, m.budgetLeft))} left this month` : `${money(m.month)} this month`}</p>
        ${raw(m.budget ? `<div class="mini-bar"><div style="width:${Math.min(100, (m.month / m.budget) * 100)}%"></div></div>` : '')}
      </button>
      <button class="tile" data-go="study">
        <p class="tile-k">Study streak</p>
        <p class="tile-v">${s.streak.current} <span class="flame ${raw(s.streak.studiedToday ? 'lit' : '')}">🔥</span></p>
        <p class="tile-s">${mins(s.todayMin)} today · goal ${mins(s.dailyGoalMin)}</p>
        <div class="mini-bar study"><div style="width:${raw(Math.min(100, (s.todayMin / (s.dailyGoalMin || 1)) * 100))}%"></div></div>
      </button>
      <button class="tile tile-ring" data-go="diet">
        ${raw(ring(d.calories, d.goals.dailyCalories, { size: 66, stroke: 7, color: 'var(--green)', label: String(Math.round(d.calories)), sub: 'kcal' }))}
        <div><p class="tile-k">Diet</p><p class="tile-s">${Math.max(0, d.goals.dailyCalories - d.calories)} kcal left<br>${Math.round(d.protein)}/${d.goals.dailyProtein}g protein</p></div>
      </button>
      <button class="tile" data-water>
        <p class="tile-k">Water</p>
        <p class="tile-v">${d.water}<small> / ${d.goals.dailyWater}</small></p>
        <p class="tile-s">Tap to add a glass 💧</p>
      </button>
    </div>

    <section class="card">
      <div class="card-head"><h3>Up next</h3><button class="link" data-go="calendar">Calendar</button></div>
      ${raw(upcoming.length ? upcoming.map(e => html`
        <button class="agenda-row" data-ev="${e.id}">
          <span class="when"><b>${timeHM(e.start)}</b><small>${fmtDay(dayKey(new Date(e.start)))}</small></span>
          <span class="what"><b>${e.title}</b>${raw(e.location ? html`<small>${e.location}</small>` : '')}</span>
        </button>`).join('') : '<p class="muted small">No upcoming meetings. Say “meeting with Ali tomorrow at 3” to Yaver.</p>')}
    </section>

    <section class="card">
      <div class="card-head"><h3>To-do</h3><button class="link" data-add-task>+ Add</button></div>
      ${raw(tasks.length ? tasks.map(t => html`
        <label class="task"><input type="checkbox" data-task="${t.id}"><span>${t.title}</span>${raw(t.due ? html`<small class="${t.due < today() ? 'overdue' : ''}">${fmtDay(t.due)}</small>` : '')}</label>`).join('') : '<p class="muted small">All clear.</p>')}
    </section>
  `;

  root.querySelector('[data-ask]').onclick = e => {
    if (e.target.closest('[data-brief]')) openAssistant('Brief me on my day: meetings, money, study, diet and tasks. Keep it short and end with one suggestion.');
    else openAssistant();
  };
  root.querySelectorAll('[data-go]').forEach(b => (b.onclick = () => go(b.dataset.go)));
  const q = { expense: () => expenseForm(), meeting: () => meetingForm(), study: () => studyForm(), meal: () => mealForm() };
  root.querySelectorAll('[data-q]').forEach(b => (b.onclick = q[b.dataset.q]));
  root.querySelectorAll('[data-ev]').forEach(b => (b.onclick = () => meetingForm(db.get('events', b.dataset.ev))));
  root.querySelector('[data-add-task]').onclick = taskForm;
  root.querySelector('[data-water]').onclick = () => db.setSetting(`water:${today()}`, d.water + 1);
  root.querySelectorAll('[data-task]').forEach(cb => (cb.onchange = () => {
    const t = db.get('tasks', cb.dataset.task);
    cb.closest('.task').classList.add('done');
    setTimeout(() => db.put('tasks', { ...t, done: true, doneAt: new Date().toISOString() }), 350);
  }));
}
