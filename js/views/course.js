// Course overview: tracks with pace, the week as a calendar, tests, teaching
// deadlines and course settings. Also exports the Today card used on Study.
import * as C from '../course.js';
import * as db from '../db.js';
import { html, raw, today, addDays, parseDay, fmtDay, toast, sheet, confirmSheet, mins } from '../util.js';
import { icon } from '../icons.js';
import { openInCalendar } from '../ics.js';
import { openAssistant } from '../ai/assistant.js';

const STATUS = { todo: 'to do', 'in progress': 'in progress', done: 'done', flagged: 'flagged', prepare: 'prepare' };
const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

export const dotColor = track => (track === 'mixed' ? 'var(--text)' : track ? C.track(track).color : 'var(--dim)');

// The day as a timeline of slots, each linking to its lesson.
export function todayCard(key = today(), { title = 'today', compact = false } = {}) {
  if (!C.ready()) return '<section class="card"><p class="label">today</p><p class="small muted">Loading the course…</p></section>';
  const d = C.day(key);
  const isToday = key === today();
  const now = C.nowMin();
  const head = d.beforeStart ? 'not started' : d.week === 0 ? 'week 0 · setup' : `week ${d.week}${d.consolidation ? ' · consolidation' : ` · phase ${d.phase}`}`;
  let nowPlaced = !isToday;
  const rows = [];
  for (const s of d.slots || []) {
    if (!nowPlaced && toMin(s.start) > now) { rows.push('<div class="now-line"><span>now</span></div>'); nowPlaced = true; }
    if (s.type === 'info') { if (!compact) rows.push(html`<div class="slot info"><span class="slot-t">${s.start}</span><span class="small dim">${s.label}</span></div>`); continue; }
    if (s.type === 'fixed') { rows.push(html`<div class="slot fixed"><span class="slot-t">${s.start}</span><span class="small muted">${s.label} · ${s.start}–${s.end}</span></div>`); continue; }
    const target = slotTarget(s, key);
    const st = s.status ? STATUS[s.status] || s.status : '';
    const live = isToday && toMin(s.start) <= now && toMin(s.end) > now;
    rows.push(html`
      <button class="slot ${raw(live ? 'live' : '')} ${raw(s.urgent ? 'urgent' : '')} ${raw(s.status === 'done' ? 'done' : '')}" ${raw(target ? `data-open="${target}"` : 'disabled')}>
        <span class="slot-t">${s.start}<small>${s.minutes ?? ''}${s.minutes ? 'm' : ''}</small></span>
        <span class="dot" style="background:${raw(dotColor(s.track))}"></span>
        <span class="slot-main"><b>${C.slotTitle(s)}</b><small>${[s.label, s.reason, s.ahead ? 'ahead' : '', s.urgent ? `teach by ${s.teachBy}` : ''].filter(Boolean).join(' · ')}</small></span>
        ${raw(st ? html`<span class="pill ${raw(s.status.replace(' ', '-'))}">${st}</span>` : '')}
      </button>`);
  }
  if (!nowPlaced) rows.push('<div class="now-line"><span>now</span></div>');
  const body = d.beforeStart ? html`<p class="small muted">The course starts ${C.settings().start}. Week 0 (setup) begins four days earlier.</p>` : rows.join('');
  return html`
    <section class="card today-card">
      <div class="card-head"><p class="label">${title}</p><span class="small mono muted">${head}</span></div>
      ${raw(compact ? '' : weekStrip(key))}
      <div class="slots">${raw(body)}</div>
    </section>`;
}

function slotTarget(s, key) {
  if (s.special === 'test') return 'lesson/test';
  if (s.special === 'ship') return 'lesson/ship';
  if (s.special === 'mixed') return `lesson/mixed-${key}`;
  if (s.type === 'review' || s.type === 'plan') return 'lesson/review';
  if (s.special === 'consolidate') return s.diagnostic ? 'lesson/diagnostic' : s.id === 'deep2' ? 'lesson/flagged' : null;
  if (s.prepare) return `lesson/prepare-${s.prepare}`;
  if (s.lesson) return `lesson/${s.lesson.id}`;
  return null;
}

