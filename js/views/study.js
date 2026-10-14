import * as D from '../data.js';
import * as db from '../db.js';
import { html, raw, mins, today, addDays, parseDay, fmtDay, toast, sheet, haptic } from '../util.js';
import { ring, barList, empty } from '../ui.js';
import { studyForm } from '../forms.js';
import { openAssistant } from '../ai/assistant.js';

let tick;

// The focus timer survives the app being closed: we store when it started, not a running count.
const timer = () => db.setting('timer', null);

export function render(root) {
  clearInterval(tick);
  const s = D.studySummary();
  const subjects = db.all('subjects');
  const t = timer();
  const recent = db.all('sessions').sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)).slice(0, 8);

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="eyebrow">Study</p><h1>${s.streak.current} day streak <span class="flame ${raw(s.streak.studiedToday ? 'lit' : '')}">🔥</span></h1></div>
      <button class="icon-btn accent" data-add aria-label="Log session">＋</button>
    </header>

    <section class="card study-top">
      ${raw(ring(s.todayMin, s.dailyGoalMin, { size: 112, stroke: 11, color: 'var(--accent)', label: mins(s.todayMin), sub: `of ${mins(s.dailyGoalMin)}` }))}
      <div class="study-stats">
        <div><b>${mins(s.weekMin)}</b><small>this week</small></div>
        <div><b>${s.streak.best}</b><small>best streak</small></div>
        <div><b>${raw(s.streak.studiedToday ? '✓' : '—')}</b><small>${s.streak.studiedToday ? 'today counted' : 'study 15m to keep it'}</small></div>
      </div>
    </section>

    <section class="card focus ${raw(t ? 'running' : '')}">
      <div class="card-head"><h3>Focus timer</h3>${raw(t ? html`<span class="muted small">${t.subject}</span>` : '')}</div>
      ${raw(t ? html`
        <div class="focus-clock" data-clock>00:00</div>
        <div class="focus-sub" data-left></div>
        <div class="btn-row"><button class="btn ghost" data-cancel>Discard</button><button class="btn primary" data-stop>Finish & log</button></div>` : html`
        <label class="field"><span>Subject</span>
          <input list="subj" data-subject placeholder="e.g. Mathematics" value="${subjects[0]?.name || ''}">
          <datalist id="subj">${raw(subjects.map(x => html`<option value="${x.name}">`).join(''))}</datalist>
        </label>
        <div class="presets">${raw([25, 45, 60, 90].map(m => `<button class="chip" data-start="${m}">${m} min</button>`).join(''))}</div>`)}
    </section>

    <section class="card">
      <div class="card-head"><h3>Last 12 weeks</h3><span class="muted small">${mins(Object.values(s.streak.perDay).reduce((a, b) => a + b, 0))} total</span></div>
      ${raw(heatmap(s.streak.perDay, s.dailyGoalMin))}
    </section>

    <section class="card">
      <div class="card-head"><h3>Subjects</h3><span class="muted small">this week · all time</span></div>
      ${raw(s.bySubject.length ? barList(s.bySubject.map(x => ({ label: x.name, value: x.totalMin, color: x.color, display: `${mins(x.weekMin)} · ${mins(x.totalMin)}${x.goalHours ? ` / ${x.goalHours}h` : ''}` }))) : '<p class="muted small">Start the timer or log a session to add your first subject.</p>')}
    </section>

    <button class="card ai-row" data-ai>✨ Ask Yaver for a study plan</button>

    <section class="list">
      <h4 class="list-day">Recent sessions</h4>
      ${raw(recent.length ? recent.map(r => {
        const sub = db.get('subjects', r.subjectId);
        return html`<button class="row" data-id="${r.id}"><span class="row-icon" style="color:${sub?.color || 'inherit'}">●</span>
          <span class="row-main"><b>${sub?.name || 'Study'}</b><small>${fmtDay(r.date)}${r.note ? ` · ${r.note}` : ''}</small></span><span class="row-amt">${mins(r.minutes)}</span></button>`;
      }).join('') : empty('📚', 'No sessions yet.'))}
    </section>`;

  root.querySelector('[data-add]').onclick = () => studyForm();
  root.querySelector('[data-ai]').onclick = () => openAssistant('Look at my study stats and upcoming meetings, then make me a realistic study plan for the next 7 days that protects my streak.');
  root.querySelectorAll('[data-start]').forEach(b => (b.onclick = () => {
    const subject = root.querySelector('[data-subject]').value.trim() || 'General';
    haptic();
    db.setSetting('timer', { subject, start: Date.now(), plannedMin: Number(b.dataset.start) });
    askNotify();
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
      left.textContent = remain > 0 ? `${Math.ceil(remain / 60)} min to go of ${t.plannedMin}` : `Goal reached 🎉 keep going or finish`;
      if (remain <= 0 && remain > -1 && !t.alerted) { t.alerted = true; haptic(); notify(`${t.plannedMin} minutes of ${t.subject} done!`); }
    };
    update();
    tick = setInterval(update, 1000);
    root.querySelector('[data-stop]').onclick = async () => {
      clearInterval(tick);
      const m = Math.max(1, Math.round((Date.now() - t.start) / 60000));
      await db.setSetting('timer', null);
      await D.logStudy({ subject: t.subject, minutes: m });
      toast(`Logged ${m} min of ${t.subject} · ${D.studyStreak().current}🔥`);
    };
    root.querySelector('[data-cancel]').onclick = () => { clearInterval(tick); db.setSetting('timer', null); };
  }
}

function heatmap(perDay, goal) {
  const end = today();
  const startKey = addDays(addDays(end, -7 * 12 + 1), -((parseDay(addDays(end, -7 * 12 + 1)).getDay() + 6) % 7));
  const cells = [];
  for (let k = startKey; k <= end; k = addDays(k, 1)) {
    const v = perDay[k] || 0;
    const lvl = v === 0 ? 0 : v < goal * 0.5 ? 1 : v < goal ? 2 : v < goal * 1.5 ? 3 : 4;
    cells.push(`<i class="l${lvl}" title="${k}: ${mins(v)}"></i>`);
  }
  return `<div class="heat">${cells.join('')}</div><div class="heat-legend"><span>Less</span><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>More</span></div>`;
}

function askNotify() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}
function notify(msg) {
  try { if (Notification.permission === 'granted') new Notification('Yaver', { body: msg, icon: 'icons/icon-192.png' }); } catch {}
  toast(msg, 4000);
}

export function cleanup() {
  clearInterval(tick);
}
