import * as db from '../db.js';
import * as D from '../data.js';
import { html, raw, money, mins, timeHM, today, fmtDay, dayKey, addDays, weekStart, toast } from '../util.js';
import { ring } from '../ui.js';
import { icon } from '../icons.js';
import { reminders } from '../reminders.js';
import { expenseForm, meetingForm, studyForm, mealForm, taskForm } from '../forms.js';
import { openAssistant } from '../ai/assistant.js';
import { hasKey as aiReady, saveKey } from '../ai/provider.js';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'İyi geceler' : h < 12 ? 'Günaydın' : h < 18 ? 'İyi günler' : 'İyi akşamlar';
}

export function weekSegments(perDay, goal) {
  const ws = weekStart();
  return `<div class="segs">${Array.from({ length: 7 }, (_, i) => {
    const k = addDays(ws, i);
    const v = perDay[k] || 0;
    const cls = v >= goal ? 'on' : v > 0 ? 'part' : '';
    return `<i class="${cls} ${k === today() ? 'today' : ''}">${'MTWTFSS'[i]}</i>`;
  }).join('')}</div>`;
}

export function render(root, go) {
  const name = db.setting('userName', '');
  const hasKey = aiReady();
  const m = D.moneySummary();
  const s = D.studySummary();
  const d = D.dietDay();
  const upcoming = D.upcomingEvents(4);
  const tasks = D.openTasks().slice(0, 6);
  const notes = reminders();
  const now = new Date();

  root.innerHTML = html`
    <header class="page-head">
      <div>
        <p class="path">~/yaver <b>›</b> ${now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).toLowerCase()}</p>
        <h1>${greeting()}${name ? `, ${name}` : ''}</h1>
      </div>
      <button class="icon-btn" data-go="settings" aria-label="Settings">${raw(icon('settings'))}</button>
    </header>

    ${raw(hasKey ? '' : html`
      <section class="setup">
        <h3>${raw(icon('key'))} Connect the AI</h3>
        <ol>
          <li>Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener"><b>aistudio.google.com/apikey</b></a> and sign in with Google.</li>
          <li>Tap <b>Create API key</b>, copy it, paste it here. Free, no card needed.</li>
        </ol>
        <div class="key-row"><input type="password" data-key placeholder="AIza… (Gemini) or sk-ant-… (Claude)" autocomplete="off"><button class="btn primary" data-save-key>Save</button></div>
        <p class="small muted">Stored only on this phone. A Claude key also works here if you have one.</p>
      </section>`)}

    <button class="ask" data-ask>
      <span class="mark sm">Y</span>
      <span class="ask-text"><b>Ask Yaver</b><small>${hasKey ? '"log 45 min of algorithms"  ·  "pharmacy near me"' : 'add your key above to start'}</small></span>
      <span class="ask-cta" data-brief>brief me</span>
    </button>

    ${raw(notes.length ? html`
      <section class="card">
        <p class="label">today</p>
        ${raw(notes.map(n => html`<${raw(n.open ? 'button' : 'div')} class="agenda-row" ${raw(n.open ? `data-open="${n.open}"` : '')}><span class="dot" style="background:${n.kind === 'money' ? 'var(--amber)' : n.kind === 'task' ? 'var(--red)' : 'var(--accent)'}"></span><span class="what"><span>${n.text}</span></span></${raw(n.open ? 'button' : 'div')}>`).join(''))}
      </section>` : '')}

    <div class="quick">
      <button data-q="study">${raw(icon('book'))}study</button>
      <button data-q="expense">${raw(icon('wallet'))}expense</button>
      <button data-q="meeting">${raw(icon('calendar'))}meeting</button>
      <button data-q="meal">${raw(icon('leaf'))}meal</button>
    </div>

    <button class="card" data-go="study">
      <div class="card-head"><p class="label">study</p><span class="small muted mono">${mins(s.todayMin)} / ${mins(s.dailyGoalMin)}</span></div>
      <div class="card-head">
        <span class="tile-v ${raw(s.streak.studiedToday ? 'lit' : '')}">${s.streak.current}<small> day streak</small></span>
        <span class="small muted mono">${mins(s.weekMin)} this week</span>
      </div>
      ${raw(weekSegments(s.streak.perDay, s.dailyGoalMin))}
    </button>

    <div class="tiles">
      <button class="tile" data-go="money">
        <p class="tile-k">${raw(icon('wallet'))}spent today</p>
        <p class="tile-v">${money(m.today)}</p>
        ${raw(m.budget ? `<div class="bar ${m.month > m.budget ? 'over' : m.month / m.budget > .85 ? 'warn' : ''}"><div style="width:${Math.min(100, (m.month / m.budget) * 100)}%"></div></div>` : '')}
        <p class="tile-s">${m.budget ? `${money(Math.max(0, m.budgetLeft))} left in month` : `${money(m.month)} this month`}</p>
      </button>
      <button class="tile" data-go="diet">
        <p class="tile-k">${raw(icon('leaf'))}diet</p>
        <div style="display:flex;align-items:center;gap:10px">
          ${raw(ring(d.calories, d.goals.dailyCalories, { size: 56, stroke: 5, label: String(Math.round(d.calories)), sub: 'kcal' }))}
          <p class="tile-s" style="margin:0">${Math.round(d.protein)}/${d.goals.dailyProtein}g protein</p>
        </div>
        <p class="tile-s">${Math.max(0, d.goals.dailyCalories - d.calories)} kcal left</p>
      </button>
    </div>

    <section class="card">
      <div class="card-head"><p class="label">up next</p><button class="link" data-go="calendar">calendar →</button></div>
      ${raw(upcoming.length ? upcoming.map(e => html`
        <button class="agenda-row" data-ev="${e.id}">
          <span class="when">${timeHM(e.start)}<small>${fmtDay(dayKey(new Date(e.start)))}</small></span>
          <span class="what"><b>${e.title}</b>${raw(e.location ? html`<small>${e.location}</small>` : '')}</span>
        </button>`).join('') : '<p class="small muted">Nothing scheduled.</p>')}
    </section>

    <section class="card">
      <div class="card-head"><p class="label">to-do</p><button class="link" data-add-task>+ add</button></div>
      ${raw(tasks.length ? tasks.map(t => html`
        <label class="task"><input type="checkbox" data-task="${t.id}"><span>${t.title}</span>${raw(t.due ? html`<small class="${t.due < today() ? 'overdue' : ''}">${fmtDay(t.due)}</small>` : '')}</label>`).join('') : '<p class="small muted">Empty.</p>')}
    </section>

    <section class="card">
      <div class="card-head"><p class="label">water</p><span class="small muted mono">${d.water}/${d.goals.dailyWater}</span></div>
      <div class="water">${raw(Array.from({ length: d.goals.dailyWater }, (_, i) => `<button class="glass ${i < d.water ? 'full' : ''}" data-w="${i + 1}" aria-label="${i + 1} glasses"></button>`).join(''))}</div>
    </section>
  `;

  root.querySelector('[data-ask]').onclick = e => {
    if (e.target.closest('[data-brief]')) openAssistant('Brief me: what needs my attention today (meetings, study and roadmap, tasks, money, diet). Facts and next steps only.');
    else openAssistant();
  };
  root.querySelectorAll('[data-go]').forEach(b => (b.onclick = () => go(b.dataset.go)));
  root.querySelectorAll('[data-open]').forEach(b => (b.onclick = () => go(b.dataset.open)));
  const q = { expense: () => expenseForm(), meeting: () => meetingForm(), study: () => studyForm(), meal: () => mealForm() };
  root.querySelectorAll('[data-q]').forEach(b => (b.onclick = q[b.dataset.q]));
  root.querySelectorAll('[data-ev]').forEach(b => (b.onclick = () => meetingForm(db.get('events', b.dataset.ev))));
  root.querySelector('[data-add-task]').onclick = taskForm;
  root.querySelectorAll('[data-w]').forEach(b => (b.onclick = () => { const n = Number(b.dataset.w); D.setWater(d.water === n ? n - 1 : n); }));
  root.querySelectorAll('[data-task]').forEach(cb => (cb.onchange = () => {
    const t = db.get('tasks', cb.dataset.task);
    cb.closest('.task').classList.add('done');
    setTimeout(() => db.put('tasks', { ...t, done: true, doneAt: new Date().toISOString() }), 350);
  }));
  root.querySelector('[data-save-key]')?.addEventListener('click', async () => {
    try { toast(await saveKey(root.querySelector('[data-key]').value)); } catch (e) { toast(e.message, 4000); }
  });
}
