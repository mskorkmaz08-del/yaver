// The study program screen (Yaver M III): subjects with progress and pace, how the program
// is adapting, every lesson by subject, the week (with a timetable), tests and program
// settings. Also exports the Today card used on Study and Home.
import * as C from '../course.js';
import * as P from '../program.js';
import * as db from '../db.js';
import { html, raw, today, addDays, fmtDay, toast, confirmSheet, mins, haptic } from '../util.js';
import { icon } from '../icons.js';
import { openInCalendar } from '../ics.js';
import { openAssistant } from '../ai/assistant.js';

const STATUS = { todo: 'to do', 'in progress': 'started', done: 'done', flagged: 'redo', prepare: 'add topics' };
const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

export const dotColor = track => (track === 'mixed' ? 'var(--text)' : track ? C.track(track).color : 'var(--dim)');

// ---------- Today card (Study, Home) ----------
export function todayCard(key = today(), { title = 'Today', compact = false } = {}) {
  if (!C.active()) return startCard();
  if (C.selfPaced()) return continueCard(compact);
  const d = C.day(key);
  const isToday = key === today();
  const now = C.nowMin();
  const head = d.beforeStart ? `starts ${fmtDay(C.settings().start)}` : `week ${d.week}${d.consolidation ? ' · review week' : ''}`;
  let nowPlaced = !isToday;
  const rows = [];
  for (const s of d.slots || []) {
    if (!nowPlaced && toMin(s.start) > now) { rows.push('<div class="now-line"><span>now</span></div>'); nowPlaced = true; }
    const target = slotTarget(s, key);
    const st = s.status ? STATUS[s.status] || s.status : '';
    const live = isToday && toMin(s.start) <= now && toMin(s.end) > now;
    rows.push(html`
      <button class="slot ${raw(live ? 'live' : '')} ${raw(s.status === 'done' ? 'done' : '')}" ${raw(target ? `data-open="${target}"` : 'disabled')}>
        <span class="slot-t">${s.start}<small>${s.minutes ? `${s.minutes}m` : ''}</small></span>
        <span class="dot" style="background:${raw(dotColor(s.track))}"></span>
        <span class="slot-main"><b>${C.slotTitle(s)}</b><small>${[s.label, s.reason, s.ahead ? 'ahead' : ''].filter(Boolean).join(' · ')}</small></span>
        ${raw(st ? html`<span class="pill ${raw(s.status.replace(' ', '-'))}">${st}</span>` : '')}
      </button>`);
  }
  if (!nowPlaced && rows.length) rows.push('<div class="now-line"><span>now</span></div>');
  const body = d.beforeStart ? html`<p class="small muted">Your program starts ${fmtDay(C.settings().start)}. Until then you can open any lesson from the program screen.</p>`
    : rows.length ? rows.join('') : '<p class="small muted">No study planned today. Rest, or take a lesson from the program screen if you feel like it.</p>';
  return html`
    <section class="card today-card">
      <div class="card-head"><p class="label">${title}</p><span class="small muted">${head}</span></div>
      ${raw(compact ? '' : weekStrip(key))}
      <div class="slots">${raw(body)}</div>
    </section>`;
}

function continueCard(compact) {
  const list = C.upNext(compact ? 3 : 5);
  const t = C.totals(), due = C.dueCount();
  const rows = list.map((l, i) => { const st = C.status(l.id); return html`
      <button class="slot ${raw(i === 0 ? 'live' : '')}" data-open="lesson/${l.id}">
        <span class="slot-t">${i === 0 ? (st === 'in progress' ? 'resume' : st === 'flagged' ? 'redo' : 'start') : ''}<small>${l.minutes}m</small></span>
        <span class="dot" style="background:${raw(dotColor(l.track))}"></span>
        <span class="slot-main"><b>${l.title}</b><small>${C.trackName(l.track)}${st === 'in progress' ? ' · started' : st === 'flagged' ? ' · another go' : ''}${l.starter ? '' : ' · full lesson'}</small></span>
      </button>`; });
  return html`
    <section class="card today-card">
      <div class="card-head"><p class="label">${list.length && C.status(list[0].id) === 'in progress' ? 'Continue' : 'Up next'}</p><span class="small muted">${t.done} of ${t.total} lessons</span></div>
      <div class="slots">${raw(rows.join('') || '<p class="small muted">Every lesson is done. Add topics to keep going.</p>')}</div>
      ${raw(due ? html`<button class="link" data-open="lesson/review">${raw(icon('check'))} ${due} review card${due > 1 ? 's' : ''} due</button>` : '')}
    </section>`;
}