// Mon–Sun strip: lessons done per day this week.
function weekStrip(key) {
  const w = C.weekOf(key);
  if (w < 1) return '';
  const ws = C.weekStartKey(w);
  const doneBy = {};
  for (const p of db.all('courseProgress')) if (p.completedAt) { const k = p.completedAt.slice(0, 10); doneBy[k] = (doneBy[k] || 0) + 1; }
  return `<div class="segs wk">${Array.from({ length: 7 }, (_, i) => {
    const k = addDays(ws, i);
    const n = doneBy[k] || 0;
    return `<i class="${n >= 4 ? 'on' : n ? 'part' : ''} ${k === today() ? 'today' : ''}" title="${k}: ${n} lessons">${'MTWTFSS'[i]}</i>`;
  }).join('')}</div>`;
}

export function startCard() {
  return html`
    <section class="setup course-start">
      <h3>${raw(icon('book'))} Yaver Course</h3>
      <p class="small muted">A day-by-day course in Python, C++, algorithms, math, AI and robotics: what to learn in each block, a full lesson for each, review cards, a weekly test and pace per track. Week 0 runs Oct 15–18; Week 1 starts Monday, Oct 19.</p>
      <button class="btn primary" data-start-course>Start the course</button>
    </section>`;
}

export function bindToday(root, go) {
  root.querySelectorAll('[data-open]').forEach(b => (b.onclick = () => go(b.dataset.open)));
  root.querySelector('[data-start-course]')?.addEventListener('click', async () => {
    await C.activate();
    toast('Course started. Daily goal set from the schedule.');
  });
}

// ---------- Course screen ----------
let shownWeek = null;

