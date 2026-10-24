import * as db from '../db.js';
import * as D from '../data.js';
import * as CT from '../cetele.js';
import { html, raw, money, mins, timeHM, today, fmtDay, dayKey, addDays, weekStart, toast } from '../util.js';
import { ring, stepStrip } from '../ui.js';
import * as C from '../course.js';
import { icon } from '../icons.js';
import { reminders } from '../reminders.js';
import { expenseForm, meetingForm, studyForm, mealForm, taskForm } from '../forms.js';
import { openAssistant } from '../ai/assistant.js';
import { hasKey as aiReady, saveKey } from '../ai/provider.js';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'İyi geceler' : h < 12 ? 'Günaydın' : h < 18 ? 'İyi günler' : 'İyi akşamlar';
}

// "Friday, the 23rd", as the Clockwork design writes the date.
export function longDate(d = new Date(), month = false) {
  const n = d.getDate();
  const th = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return `${d.toLocaleDateString('en-GB', { weekday: 'long' })}, the ${n}${th}${month ? ` of ${d.toLocaleDateString('en-GB', { month: 'long' })}` : ''}`;
}

const STEP_NAME = { warmup: 'Recall', example: 'Example', exit: 'Exit', teachnotes: 'Notes', reflect: 'Reflect' };
export const stepName = s => STEP_NAME[s.kind] || (s.kind ? s.kind[0].toUpperCase() + s.kind.slice(1) : s.title);