function slotTarget(s, key) {
  if (s.special === 'test') return 'lesson/test';
  if (s.special === 'mixed') return `lesson/mixed-${key}`;
  if (s.type === 'review') return 'lesson/review';
  if (s.special === 'consolidate') return s.target;
  if (s.prepare) return 'program/edit';
  if (s.lesson) return `lesson/${s.lesson.id}`;
  return null;
}

function weekStrip(key) {
  const w = C.weekOf(key);
  if (w < 1) return '';
  const ws = C.weekStartKey(w);
  const p = P.get();
  const doneBy = {};
  for (const r of db.all('courseProgress')) if (r.completedAt) { const k = r.completedAt.slice(0, 10); doneBy[k] = (doneBy[k] || 0) + 1; }
  return `<div class="segs wk">${Array.from({ length: 7 }, (_, i) => {
    const k = addDays(ws, i);
    const n = doneBy[k] || 0;
    return `<i class="${n >= (p?.perDay || 1) ? 'on' : n ? 'part' : ''} ${k === today() ? 'today' : ''} ${p?.days[i] ? '' : 'off'}" title="${k}: ${n} lessons">${'MTWTFSS'[i]}</i>`;
  }).join('')}</div>`;
}

export function startCard() {
  return html`
    <section class="hero-card">
      <span class="hero-ic">${raw(icon('route'))}</span>
      <h2>Build your study program</h2>
      <p>Choose what you want to learn, how well you know it and when you can study. Yaver turns it into lessons, a week that fits your days, review cards and tests, and adjusts as you go.</p>
      <div class="btn-row"><button class="btn primary" data-build>${raw(icon('sparkle'))} Start</button></div>
    </section>`;
}

export function bindToday(root, go) {
  root.querySelectorAll('[data-open]').forEach(b => (b.onclick = () => go(b.dataset.open)));
  root.querySelectorAll('[data-build]').forEach(b => (b.onclick = () => go('program/new')));
}

// ---------- Program screen ----------
let shownWeek = null;
let lessonTrack = null;