export function render(root, go) {
  if (!C.ready()) { root.innerHTML = '<p class="muted small">Loading the course…</p>'; return; }
  const s = C.progressSummary();
  const cur = Math.max(0, C.weekOf());
  if (shownWeek == null) shownWeek = cur;
  const wk = C.weekMeta(shownWeek) || C.weekMeta(0);
  const dl = C.deadlines(30);
  const prepare = C.weekToPrepare();
  const diag = C.diagnosticHistory();

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="path">~/yaver <b>›</b> study <b>›</b> course</p><h1>Course</h1></div>
      <button class="icon-btn" data-back aria-label="Back">${raw(icon('close'))}</button>
    </header>

    ${raw(C.active() ? '' : startCard())}

    <div class="stat-row">
      <div><b>${s.week < 0 ? '–' : s.week}</b><small>week / 63</small></div>
      <div><b>${s.cardsDue}</b><small>cards due</small></div>
      <div><b>${s.tracks.reduce((a, t) => a + t.done, 0)}</b><small>lessons done</small></div>
    </div>

    <div class="btn-row wrap">
      <button class="btn ghost" data-review>${raw(icon('check'))} Review cards</button>
      <button class="btn ghost" data-quiz>${raw(icon('terminal'))} Quiz me on this week</button>
      <button class="btn ghost" data-ics>${raw(icon('calendar'))} Add this week to Calendar</button>
    </div>

    <div class="track-grid">
      ${raw(s.tracks.filter(t => t.total || t.done).map(t => html`
        <div class="tile track-tile">
          <p class="tile-k"><span class="dot" style="background:${t.color}"></span>${t.name}</p>
          <div class="card-head"><span class="tile-v">${t.done}<small> / ${t.total}</small></span><span class="pill pace-${t.paceColor}">${t.pace}</span></div>
          <div class="bar"><div style="width:${raw(t.total ? (t.done / t.total) * 100 : 0)}%;background:${t.color}"></div></div>
          <p class="tile-s mono">${t.masteryRate != null ? `mastery ${t.masteryRate}%` : 'no scores yet'}${t.flagged.length ? ` · ${t.flagged.length} flagged` : ''}</p>
        </div>`).join(''))}
    </div>

    <section class="card">
      <div class="card-head">
        <p class="label">week ${wk.week}${wk.consolidation ? ' · consolidation' : ''}</p>
        <div class="week-nav"><button data-wk="-1" aria-label="Previous week">${raw(icon('chevronLeft'))}</button><span class="small mono">${wk.start.slice(5)} → ${wk.end.slice(5)}</span><button data-wk="1" aria-label="Next week">${raw(icon('chevronRight'))}</button></div>
      </div>
      <p class="small muted">${wk.theme || ''}</p>
      ${raw(weekCalendar(wk))}
      ${raw(wk.week >= 16 && !wk.consolidation && !C.hasWeek(wk.week) ? html`<button class="btn ghost" data-prepare="${wk.week}">${raw(icon('sparkle'))} Prepare week ${wk.week}</button>` : '')}
    </section>

    ${raw(prepare != null && prepare <= cur + 2 && prepare !== wk.week ? html`<button class="btn primary" data-prepare="${prepare}">${raw(icon('sparkle'))} Prepare week ${prepare}</button>` : '')}

    <section class="card">
      <div class="card-head"><p class="label">teaching deadlines</p><button class="link" data-teach>edit dates</button></div>
      ${raw(dl.length ? dl.map(x => html`<div class="agenda-row"><span class="when ${raw(x.days <= 7 ? 'bad' : '')}">${x.teachBy.slice(5)}<small>${x.days < 0 ? `${-x.days}d ago` : `in ${x.days}d`}</small></span><span class="what"><b>${x.title}</b><small>${x.days <= 7 ? 'not prepared yet' : 'prepare before then'}</small></span></div>`).join('') : '<p class="small muted">No teaching dates set. Add the dates you teach each topic, and lessons close to their date and not prepared turn red.</p>')}
    </section>

    <section class="card">
      <p class="label">tests</p>
      ${raw(s.tests.length ? s.tests.map(t => html`<div class="agenda-row"><span class="when">wk ${t.week}<small>${t.date.slice(5)}</small></span><span class="what"><span class="small">${t.scores.map(x => `${C.trackName(x.track)} ${Math.round((x.right / x.total) * 100)}%`).join(' · ')}</span></span></div>`).join('') : '<p class="small muted">The weekly test runs on Sundays at 05:50.</p>')}
      ${raw(diag.length ? html`<p class="small mono muted">diagnostic: ${diag.map(d => `${d.date.slice(5)} ${d.results.score}/7`).join(' → ')}</p>` : '')}
    </section>

    <section class="card">
      <p class="label">how pace works</p>
      <p class="small muted">Behind: the track continues where you are; nothing is skipped, and the Friday buffer goes to the most-behind track. Ahead: next week's lessons come forward; no new subjects are added. Consolidation weeks (${s.consolidationWeeks.slice(0, 6).join(', ')}, …) run at about 60% and don't count toward pace.</p>
    </section>

    <section class="card">
      <p class="label">course settings</p>
      <div class="btn-row wrap">
        <button class="btn ghost" data-times>Slot times</button>
        <button class="btn ghost" data-opts>Start date & work blocks</button>
        ${raw('Notification' in window ? html`<button class="btn ghost" data-alerts>${Notification.permission === 'granted' ? 'Block alerts on' : 'Alert me when a block starts'}</button>` : '')}
        <button class="btn danger" data-reset>Reset progress</button>
      </div>
    </section>`;

  root.querySelector('[data-back]').onclick = () => go('study');
  root.querySelector('[data-review]').onclick = () => go('lesson/review');
  root.querySelector('[data-quiz]').onclick = () => openAssistant('Quiz me on this week of the course. Call get_course_progress and get_review_cards first, then ask one question at a time across the tracks I studied this week, wait for my answer, and correct me briefly.');
  root.querySelector('[data-ics]').onclick = () => exportWeek(Math.max(0, cur));
  bindToday(root, go);
  root.querySelectorAll('[data-wk]').forEach(b => (b.onclick = () => { shownWeek = Math.max(0, Math.min(63, shownWeek + Number(b.dataset.wk))); render(root, go); }));
  root.querySelectorAll('[data-prepare]').forEach(b => (b.onclick = () => go(`lesson/prepare-${b.dataset.prepare}`)));
  root.querySelector('[data-teach]').onclick = () => editTeachDates();
  root.querySelector('[data-times]').onclick = () => editTimes();
  root.querySelector('[data-opts]').onclick = () => editOptions();
  const al = root.querySelector('[data-alerts]');
  if (al) al.onclick = async () => {
    // Asked from this button only, never on page load.
    const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    toast(p === 'granted' ? 'Yaver will alert you when a block starts while it is open.' : 'Notifications are blocked in this browser\'s settings.', 4000);
    render(root, go);
  };
  root.querySelector('[data-reset]').onclick = async () => {
    if (!(await confirmSheet('Reset course progress?', 'Lesson progress, review cards and test results are deleted. Study sessions already logged stay.', 'Reset'))) return;
    for (const st of ['courseProgress', 'cards', 'courseTests']) for (const r of db.all(st)) await db.remove(st, r.id);
    toast('Course progress reset');
  };
}

function weekCalendar(wk) {
  if (wk.week === 0) return '<p class="small muted">Thu: set up your Mac · Fri: diagnostic · Sat: plan the project and teaching · Sun: lock in Week 1.</p>';
  const ph = C.phaseOf(wk.week);
  if (!ph) return '';
  const days = Array.from({ length: 7 }, (_, i) => addDays(wk.start, i));
  return `<div class="wcal">${days.map((k, i) => {
    const d = C.day(k);
    const items = (d.slots || []).filter(s => s.type === 'lesson' || s.special).map(s => `<span class="wc-item" title="${C.slotTitle(s).replace(/"/g, '&quot;')}"><i style="background:${dotColor(s.track)}"></i>${s.lesson ? (s.status === 'done' ? '✓ ' : '') + shortTitle(s) : C.slotTitle(s)}</span>`).join('');
    return `<div class="wc-day ${k === today() ? 'today' : ''}"><b>${'MTWTFSS'[i]} <small>${k.slice(8)}</small></b>${items}</div>`;
  }).join('')}</div>`;
}
const shortTitle = s => `${C.trackName(s.lesson.track)}: ${s.lesson.title}`.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export async function exportWeek(w) {
  const events = C.weekEvents(w);
  if (!events.length) { toast('Nothing to export for this week.'); return; }
  await openInCalendar(events, `yaver-course-week-${w}`);
}

async function editTeachDates() {
  const lessons = C.laneLessons('robo-prep').concat(C.laneLessons('robo-lab')).filter(l => C.status(l.id) !== 'done').slice(0, 12);
  if (!lessons.length) { toast('No upcoming robotics lessons.'); return; }
  const v = await sheet({
    title: 'Teaching dates',
    body: '<p class="small muted">When you teach each topic to your students. Close and not prepared turns red.</p>',
    fields: lessons.map(l => ({ name: l.id, label: `wk ${l.week} · ${l.title}`, type: 'date', value: C.teachBy(l) || '' })),
  });
  if (!v) return;
  const tb = { ...C.settings().teachBy };
  for (const l of lessons) tb[l.id] = v[l.id] || null;
  await C.saveSettings({ teachBy: tb });
  toast('Teaching dates saved');
}

async function editTimes() {
  const kind = await pickKind();
  if (!kind) return;
  const list = C.slotsFor(kind).filter(s => s.type !== 'info');
  const v = await sheet({
    title: `Slot times · ${kind}`,
    body: '<p class="small muted">Sleep 22:30–05:30 is protected: slots can\'t go into it.</p>',
    fields: list.flatMap(s => [{ name: `${s.id}.start`, label: `${s.label} start`, type: 'time', value: s.start }, { name: `${s.id}.end`, label: 'end', type: 'time', value: s.end }]),
  });
  if (!v) return;
  const over = {};
  for (const s of list) over[s.id] = { start: v[`${s.id}.start`] || s.start, end: v[`${s.id}.end`] || s.end };
  const problem = C.checkSlotTimes(kind, over);
  if (problem) { toast(problem, 5000); return; }
  await C.saveSettings({ slots: { ...C.settings().slots, [kind]: over } });
  toast('Slot times saved');
}

async function pickKind() {
  const v = await sheet({ title: 'Which days?', fields: [{ name: 'kind', label: 'Template', type: 'select', options: [['weekday', 'Weekdays (Mon–Fri)'], ['sat', 'Saturday'], ['sun', 'Sunday']], value: 'weekday' }], submit: 'Next' });
  return v?.kind;
}

async function editOptions() {
  const s = C.settings();
  const v = await sheet({
    title: 'Course options',
    fields: [
      { name: 'start', label: 'Week 1 starts (Monday)', type: 'date', value: s.start },
      { name: 'showWork', label: 'Show work and student blocks (and export them)', type: 'checkbox', value: s.showWork },
    ],
  });
  if (!v) return;
  if (v.start && parseDay(v.start).getDay() !== 1) { toast('Week 1 has to start on a Monday.', 4000); return; }
  await C.saveSettings({ start: v.start || s.start, showWork: v.showWork });
  toast('Saved');
}

export function cleanup() {}

// While Yaver is open (laptop or phone), alert when a course block starts.
const alerted = new Set();
export function initSlotAlerts() {
  const check = () => {
    if (!C.ready() || !C.active()) return;
    const d = new Date();
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    for (const s of C.day(today()).slots || []) {
      const key = `${today()} ${s.start} ${s.id}`;
      if (s.start !== hm || s.type === 'info' || alerted.has(key)) continue;
      alerted.add(key);
      const msg = `${s.start} · ${C.slotTitle(s)}`;
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Yaver', { body: msg, icon: 'icons/icon-192.png', tag: key }); } catch {}
      toast(msg, 6000);
    }
  };
  setInterval(check, 20000);
}
export { mins, fmtDay };