// The next course block as a printed lecture card: what, when, its steps, and a way in.
let lectureTarget = null;
function lecture() {
  lectureTarget = null;
  if (!C.ready() || !C.active()) return '';
  const nb = C.nextBlock();
  if (!nb) return '';
  const l = nb.lesson ? C.lesson(nb.lesson.id) : null;
  const target = l ? `lesson/${l.id}` : nb.type === 'review' || nb.type === 'plan' ? 'lesson/review' : nb.special === 'test' ? 'lesson/test' : nb.special === 'ship' ? 'lesson/ship' : null;
  const when = nb.date === today() ? nb.start : nb.date === addDays(today(), 1) ? `tomorrow · ${nb.start}` : `${fmtDay(nb.date)} · ${nb.start}`;
  lectureTarget = target;
  const p = l ? C.progress(l.id) || {} : {};
  const done = new Set(p.stepsDone || []);
  const steps = l?.steps || [];
  const cur = steps.findIndex((_, i) => !done.has(i));
  return html`
    <section class="paper lecture">
      <p class="label">${l ? 'lecture' : 'next'} <b>·</b> ${when}${l ? ` · ${l.track === 'mixed' ? 'mixed' : C.trackName(l.track)}` : ''}</p>
      <h2>${l ? l.title : C.slotTitle(nb)}</h2>
      ${raw(steps.length ? stepStrip(steps.map(stepName), done, { current: cur, names: true }) : '')}
      ${raw(target ? html`<button class="btn primary" data-go="${target}">${p.stepsDone?.length || p.status === 'in progress' ? 'Resume' : 'Begin'} <span class="arrow">→</span></button>` : '')}
    </section>`;
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

// Çetele as engraved tally marks: one stroke per minimum, faint dashes for the ones still open.
export function tally(done, total) {
  const n = Math.min(total, 10);
  return `<svg class="tally" viewBox="0 0 ${n * 9 + 4} 32" preserveAspectRatio="xMinYMid meet" aria-hidden="true">${Array.from({ length: n }, (_, i) =>
    `<path class="${i < done ? '' : 'off'}" d="M${6 + i * 9} 4 L${i < done ? 5.4 + i * 9 : 6 + i * 9} 28"/>`).join('')}</svg>`;
}

export function render(root, go) {
  const name = db.setting('userName', '');
  const hasKey = aiReady();
  const m = D.moneySummary();
  const s = D.studySummary();
  const d = D.dietDay();
  const upcoming = D.upcomingEvents(4);
  const tasks = D.openTasks().slice(0, 6);
  const lec = lecture();
  // Today lists only what the cards above don't already show (Çetele, the lecture, the next meeting).
  const notes = reminders().filter(n => n.kind !== 'cetele' && n.kind !== 'meeting' && !(lectureTarget && n.kind === 'course' && n.open === lectureTarget));
  const SHOW = 3;
  const ct = CT.day();
  const cs = CT.streak();
  const now = new Date();
  const course = C.ready() && C.active();
  const next = upcoming.find(e => new Date(e.end || e.start) > now);

  root.innerHTML = html`
    <header class="brand-head">
      <b class="brand">Yaver</b>
      <span class="brand-date" title="${greeting()}${name ? `, ${name}` : ''}">${longDate(now)}</span>
      <button class="icon-btn" data-go="settings" aria-label="Settings">${raw(icon('settings'))}</button>
    </header>

    ${raw(lec)}

    <section class="mv-hero">
      <div class="engine" data-engine></div>
      <div class="mv-stats">
        <button class="mv-stat" data-go="cetele">
          <p class="label">çetele</p>
          <p class="mv-v">${ct.done}<small> / ${ct.total}</small>${raw(tally(ct.done, ct.total))}</p>
          <p class="mv-s">${ct.rows.filter(r => !r.met).map(r => r.name).join(', ') || 'All minimums met'}</p>
        </button>
        <button class="mv-stat" data-go="study">
          <p class="label">study</p>
          <p class="mv-v">${(s.weekMin / 60).toFixed(1)}<small> / ${Math.round(s.dailyGoalMin * 7 / 60)} h</small></p>
          <div class="bar"><div style="width:${raw(Math.min(100, s.dailyGoalMin ? (s.weekMin / (s.dailyGoalMin * 7)) * 100 : 0))}%"></div></div>
          <p class="mv-s">this week · ${cs.current} day çetele streak</p>
        </button>
      </div>
      <div class="trio">
        <button data-go="${course ? 'lesson/review' : 'study'}"><p class="label">cards</p><b>${course ? C.dueCount() : '—'}</b></button>
        <button data-go="calendar"><p class="label">meeting</p><b>${next ? timeHM(next.start) : '—'}</b>${raw(next && dayKey(new Date(next.start)) !== today() ? html`<small>${fmtDay(dayKey(new Date(next.start)))}</small>` : '')}</button>
        <button data-go="money"><p class="label">spent</p><b>${m.today ? money(m.today) : '—'}</b></button>
      </div>
    </section>

    <button class="card" data-go="cetele">
      <div class="card-head"><p class="label">çetele</p><span class="small muted mono">${ct.done}/${ct.total} today · ${cs.current} day streak</span></div>
      <div class="bar"><div style="width:${raw(ct.total ? (ct.done / ct.total) * 100 : 0)}%"></div></div>
      <div class="ct-home">${raw(ct.rows.map(r => html`<span class="${r.met ? 'met' : ''}">${r.name}${CT.isCheck(r) ? '' : ` ${r.progress}/${r.target}`}</span>`).join(''))}</div>
    </button>

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
        ${raw(notes.map((n, i) => html`<${raw(n.open ? 'button' : 'div')} class="agenda-row ${raw(i >= SHOW ? 'more-row' : '')}" ${raw(n.open ? `data-open="${n.open}"` : '')}><span class="dot" style="background:${n.kind === 'money' ? 'var(--amber)' : n.kind === 'task' ? 'var(--red)' : n.kind === 'cetele' ? 'var(--violet)' : 'var(--accent)'}"></span><span class="what"><span>${n.text}</span></span></${raw(n.open ? 'button' : 'div')}>`).join(''))}
        ${raw(notes.length > SHOW ? html`<button class="link more-toggle" data-more>${notes.length - SHOW} more</button>` : '')}
      </section>` : '')}

    <div class="quick">
      <button data-q="study">${raw(icon('book'))}study</button>
      <button data-q="expense">${raw(icon('wallet'))}expense</button>
      <button data-q="meeting">${raw(icon('calendar'))}meeting</button>
      <button data-q="meal">${raw(icon('leaf'))}meal</button>
      <button data-go="map">${raw(icon('map'))}map</button>
    </div>

    <div class="tiles">
      <button class="tile" data-go="money">
        <p class="tile-k">${raw(icon('wallet'))}this month</p>
        <p class="tile-v">${money(m.month)}</p>
        ${raw(m.budget ? `<div class="bar ${m.month > m.budget ? 'over' : m.month / m.budget > .85 ? 'warn' : ''}"><div style="width:${Math.min(100, (m.month / m.budget) * 100)}%"></div></div>` : '')}
        <p class="tile-s">${m.budget ? `${money(Math.max(0, m.budgetLeft))} left of the budget` : `${money(m.today)} today`}</p>
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
    if (e.target.closest('[data-brief]')) openAssistant('Brief me: what needs my attention today (çetele minimums, meetings, study and roadmap, tasks, money, diet). Facts and next steps only.');
    else openAssistant();
  };
  root.querySelectorAll('[data-go]').forEach(b => (b.onclick = () => go(b.dataset.go)));
  root.querySelector('[data-more]')?.addEventListener('click', e => { e.target.closest('.card').classList.add('show-all'); e.target.remove(); });
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