export function render(root, go) {
  if (!C.active()) {
    root.innerHTML = html`<header class="page-head"><div><p class="path">Study</p><h1>Program</h1></div><button class="icon-btn" data-back aria-label="Back">${raw(icon('chevronLeft'))}</button></header>${raw(startCard())}`;
    root.querySelector('[data-back]').onclick = () => go('study');
    bindToday(root, go);
    return;
  }
  const prog = P.get();
  const s = C.progressSummary();
  const cur = Math.max(1, C.weekOf());
  if (shownWeek == null) shownWeek = cur;
  const wk = C.weekMeta(shownWeek) || C.weekMeta(1);
  const self = C.selfPaced();
  const toWrite = C.weekToPrepare();
  const notes = P.adaptNotes(prog);
  if (!lessonTrack || !prog.subjects.some(x => x.id === lessonTrack)) lessonTrack = prog.subjects[0]?.id;
  const lessons = C.laneLessons(lessonTrack);

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="path">Study <b>·</b> program</p><h1>${prog.title}</h1>${raw(prog.goal ? html`<p class="sub">${prog.goal}</p>` : '')}</div>
      <div class="head-btns"><button class="icon-btn" data-edit aria-label="Edit program">${raw(icon('sliders'))}</button><button class="icon-btn" data-back aria-label="Back">${raw(icon('chevronLeft'))}</button></div>
    </header>

    <div class="stat-row">
      ${raw(self ? html`<div><b>${C.totals().left}</b><small>lessons left</small></div>` : html`<div><b>${s.week < 0 ? '–' : s.week}</b><small>week</small></div>`)}
      <div><b>${s.cardsDue}</b><small>cards due</small></div>
      <div><b>${s.tracks.reduce((a, t) => a + t.done, 0)}</b><small>lessons done</small></div>
    </div>

    <div class="action-row">
      <button class="act" data-review>${raw(icon('check'))}<span>Review cards</span></button>
      <button class="act" data-mixed>${raw(icon('layers'))}<span>Mixed practice</span></button>
      <button class="act" data-test>${raw(icon('target'))}<span>Test yourself</span></button>
      <button class="act" data-quiz>${raw(icon('chat'))}<span>Quiz me</span></button>
      ${raw(self ? '' : html`<button class="act" data-ics>${raw(icon('calendar'))}<span>Add week to Calendar</span></button>`)}
    </div>

    ${raw(toWrite != null ? html`
    <section class="card write-card">
      <div class="card-head"><p class="label">Full lessons</p><span class="small muted">week ${toWrite}</span></div>
      <p class="small">Lessons start as a simple plan. Yaver can write week ${toWrite}'s lessons in full: explanations at your level, worked examples, checked tasks and review cards.</p>
      <button class="btn primary" data-write-week="${toWrite}">${raw(icon('sparkle'))} Write week ${toWrite} with Yaver</button>
    </section>` : '')}

    ${raw(notes.length && prog.adaptive ? html`
    <section class="card adapt-card">
      <div class="card-head"><p class="label">${raw(icon('route'))} Adapting</p><span class="small muted">from your last results</span></div>
      ${raw(notes.map(n => html`<div class="adapt-row"><span class="dot" style="background:${raw(dotColor(n.track))}"></span><span>${n.text}</span>${raw(n.level ? html`<button class="chip" data-level="${n.track}:${n.level}">Set to ${P.LEVELS.find(x => x[0] === n.level)[1].toLowerCase()}</button>` : '')}</div>`).join(''))}
    </section>` : '')}

    <div class="track-grid">
      ${raw(s.tracks.map(t => html`
        <button class="tile track-tile ${raw(lessonTrack === t.track ? 'sel' : '')} ${raw(t.paused ? 'paused' : '')}" data-track="${t.track}">
          <p class="tile-k"><span class="dot" style="background:${t.color}"></span>${t.name}</p>
          <div class="card-head"><span class="tile-v">${t.done}<small> / ${t.total}</small></span>${raw(self || t.paused ? (t.paused ? '<span class="pill">paused</span>' : '') : html`<span class="pill pace-${t.paceColor}">${t.pace}</span>`)}</div>
          <div class="bar"><div style="width:${raw(t.total ? (t.done / t.total) * 100 : 0)}%;background:${t.color}"></div></div>
          <p class="tile-s">${t.masteryRate != null ? `mastery ${t.masteryRate}%` : 'no scores yet'}${t.flagged.length ? ` · ${t.flagged.length} to redo` : ''}</p>
        </button>`).join(''))}
    </div>

    <section class="card">
      <div class="card-head"><p class="label">${C.trackName(lessonTrack)} · lessons</p><button class="link" data-add-topics>${raw(icon('plus'))} Topics</button></div>
      <div class="lesson-list">
      ${raw(lessons.map(l => { const st = C.status(l.id); return html`
        <button class="row ${raw(st === 'done' ? 'done' : '')}" data-lesson="${l.id}">
          <span class="lnum ${raw(st.replace(' ', '-'))}">${raw(st === 'done' ? icon('check') : String(l.seq))}</span>
          <span class="row-main"><b>${l.title}</b><small>${self ? '' : `week ${l.week} · `}${l.minutes} min${l.starter ? '' : ' · full lesson'}</small></span>
          ${raw(st !== 'todo' ? html`<span class="pill ${raw(st.replace(' ', '-'))}">${STATUS[st]}</span>` : '')}
        </button>`; }).join('') || '<p class="small muted">No topics yet.</p>')}
      </div>
    </section>

    ${raw(self ? '' : html`
    <section class="card">
      <div class="card-head">
        <p class="label">Week ${wk.week}${wk.consolidation ? ' · review' : ''}</p>
        <div class="week-nav"><button data-wk="-1" aria-label="Previous week">${raw(icon('chevronLeft'))}</button><span class="small">${fmtDay(wk.start, { day: 'numeric', month: 'short' })} – ${fmtDay(wk.end, { day: 'numeric', month: 'short' })}</span><button data-wk="1" aria-label="Next week">${raw(icon('chevronRight'))}</button></div>
      </div>
      ${raw(weekCalendar(wk))}
    </section>`)}

    <section class="card">
      <p class="label">Tests</p>
      ${raw(s.tests.length ? s.tests.slice(-6).reverse().map(t => html`<div class="agenda-row"><span class="when">wk ${t.week}<small>${t.date.slice(5)}</small></span><span class="what"><span class="small">${t.scores.map(x => `${C.trackName(x.track)} ${Math.round((x.right / x.total) * 100)}%`).join(' · ')}</span></span></div>`).join('') : html`<p class="small muted">${prog.weeklyTest ? 'The weekly test comes on your last study day of the week. Under 70% in a subject sends its lessons back for another go.' : 'Weekly tests are off. Turn them on in the program settings, or use Test yourself any time.'}</p>`)}
    </section>

    <section class="card">
      <p class="label">Program</p>
      <div class="set-links">
        <button class="set-link" data-edit>${raw(icon('layers'))}<span>Subjects and topics</span>${raw(icon('chevronRight'))}</button>
        <button class="set-link" data-sched>${raw(icon('calendar'))}<span>Days, times and pace</span><small>${prog.days.filter(Boolean).length * prog.perDay}× ${prog.minutes} min a week</small>${raw(icon('chevronRight'))}</button>
        <button class="set-link" data-reset>${raw(icon('refresh'))}<span>Reset progress</span>${raw(icon('chevronRight'))}</button>
      </div>
    </section>`;

  const on = (sel, fn) => root.querySelectorAll(sel).forEach(b => (b.onclick = fn));
  on('[data-back]', () => go('study'));
  on('[data-edit]', () => go('program/edit'));
  on('[data-sched]', () => go('program/schedule'));
  on('[data-review]', () => go('lesson/review'));
  on('[data-mixed]', () => go(`lesson/mixed-${today()}`));
  on('[data-test]', () => go('lesson/test'));
  on('[data-ics]', () => exportWeek(cur));
  on('[data-quiz]', () => openAssistant('Quiz me on what I studied this week. Call get_course_progress and get_review_cards first, then ask one question at a time across my subjects, wait for my answer, and correct me briefly.'));
  on('[data-write-week]', e => go(`lesson/prepare-${e.currentTarget.dataset.writeWeek}`));
  on('[data-add-topics]', () => go('program/edit'));
  root.querySelectorAll('[data-track]').forEach(b => (b.onclick = () => { lessonTrack = b.dataset.track; haptic(); render(root, go); }));
  root.querySelectorAll('[data-lesson]').forEach(b => (b.onclick = () => go(`lesson/${b.dataset.lesson}`)));
  root.querySelectorAll('[data-level]').forEach(b => (b.onclick = async () => { const [sid, lv] = b.dataset.level.split(':'); await P.setLevel(sid, lv); toast('Level changed. New lessons follow it.'); }));
  root.querySelectorAll('[data-wk]').forEach(b => (b.onclick = () => { shownWeek = Math.max(1, shownWeek + Number(b.dataset.wk)); render(root, go); }));
  on('[data-reset]', async () => {
    if (!(await confirmSheet('Reset progress?', 'Lesson progress, review cards and test results are deleted. Your program and logged study time stay.', 'Reset'))) return;
    for (const st of ['courseProgress', 'cards', 'courseTests']) for (const r of db.all(st)) await db.remove(st, r.id);
    await db.setSetting('programWeeks', {});
    toast('Progress reset');
  });
}

function weekCalendar(wk) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(wk.start, i));
  return `<div class="wcal">${days.map((k, i) => {
    const d = C.day(k);
    const items = (d.slots || []).filter(s => s.type === 'lesson' || s.special).map(s => `<span class="wc-item" title="${C.slotTitle(s).replace(/"/g, '&quot;')}"><i style="background:${dotColor(s.track)}"></i>${s.lesson ? (s.status === 'done' ? '✓ ' : '') + esc(s.lesson.title) : esc(C.slotTitle(s))}</span>`).join('');
    return `<div class="wc-day ${k === today() ? 'today' : ''}"><b>${'MTWTFSS'[i]} <small>${k.slice(8)}</small></b>${items || '<span class="wc-item rest">rest</span>'}</div>`;
  }).join('')}</div>`;
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export async function exportWeek(w) {
  const events = C.weekEvents(w);
  if (!events.length) { toast('Nothing to export for this week.'); return; }
  await openInCalendar(events, `yaver-study-week-${w}`);
}

export function cleanup() {}

// While Yaver is open, alert when a timetabled session starts.
const alerted = new Set();
export function initSlotAlerts() {
  const check = () => {
    if (!C.ready() || !C.active() || C.selfPaced()) return;
    const d = new Date();
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    for (const s of C.day(today()).slots || []) {
      const key = `${today()} ${s.start} ${s.id}`;
      if (s.start !== hm || alerted.has(key)) continue;
      alerted.add(key);
      const msg = `${s.start} · ${C.slotTitle(s)}`;
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Yaver', { body: msg, icon: 'icons/icon-192.png', tag: key }); } catch {}
      toast(msg, 6000);
    }
  };
  setInterval(check, 20000);
}
export { mins, fmtDay };
