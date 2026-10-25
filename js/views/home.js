import * as db from '../db.js';
import * as D from '../data.js';
import * as CT from '../cetele.js';
import { html, raw, money, timeHM, today, fmtDay, dayKey, addDays, weekStart, toast, haptic } from '../util.js';
import { stepStrip, cetDial, arc } from '../ui.js';
import * as C from '../course.js';
import { icon } from '../icons.js';
import { reminders } from '../reminders.js';
import { expenseForm, meetingForm, studyForm, mealForm, taskForm } from '../forms.js';
import { openAssistant } from '../ai/assistant.js';
import { hasKey as aiReady, saveKey } from '../ai/provider.js';
import { openCommand, logCetele } from '../command.js';

const greeting = h => (h >= 4 && h < 12 ? 'Good morning' : h < 18 && h >= 12 ? 'Good afternoon' : 'Good evening');
// One line under the greeting: what's open today, in plain words.
function dayLine(ct, nextMeet, due) {
  const bits = [];
  const left = ct.rows.filter(r => !r.met && r.per !== 'week').length;
  bits.push(left ? `${left} minimum${left > 1 ? 's' : ''} open` : 'Minimums met');
  if (nextMeet && dayKey(new Date(nextMeet.start)) === today()) bits.push(`${nextMeet.title} at ${timeHM(nextMeet.start)}`);
  if (due) bits.push(`${due} card${due > 1 ? 's' : ''} to review`);
  return bits.join(' · ');
}

// The head line: weekday, date and a running clock, like the date window on a chronograph.
export const headDate = (d = new Date()) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '').toUpperCase();

const STEP_NAME = { warmup: 'Recall', example: 'Example', exit: 'Exit', teachnotes: 'Notes', reflect: 'Reflect' };
export const stepName = s => STEP_NAME[s.kind] || (s.kind ? s.kind[0].toUpperCase() + s.kind.slice(1) : s.title);

