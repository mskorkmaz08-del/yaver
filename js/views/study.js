import * as D from '../data.js';
import * as db from '../db.js';
import { html, raw, mins, today, addDays, parseDay, fmtDay, toast, sheet, haptic } from '../util.js';
import { barList, empty } from '../ui.js';
import { icon } from '../icons.js';
import { weekCompare } from '../reminders.js';
import { weekSegments } from './home.js';
import { studyForm } from '../forms.js';
import { openAssistant } from '../ai/assistant.js';
import * as C from '../course.js';
import { todayCard, startCard, bindToday } from './course.js';

let tick;

// The focus timer survives the app being closed: we store when it started, not a running count.
const timer = () => db.setting('timer', null);

export function render(root, go) {
  clearInterval(tick);
  const s = D.studySummary();
  const w = weekCompare();
  const subjects = db.all('subjects');
  const t = timer();
  const course = C.ready() && C.active();
  const plan = course ? null : D.planStatus();
  const rm = D.roadmap();
  const recent = db.all('sessions').sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)).slice(0, 8);
  const delta = w.thisWeek - w.lastWeekSamePoint;

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="path">~/yaver <b>›</b> study</p><h1><span class="num ${raw(s.streak.studiedToday ? 'accent' : '')}">${s.streak.current}</span> day streak</h1></div>
      <button class="icon-btn primary" data-add aria-label="Log session">${raw(icon('plus'))}</button>
    </header>

    <div class="stat-row">
      <div><b>${mins(s.todayMin)}</b><small>today / ${mins(s.dailyGoalMin)}</small></div>
      <div><b>${mins(w.thisWeek)}</b><small>${delta >= 0 ? '+' : '−'}${mins(Math.abs(delta))} vs last wk</small></div>
      <div><b>${(w.totalMin / 60).toFixed(w.totalMin < 600 ? 1 : 0)}h</b><small>total · best ${s.streak.best}d</small></div>
    </div>
    ${raw(weekSegments(s.streak.perDay, s.dailyGoalMin))}

    ${raw(course ? todayCard() + html`<div class="btn-row"><button class="btn ghost" data-course>${raw(icon('book'))} Open course</button><button class="btn ghost" data-cards>${raw(icon('check'))} ${C.dueCount()} cards due</button></div>` : C.ready() ? startCard() : '')}

    ${raw(plan ? html`
      <section class="card">
        <div class="card-head"><p class="label">${plan.started ? `week ${plan.week} / 52` : `starts ${plan.start}`}</p><span class="small mono muted">${plan.phaseDone}/${plan.phaseTotal}</span></div>
        <b>${plan.phase.name}</b>
        <div class="bar"><div style="width:${raw(plan.phaseTotal ? (plan.phaseDone / plan.phaseTotal) * 100 : 0)}%"></div></div>
        ${raw(plan.next.map(m => html`<label class="task"><input type="checkbox" data-ms="${m.id}"><span>${m.title}</span></label>`).join(''))}
        <p class="small muted mono">target ${plan.weeklyHours}h/wk · ${plan.template['mon-fri']?.split(':')[0] || ''} weekdays · min day: ${plan.minimumDay.split(';')[0]}</p>
      </section>` : '')}

    <div class="grid2">
      ${raw(Object.entries(D.PRACTICE).map(([k, label]) => html`
        <div class="tile" style="min-height:0">
          <p class="tile-k">${label}</p>
          <div class="card-head"><span class="tile-v">${D.practiceOn(k)}<small> today</small></span>
            <button class="icon-btn primary" data-prac="${k}" aria-label="Add ${label}">${raw(icon('plus'))}</button></div>
          <p class="tile-s mono">${D.practiceTotal(k)} total</p>
        </div>`).join(''))}
    </div>

    <section class="card focus ${raw(t ? 'running' : '')}">
      <div class="card-head"><p class="label">focus</p>${raw(t ? html`<span class="small mono accent">${t.subject}</span>` : '')}</div>
      ${raw(t ? html`
        <div class="focus-clock" data-clock>00:00</div>
        <div class="focus-sub" data-left></div>
        <div class="btn-row"><button class="btn ghost" data-cancel>Discard</button><button class="btn primary" data-stop>Stop & log</button></div>` : html`
        <input list="subj" data-subject placeholder="Subject, e.g. Algorithms" value="${subjects[0]?.name || ''}" aria-label="Subject">
        <datalist id="subj">${raw(subjects.map(x => html`<option value="${x.name}">`).join(''))}</datalist>
        <div class="presets">${raw([25, 45, 60, 90].map(m => `<button class="chip" data-start="${m}">${m}m</button>`).join(''))}</div>`)}
    </section>

    <section class="card">
      <div class="card-head"><p class="label">roadmap</p><button class="link" data-add-ms>+ milestones</button></div>
      ${raw(plan || course ? '' : html`<button class="btn primary" data-load-plan>${raw(icon('download'))} Load the ML Engineer roadmap (52 weeks)</button>`)}
      ${raw(plan && rm.length ? rm.map(r => html`
          <div class="roadmap compact ${raw(r.subject === plan.phase.subject ? 'current' : '')}">
            <div class="card-head"><span class="small">${r.subject}</span><span class="small mono muted">${r.done}/${r.total}</span></div>
            <div class="bar"><div style="width:${raw((r.done / r.total) * 100)}%"></div></div>
          </div>`).join('') : rm.length ? rm.map(r => {
        const next = r.items.filter(m => !m.done).slice(0, 3);
        return html`
          <div class="roadmap">
            <div class="card-head"><b>${r.subject}</b><span class="small mono muted">${r.done}/${r.total}</span></div>
            <div class="bar"><div style="width:${raw((r.done / r.total) * 100)}%"></div></div>
            ${raw(next.map(m => html`<label class="task"><input type="checkbox" data-ms="${m.id}"><span>${m.title}</span></label>`).join('') || '<p class="small accent mono">complete</p>')}
          </div>`;
      }).join('<div style="height:6px"></div>') : '<p class="small muted">No roadmap yet. Add milestones (topics, chapters, projects) per subject and tick them off here, or ask Yaver to build one.</p>')}
    </section>

    <div class="btn-row">
      <button class="btn ghost" data-quiz>${raw(icon('terminal'))} Quiz me</button>
      <button class="btn ghost" data-plan>${raw(icon('sparkle'))} Plan my week</button>
    </div>

    <section class="card">
      <div class="card-head"><p class="label">activity · 12 weeks</p></div>
      ${raw(heatmap(s.streak.perDay, s.dailyGoalMin))}
    </section>

    <section class="card">
      <div class="card-head"><p class="label">subjects</p><span class="small muted mono">week · total</span></div>
      ${raw(s.bySubject.length ? barList(s.bySubject.map(x => ({ label: x.name, value: x.totalMin, display: `${mins(x.weekMin)} · ${mins(x.totalMin)}` }))) : '<p class="small muted">Start the timer or log a session.</p>')}
    </section>

    <section class="list">
      <h4 class="list-day">recent</h4>
      ${raw(recent.length ? recent.map(r => {
        const sub = db.get('subjects', r.subjectId);
        return html`<button class="row" data-id="${r.id}"><span class="dot" style="background:${sub?.color || 'var(--dim)'}"></span>
          <span class="row-main"><b>${sub?.name || 'Study'}</b><small>${fmtDay(r.date)}${r.note ? ` · ${r.note}` : ''}</small></span><span class="row-amt">${mins(r.minutes)}</span></button>`;
      }).join('') : empty('No sessions yet.', 'log 45 min of algorithms'))}
    </section>`;

  root.querySelector('[data-add]').onclick = () => studyForm();
  bindToday(root, go);
  root.querySelector('[data-course]')?.addEventListener('click', () => go('course'));
  root.querySelector('[data-cards]')?.addEventListener('click', () => go('lesson/review'));
  root.querySelector('[data-plan]').onclick = () => openAssistant('Using my roadmap, study stats and calendar, plan concrete study blocks for the next 7 days. Keep it realistic around my meetings.');
  root.querySelector('[data-quiz]').onclick = () => openAssistant('Quiz me: 5 short questions on what I have studied recently (check my sessions and roadmap first). One question at a time; wait for my answer, then correct me briefly.');
  root.querySelector('[data-add-ms]').onclick = async () => {
    const v = await sheet({
      title: 'Add milestones',
      body: '<p class="small muted">One per line, in the order you want to do them.</p>',
      fields: [
        { name: 'subject', label: 'Subject', value: subjects[0]?.name || '', required: true, placeholder: 'Algorithms' },
        { name: 'items', label: 'Milestones', type: 'textarea', placeholder: 'Big-O notation\nArrays & two pointers\nBinary search' },
      ],
    });
    const items = (v?.items || '').split('\n').map(x => x.trim()).filter(Boolean);
    if (v?.subject && items.length) { await D.addMilestones(v.subject, items); toast(`${items.length} milestones added`); }
  };
  root.querySelector('[data-load-plan]')?.addEventListener('click', async () => {
    try {
      const plan = await (await fetch('data/ml-roadmap.json')).json();
      await D.importPlan(plan);
      toast(`Loaded: ${plan.phases.length} phases from ${plan.start}`);
    } catch (e) { toast('Could not load the roadmap: ' + e.message, 4000); }
  });
  root.querySelectorAll('[data-prac]').forEach(b => (b.onclick = async () => {
    const kind = b.dataset.prac;
    if (kind === 'problems') { await D.addPractice('problems', 1); haptic(); return; }
    const v = await sheet({ title: D.PRACTICE[kind], fields: [{ name: 'n', label: 'How many', type: 'number', value: 50, required: true }] });
    if (v?.n) D.addPractice(kind, v.n);
  }));
  root.querySelectorAll('[data-ms]').forEach(cb => (cb.onchange = () => {
    const m = db.get('milestones', cb.dataset.ms);
    cb.closest('.task').classList.add('done');
    haptic();
    setTimeout(() => db.put('milestones', { ...m, done: true, doneAt: new Date().toISOString() }), 350);
  }));
  root.querySelectorAll('[data-start]').forEach(b => (b.onclick = () => {
    const subject = root.querySelector('[data-subject]').value.trim() || 'General';
    haptic();
    db.setSetting('timer', { subject, start: Date.now(), plannedMin: Number(b.dataset.start) });
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  }));
  root.querySelectorAll('[data-id]').forEach(b => (b.onclick = async () => {
    const row = db.get('sessions', b.dataset.id);
    const v = await sheet({ title: 'Session', danger: 'Delete', fields: [{ name: 'minutes', label: 'Minutes', type: 'number', value: row.minutes }, { name: 'note', label: 'Note', value: row.note }] });
    if (!v) return;
    if (v.__danger) db.remove('sessions', row.id);
    else db.put('sessions', { ...row, minutes: Number(v.minutes) || row.minutes, note: v.note });
  }));

  if (t) {
    const clock = root.querySelector('[data-clock]');
    const left = root.querySelector('[data-left]');
    const update = () => {
      const sec = Math.floor((Date.now() - t.start) / 1000);
      clock.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
      const remain = t.plannedMin * 60 - sec;
      left.textContent = remain > 0 ? `${Math.ceil(remain / 60)} min left of ${t.plannedMin}` : `${t.plannedMin} min done · stop when ready`;
      if (remain <= 0 && remain > -1) { haptic(); notify(`${t.plannedMin} min of ${t.subject} done.`); }
    };
    update();
    tick = setInterval(update, 1000);
    root.querySelector('[data-stop]').onclick = async () => {
      clearInterval(tick);
      const m = Math.max(1, Math.round((Date.now() - t.start) / 60000));
      await db.setSetting('timer', null);
      await D.logStudy({ subject: t.subject, minutes: m });
      toast(`Logged ${m} min · ${t.subject}`);
    };
    root.querySelector('[data-cancel]').onclick = () => { clearInterval(tick); db.setSetting('timer', null); };
  }
}

function heatmap(perDay, goal) {
  const end = today();
  const first = addDays(end, -7 * 12 + 1);
  const startKey = addDays(first, -((parseDay(first).getDay() + 6) % 7));
  const cells = [];
  for (let k = startKey; k <= end; k = addDays(k, 1)) {
    const v = perDay[k] || 0;
    const lvl = v === 0 ? 0 : v < goal * 0.5 ? 1 : v < goal ? 2 : v < goal * 1.5 ? 3 : 4;
    cells.push(`<i class="l${lvl}" title="${k}: ${mins(v)}"></i>`);
  }
  return `<div class="heat">${cells.join('')}</div><div class="heat-legend"><span>less</span><i></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>more</span></div>`;
}

function notify(msg) {
  try { if (Notification.permission === 'granted') new Notification('Yaver', { body: msg, icon: 'icons/icon-192.png' }); } catch {}
  toast(msg, 4000);
}

export function cleanup() {
  clearInterval(tick);
}