// The next course block: what, when, its steps, and a way in.
let nextTarget = null;
function nextPlate() {
  nextTarget = null;
  if (!C.ready() || !C.active()) return '';
  const nb = C.nextBlock();
  if (!nb) return '';
  const l = nb.lesson ? C.lesson(nb.lesson.id) : null;
  const target = l ? `lesson/${l.id}` : nb.type === 'review' || nb.type === 'plan' ? 'lesson/review' : nb.special === 'test' ? 'lesson/test' : nb.special === 'ship' ? 'lesson/ship' : null;
  const when = nb.date === today() ? nb.start : nb.date === addDays(today(), 1) ? `tomorrow ${nb.start}` : `${fmtDay(nb.date)} ${nb.start}`;
  nextTarget = target;
  const p = l ? C.progress(l.id) || {} : {};
  const done = new Set(p.stepsDone || []);
  const steps = l?.steps || [];
  const cur = steps.findIndex((_, i) => !done.has(i));
  return html`
    <section class="plate next">
      <span class="next-train" data-train aria-hidden="true"></span>
      <p class="meta"><b>Next · ${when}</b>${raw(l ? html`<span>${l.track === 'mixed' ? 'mixed' : C.trackName(l.track)} · ${l.minutes} min</span>` : '')}</p>
      <h2>${l ? l.title : C.slotTitle(nb)}</h2>
      ${raw(steps.length ? stepStrip(steps.map(stepName), done, { current: cur, names: true }) : '')}
      ${raw(target ? html`<div class="btn-row"><button class="btn primary" data-go="${target}">${p.stepsDone?.length || p.status === 'in progress' ? 'Resume' : 'Begin'} ${raw(icon('arrowRight'))}</button>${raw(l ? html`<button class="btn ghost" data-focus-lesson="${target}">${raw(icon('target'))} Focus</button>` : '')}</div>` : '')}
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

// Çetele: the dial, and each minimum as a line with its own small gauge.
export function ceteleMins(ct, { limit = 8 } = {}) {
  return ct.rows.slice(0, limit).map(r => {
    const f = r.met ? 1 : r.target ? Math.min(1, r.progress / r.target) : 0;
    return html`<div class="m ${raw(r.met ? 'met' : '')}" style="--w:${raw((f * 100).toFixed(1))}%"><span>${r.name}</span><span>${CT.isCheck(r) ? (r.met ? 'done' : 'open') : `${r.progress}/${r.target}${r.per === 'week' ? ' wk' : ''}`}</span><i></i></div>`;
  }).join('');
}

export function render(root, go) {
  const hasKey = aiReady();
  const m = D.moneySummary();
  const s = D.studySummary();
  const d = D.dietDay();
  const upcoming = D.upcomingEvents(4);
  const tasks = D.openTasks().slice(0, 6);
  const nx = nextPlate();
  // Today lists only what the plates above don't already show (Çetele, the next lesson, the next meeting).
  const notes = reminders().filter(n => n.kind !== 'cetele' && n.kind !== 'meeting' && !(nextTarget && n.kind === 'course' && n.open === nextTarget));
  const SHOW = 3;
  const ct = CT.day();
  const cs = CT.streak();
  const now = new Date();
  const course = C.ready() && C.active();
  const next = upcoming.find(e => new Date(e.end || e.start) > now);
  const weekGoalH = Math.round(s.dailyGoalMin * 7 / 60);
  const due = course ? C.dueCount() : 0;

  // Morning is for the minimums, the rest of the day for the next lesson: whichever matters now
  // comes first.
  const hour = now.getHours();
  const ctFirst = hour >= 4 && hour < 11 && !ct.complete;
  const open = ct.rows.filter(r => !r.met).slice(0, 4);
  const ctPlate = html`
    <section class="ct-wrap">
      <button class="plate ct-plate" data-go="cetele">
        <span class="ct-train" data-train aria-hidden="true"></span>
        ${raw(cetDial(ct.rows.filter(r => r.per !== 'week')))}
        <div class="mins">
          <div class="mins-h"><b>Çetele</b><span class="eyebrow">${cs.current} day streak</span></div>
          ${raw(ceteleMins(ct))}
        </div>
      </button>
      ${raw(open.length ? html`<div class="ct-quick" aria-label="Log a minimum">${raw(open.map(r => html`<button class="chip" data-log="${r.id}">${raw(CT.isCheck(r) ? icon('check') : '')}${r.name}${raw(CT.isCheck(r) ? '' : html`<b>+${Number(r.step) || 1}</b>`)}</button>`).join(''))}</div>` : '')}
    </section>`;

  root.innerHTML = html`
    <header class="home-head">
      <span class="head-pair" data-gear="pair" aria-hidden="true"></span>
      <b class="wordmark">Yaver</b>
      <button class="icon-btn" data-go="settings" aria-label="Settings">${raw(icon('settings'))}</button>
    </header>
    <header class="hello">
      <p class="clock" data-clock><i class="tick"></i>${headDate(now)} · <span data-hm>${timeHM(now)}</span></p>
      <h1>${greeting(hour)}${db.setting('userName', '') ? `, ${db.setting('userName', '')}` : ''}</h1>
      <p class="hello-sub">${dayLine(ct, next, due)}</p>
    </header>

    ${raw(ctFirst ? ctPlate + nx : nx + ctPlate)}

    <div class="gauges">
      <button class="plate g" data-go="study"><span class="eyebrow">Study</span>${raw(arc(weekGoalH ? s.weekMin / 60 / weekGoalH : 0, 'lume'))}<strong>${(s.weekMin / 60).toFixed(1)}<small>h</small></strong><small>of ${weekGoalH} h this week</small></button>
      <button class="plate g" data-go="${course ? 'lesson/review' : 'study'}"><span class="eyebrow">Cards</span>${raw(arc(course ? Math.min(1, due / 30) : 0, due ? 'steel' : 'ok'))}<strong>${course ? due : '—'}</strong><small>${course ? (due ? 'due for review' : 'all reviewed') : 'course off'}</small></button>
      <button class="plate g" data-go="money"><span class="eyebrow">Spent</span>${raw(arc(m.budget ? m.month / m.budget : 0, m.budget && m.month > m.budget ? 'over' : m.budget && m.month / m.budget > .85 ? 'warn' : 'steel'))}<strong>${money(m.today)}</strong><small>${m.budget ? `${money(Math.max(0, m.budgetLeft))} left this month` : `${money(m.month)} this month`}</small></button>
      <button class="plate g" data-go="diet"><span class="eyebrow">Diet</span>${raw(arc(d.goals.dailyCalories ? d.calories / d.goals.dailyCalories : 0, d.calories > d.goals.dailyCalories ? 'over' : 'ok'))}<strong>${Math.round(d.calories)}<small>kcal</small></strong><small>${Math.round(d.protein)}/${d.goals.dailyProtein} g protein</small></button>
    </div>

    ${raw(hasKey ? '' : html`
      <section class="plate setup">
        <h3>${raw(icon('key'))} Connect the AI</h3>
        <ol>
          <li>Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener"><b>aistudio.google.com/apikey</b></a> and sign in with Google.</li>
          <li>Tap <b>Create API key</b>, copy it, paste it here. Free, no card needed.</li>
        </ol>
        <div class="key-row"><input type="password" data-key placeholder="AIza… (Gemini) or sk-ant-… (Claude)" autocomplete="off"><button class="btn primary" data-save-key>Save</button></div>
        <p class="small muted">Stored only on this device. A Claude key also works here if you have one.</p>
      </section>`)}

    <div class="plate ask" data-ask role="button" tabindex="0">
      <span class="ask-gem" data-gem aria-hidden="true"></span>
      <span class="ask-text"><b>Ask Yaver…</b><small>${hasKey ? '"log 45 min of algorithms" · "pharmacy near me"' : 'add your key above to start'}</small></span>
      <button class="ask-cta" data-brief>Brief me</button>
    </div>

    ${raw(notes.length ? html`
      <section class="plate card">
        <p class="eyebrow">Today</p>
        ${raw(notes.map((n, i) => html`<${raw(n.open ? 'button' : 'div')} class="agenda-row ${raw(i >= SHOW ? 'more-row' : '')}" ${raw(n.open ? `data-open="${n.open}"` : '')}><span class="dot" data-k="${n.kind}"></span><span class="what"><span>${n.text}</span></span></${raw(n.open ? 'button' : 'div')}>`).join(''))}
        ${raw(notes.length > SHOW ? html`<button class="link more-toggle" data-more>${notes.length - SHOW} more</button>` : '')}
      </section>` : '')}

    <div class="quick" aria-label="Quick add">
      <button data-q="expense">${raw(icon('wallet'))}Expense</button>
      <button data-q="study">${raw(icon('book'))}Study</button>
      <button data-q="meal">${raw(icon('leaf'))}Meal</button>
      <button data-q="meeting">${raw(icon('calendar'))}Meeting</button>
      <button data-go="map">${raw(icon('map'))}Map</button>
      <button data-cmd>${raw(icon('search'))}More</button>
    </div>

    <section class="plate card">
      <div class="card-head"><p class="eyebrow">Up next</p><button class="link" data-go="calendar">Calendar ${raw(icon('arrowRight'))}</button></div>
      ${raw(upcoming.length ? upcoming.map(e => html`
        <button class="agenda-row" data-ev="${e.id}">
          <span class="when">${timeHM(e.start)}<small>${fmtDay(dayKey(new Date(e.start)))}</small></span>
          <span class="what"><b>${e.title}</b>${raw(e.location ? html`<small>${e.location}</small>` : '')}</span>
        </button>`).join('') : '<p class="small muted">Nothing scheduled.</p>')}
    </section>

    <section class="plate card">
      <div class="card-head"><p class="eyebrow">To-do</p><button class="link" data-add-task>+ Add</button></div>
      ${raw(tasks.length ? tasks.map(t => html`
        <label class="task"><input type="checkbox" data-task="${t.id}"><span>${t.title}</span>${raw(t.due ? html`<small class="${t.due < today() ? 'overdue' : ''}">${fmtDay(t.due)}</small>` : '')}</label>`).join('') : '<p class="small muted">Empty.</p>')}
    </section>

    <section class="plate card">
      <div class="card-head"><p class="eyebrow">Water</p><span class="small muted mono">${d.water}/${d.goals.dailyWater}</span></div>
      <div class="water">${raw(Array.from({ length: d.goals.dailyWater }, (_, i) => `<button class="glass ${i < d.water ? 'full' : ''}" data-w="${i + 1}" aria-label="${i + 1} glasses"></button>`).join(''))}</div>
    </section>
  `;

  const ask = root.querySelector('[data-ask]');
  ask.onclick = e => {
    if (e.target.closest('[data-brief]')) openAssistant('Brief me: what needs my attention today (çetele minimums, meetings, study and roadmap, tasks, money, diet). Facts and next steps only.');
    else openAssistant();
  };
  ask.onkeydown = e => { if (e.key === 'Enter' && e.target === ask) openAssistant(); };
  root.querySelectorAll('[data-go]').forEach(b => (b.onclick = () => go(b.dataset.go)));
  // Focus from Home: open the lesson and go straight into focus mode.
  root.querySelector('[data-focus-lesson]')?.addEventListener('click', e => { go(e.currentTarget.dataset.focusLesson); document.querySelector('#view [data-focus]')?.click(); });
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
    haptic();
    setTimeout(() => db.put('tasks', { ...t, done: true, doneAt: new Date().toISOString() }), 350);
    toast(`Done: ${t.title}`, { action: { label: 'Undo', run: () => db.put('tasks', t) } });
  }));
  root.querySelectorAll('[data-log]').forEach(b => (b.onclick = () => {
    const r = ct.rows.find(x => x.id === b.dataset.log);
    if (r) logCetele(r.id, CT.isCheck(r) ? 1 : Number(r.step) || 1, CT.isCheck(r));
  }));
  root.querySelector('[data-cmd]')?.addEventListener('click', () => openCommand());
  root.querySelector('[data-save-key]')?.addEventListener('click', async () => {
    try { toast(await saveKey(root.querySelector('[data-key]').value)); } catch (e) { toast(e.message, 4000); }
  });
  // The clock in the head line keeps time while Home is open.
  clearInterval(clockTimer);
  clockTimer = setInterval(() => { const el = root.querySelector('[data-hm]'); if (!el) return clearInterval(clockTimer); el.textContent = timeHM(new Date()); }, 15000);
}

let clockTimer;
export function cleanup() { clearInterval(clockTimer); }
