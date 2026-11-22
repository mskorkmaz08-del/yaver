// The course engine (Yaver M III). Same job as in M1 (today's blocks, the lesson queue,
// pace, review cards, mixed practice, the weekly test), but nothing is bundled: the
// subjects, topics, timetable and lesson length all come from the study program the
// user builds (js/program.js), and the week's rotation adapts to their results.
// AI-written lessons, progress, cards and test results live in IndexedDB as before.
import * as db from './db.js';
import * as D from './data.js';
import * as P from './program.js';
import { today, addDays, parseDay, dayKey, elapsedMs, pauseTimer, resumeTimer } from './util.js';

const EMPTY = { title: '', start: today(), tracks: [], lanes: {}, weeks: [], consolidation: [], masteryThreshold: 0.8, testThreshold: 0.7, cardIntervals: [1, 3, 7, 14, 30, 60] };
let META = EMPTY;
let started = false;
let dirty = true;
let rotMemo = new Map();

// ---------- Loading ----------
export function init() {
  if (!started) {
    started = true;
    db.onChange((store, id) => {
      if (store === 'courseLessons' || (store === 'kv' && (id === 'program' || id === 'programWeeks'))) dirty = true;
      if (store === 'courseProgress' || store === 'courseTests' || dirty) rotMemo = new Map();
    });
  }
  rebuild();
  queueMicrotask(() => window.dispatchEvent(new Event('course-ready')));
  return Promise.resolve();
}
export const ready = () => started;
export const meta = () => (idx(), META);

let byId = new Map();
let byLane = new Map();
function rebuild() {
  dirty = false;
  rotMemo = new Map();
  const p = P.get();
  byId = new Map(); byLane = new Map();
  if (!p) { META = EMPTY; return; }
  const lessons = P.lessons(p);
  const weeks = P.weeks(p);
  META = {
    title: p.title, start: p.start, masteryThreshold: 0.8, testThreshold: 0.7, cardIntervals: [1, 3, 7, 14, 30, 60],
    tracks: p.subjects.map(s => ({ id: s.id, name: s.name, color: s.color })),
    lanes: Object.fromEntries(p.subjects.map(s => [s.id, { track: s.id, minutes: p.minutes, kind: s.level === 'good' ? 'practice' : 'deep' }])),
    weeks, consolidation: weeks.filter(w => w.consolidation).map(w => w.week),
  };
  for (const l of lessons) {
    byId.set(l.id, l);
    if (!byLane.has(l.lane)) byLane.set(l.lane, []);
    byLane.get(l.lane).push(l);
  }
}
function idx() { if (dirty || P.get() !== lastProg) { lastProg = P.get(); rebuild(); } }
let lastProg = null;

export const lesson = id => { idx(); return shaped(byId.get(id)) || virtualLesson(id); };
export const laneLessons = lane => { idx(); return (byLane.get(lane) || []).map(shaped); };
export const rawLesson = id => { idx(); return byId.get(id) || null; };

// ---------- Learn by doing ----------
// The default lesson style: lecture steps fold into one short "In short" step made of the
// lesson's key facts and one example; the doing steps stay; the full text becomes an
// optional last step for when you are stuck. "full" shows the lesson as written.
const LECTURE = new Set(['learn', 'read', 'summary']);
const doCache = new WeakMap();
export const lessonMode = () => (settings().mode === 'full' ? 'full' : 'do');
const shaped = l => (l && lessonMode() === 'do' ? doLesson(l) : l);
export function doLesson(l) {
  if (!l || l.virtual || l.starter) return l;
  if (doCache.has(l)) return doCache.get(l);
  const steps = l.steps || [];
  const lecture = steps.filter(s => LECTURE.has(s.kind) && s.body);
  const facts = (l.cards || []).slice(0, 7).map(c => `- **${c.front}** ${c.back}`);
  const points = facts.length ? facts : (l.objectives || []).map(o => `- ${o}`);
  let out = l;
  if (lecture.length && points.length) {
    let body = `Know these, then do. The full explanation is the last step: open it only if you get stuck.\n\n${points.join('\n')}`;
    if (!steps.some(s => s.kind === 'example')) {
      const code = lecture.map(s => s.body.match(/```[\s\S]*?```/)?.[0]).find(Boolean);
      if (code && code.split('\n').length <= 32) body += `\n\n**One example**\n\n${code}`;
    }
    const brief = { kind: 'learn', minutes: 5, title: 'In short', body, brief: true };
    const reference = { kind: 'read', minutes: 0, title: 'Full explanation (only if stuck)', optional: true, body: lecture.map(s => `**${s.title}**\n\n${s.body}`).join('\n\n') };
    const first = steps.findIndex(s => LECTURE.has(s.kind) && s.body);
    const kept = steps.flatMap((s, i) => (i === first ? [brief] : LECTURE.has(s.kind) && s.body ? [] : [s]));
    const DOING = new Set(['practice', 'build', 'exit', 'simulate', 'measure', 'test']);
    const recall = !kept.some(s => DOING.has(s.kind)) && (l.cards || []).length >= 2
      ? [{ kind: 'exit', minutes: 5, title: 'Answer from memory', recall: true, questions: l.cards.slice(0, 5).map(c => ({ q: c.front, a: c.back })) }] : [];
    const all = [...kept, ...recall, reference];
    out = { ...l, steps: all, minutes: all.reduce((a, s) => a + (s.minutes || 0), 0), fullMinutes: l.minutes, style: 'do' };
  }
  doCache.set(l, out);
  return out;
}

// ---------- Self-paced ----------
export const selfPaced = () => settings().pacing !== 'schedule';
/** What to do next, best first: lessons you started, then each subject's next lesson, the subject that needs most time first. */
export function upNext(n = 6) {
  idx();
  const out = [], seen = new Set(), tracks = new Set();
  const started = db.all('courseProgress').filter(p => p.status === 'in progress' && byId.has(p.lessonId)).sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  for (const p of started) { const l = shaped(byId.get(p.lessonId)); out.push(l); seen.add(l.id); tracks.add(l.track); }
  const flagged = db.all('courseProgress').filter(p => p.status === 'flagged' && byId.has(p.lessonId)).sort((a, b) => (a.completedAt || '').localeCompare(b.completedAt || ''));
  for (const p of flagged.slice(0, 1)) if (!seen.has(p.lessonId)) { const l = shaped(byId.get(p.lessonId)); out.push(l); seen.add(l.id); }
  const prog = P.get();
  const w = prog ? P.weights(prog) : {};
  const paused = new Set((prog?.subjects || []).filter(s => s.paused).map(s => s.id));
  const heads = [...byLane.entries()].filter(([lane]) => !paused.has(lane))
    .map(([lane, list]) => [lane, list.find(l => !completed(l.id)) || null]).filter(([, l]) => l)
    .sort((a, b) => (w[b[0]]?.weight || 0) - (w[a[0]]?.weight || 0) || a[1].week - b[1].week);
  for (const [, l] of heads) { if (seen.has(l.id) || tracks.has(l.track)) continue; out.push(shaped(l)); seen.add(l.id); tracks.add(l.track); }
  for (const [, l] of heads) { if (!seen.has(l.id)) { out.push(shaped(l)); seen.add(l.id); } }
  return out.slice(0, n);
}
export async function dropStaleTimer() {
  const t = db.setting('lessonTimer', null);
  if (t && !t.pausedAt && Date.now() - t.start > 4 * 3600000) await db.setSetting('lessonTimer', null);
}
export function totals() {
  idx();
  const all = [...byId.values()];
  const done = all.filter(l => completed(l.id)).length;
  return { done, total: all.length, left: all.length - done };
}

// "I know this": done without sitting through it; its review cards still check you.
export async function skipLesson(id) {
  const l = lesson(id);
  if (!l || l.virtual) throw new Error('No lesson with that id');
  const p = progress(id) || {};
  const row = { ...p, id, lessonId: id, track: l.track, lane: l.lane, week: l.week, status: 'done', skipped: true, mastered: true, score: p.score ?? null,
    startedAt: p.startedAt || new Date().toISOString(), completedAt: new Date().toISOString(), minutes: p.minutes || 0 };
  await db.put('courseProgress', row);
  await addCards(l);
  if (db.setting('lessonTimer', null)?.lessonId === id) await db.setSetting('lessonTimer', null);
  return { before: Object.keys(p).length ? p : null, next: nextInLane(l.lane) };
}
// M1 had bundled "basics" lessons to skip; a program the user built has none.
export const basicsLeft = () => [];
export const skipBasics = async () => 0;
export const track = id => { idx(); return META.tracks.find(t => t.id === id) || { id, name: id === 'mixed' ? 'Mixed' : id, color: 'var(--dim)' }; };
export const trackName = id => track(id).name;
export const weekMeta = n => { idx(); return META.weeks.find(w => w.week === n) || (n > 0 && P.get() ? { week: n, start: addDays(P.get().start, 7 * (n - 1)), end: addDays(P.get().start, 7 * n - 1), theme: '', consolidation: P.isReviewWeek(n) } : null); };

// ---------- Settings (stored on the program) ----------
export function settings() {
  const p = P.get();
  const extra = db.setting('course', {}) || {};
  return { active: !!p, start: p?.start || today(), pacing: p?.pacing || 'self', mode: p?.style || 'do', slots: {}, showWork: false, teachBy: {}, ...extra, ...(p ? { start: p.start, pacing: p.pacing, mode: p.style } : {}) };
}
export async function saveSettings(patch) {
  const p = P.get();
  if (!p) return db.setSetting('course', { ...(db.setting('course', {}) || {}), ...patch });
  const map = { pacing: 'pacing', mode: 'style', start: 'start' };
  const next = { ...p };
  for (const [k, v] of Object.entries(patch)) if (map[k]) next[map[k]] = v;
  return P.save(next);
}
export const active = () => P.exists();
export async function activate() { /* the program is the activation */ }
export const MINIMUM_DAY = 'Your review cards plus one session. Never miss two days in a row.';

// ---------- Calendar maths ----------
const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
export const nowMin = (d = new Date()) => d.getHours() * 60 + d.getMinutes();
const dow = key => (parseDay(key).getDay() + 6) % 7; // Mon = 0 … Sun = 6
const DAY = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function weekOf(key = today()) { const p = P.get(); if (!p) return -1; const w = P.currentWeek(p, key); return w === 0 ? -1 : w; }
export const weekStartKey = n => addDays(settings().start, 7 * (n - 1));
export const isConsolidation = n => { const p = P.get(); return !!p && P.isReviewWeek(n, p); };
/** The week's rotation: past and current weeks keep the one they started with; later weeks follow today's weights. */
export function rotationFor(w) {
  const p = P.get();
  if (!p) return {};
  if (rotMemo.has(w)) return rotMemo.get(w);
  const frozen = db.setting('programWeeks', {}) || {};
  let rot = frozen[w];
  if (!rot) {
    const left = {};
    for (const [lane, list] of byLane) left[lane] = list.filter(l => !completed(l.id)).length;
    rot = P.buildRotation(p, { lessonsLeft: left, adaptive: true });
    if (w === weekOf() && w > 0) freezeLater(w, rot);
  }
  rotMemo.set(w, rot);
  return rot;
}
let freezing = false;
function freezeLater(w, rot) {
  if (freezing) return;
  freezing = true;
  setTimeout(async () => { try { const f = db.setting('programWeeks', {}) || {}; if (!f[w]) await db.setSetting('programWeeks', { ...f, [w]: rot }); } finally { freezing = false; } }, 0);
}
export const phaseOf = n => { const p = P.get(); return p && n > 0 ? { id: 'p1', name: p.title, weeks: [1, 520], rotation: rotationFor(n) } : null; };

export function slotsFor(kind) {
  const d = typeof kind === 'number' ? kind : DAY.indexOf(kind) >= 0 ? DAY.indexOf(kind) : P.studyDays()[0] ?? 0;
  return P.get() ? P.slotsForDay(d) : [];
}
export function checkSlotTimes() { return null; }

// ---------- Progress ----------
export const progress = id => db.get('courseProgress', id) || null;
const completed = id => ['done', 'flagged'].includes(progress(id)?.status);
export const finished = completed;
export function recallFromFinished(trackId, n, skip = new Set()) {
  const out = [];
  const rows = db.all('courseProgress').filter(p => completed(p.lessonId) && p.completedAt).sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  for (const p of rows) {
    const l = lesson(p.lessonId);
    if (!l || l.virtual || (trackId && trackId !== 'mixed' && l.track !== trackId)) continue;
    const q = (l.steps?.find(s => s.kind === 'exit')?.questions || []).find(x => !skip.has(x.q));
    if (q) { out.push({ ...q, from: l.id }); skip.add(q.q); }
    if (out.length >= n) break;
  }
  return out;
}
export function status(id) {
  const p = progress(id);
  if (!p) return 'todo';
  if (p.status === 'flagged') return 'flagged';
  if (p.status === 'done') return 'done';
  return 'in progress';
}
export function nextInLane(lane, skip = 0) {
  return laneLessons(lane).filter(l => !completed(l.id))[skip] || null;
}
function sessionsBefore(lane, key, startHM, at = new Date()) {
  const t = dayKey(at), nm = nowMin(at);
  if (key < t) return 0;
  let n = 0;
  for (let k = t; k <= key; k = addDays(k, 1)) {
    const w = weekOf(k);
    if (w < 1 || isConsolidation(w)) continue;
    const rot = rotationFor(w), d = dow(k);
    for (const s of slotsFor(d)) {
      if (rot[s.id]?.[d] !== lane) continue;
      if (k === t && toMin(s.end) <= nm) continue;
      if (k === key && toMin(s.start) >= toMin(startHM)) continue;
      n++;
    }
  }
  return n;
}
export const doneInLane = lane => laneLessons(lane).filter(l => completed(l.id)).length;

/** The earliest week from now whose lessons are still starters (not yet written in full). */
export function weekToPrepare() {
  idx();
  const cur = Math.max(1, weekOf());
  const weeks = [...new Set([...byId.values()].filter(l => l.starter && !completed(l.id) && l.week >= cur).map(l => l.week))].sort((a, b) => a - b);
  return weeks[0] ?? null;
}
export const hasWeek = n => { idx(); const ls = [...byId.values()].filter(l => l.week === n); return ls.length > 0 && ls.every(l => !l.starter); };

// ---------- Pace ----------
export function expected(lane, at = new Date()) {
  const key = dayKey(at), w = weekOf(key);
  let n = 0;
  for (let wk = 1; wk <= Math.min(w, 260); wk++) {
    if (isConsolidation(wk)) continue;
    const rot = rotationFor(wk);
    for (let d = 0; d < 7; d++) {
      const k = addDays(weekStartKey(wk), d);
      if (k > key) break;
      for (const s of slotsFor(d)) {
        if (rot[s.id]?.[d] !== lane) continue;
        if (k < key || toMin(s.end) <= nowMin(at)) n++;
      }
    }
  }
  return n;
}
export function weeklySessions(trackId, w = Math.max(1, weekOf())) {
  return Object.values(rotationFor(w)).flat().filter(l => l === trackId).length;
}
export function pace(at = new Date()) {
  const out = {};
  const self = selfPaced();
  for (const [lane, def] of Object.entries(META.lanes)) {
    const e = self ? 0 : expected(lane, at), d = doneInLane(lane);
    if (!e && !d) continue;
    const t = (out[def.track] ||= { track: def.track, name: trackName(def.track), expected: 0, done: 0, lanes: {} });
    t.expected += e; t.done += d; t.lanes[lane] = { expected: e, done: d };
  }
  for (const t of Object.values(out)) {
    t.behind = self ? 0 : Math.max(0, t.expected - t.done);
    t.ahead = self ? 0 : Math.max(0, t.done - t.expected);
    t.label = self ? 'your pace' : t.behind ? `${t.behind} behind` : t.ahead ? `${t.ahead} ahead` : 'on plan';
    t.color = !t.behind ? 'green' : t.behind < weeklySessions(t.track) ? 'yellow' : 'red';
  }
  return out;
}

// M1 had teaching deadlines for one person's robotics course; programs have none.
export const teachBy = () => null;
export async function setTeachBy() {}
export const deadlines = () => [];

// ---------- Today ----------
export function day(key = today()) {
  idx();
  const w = weekOf(key);
  const d = dow(key);
  const cons = w > 0 && isConsolidation(w);
  const base = { date: key, week: w, kind: DAY[d], phase: w > 0 ? 'p1' : null, phaseName: META.title, consolidation: cons, slots: [] };
  if (!P.get()) return base;
  if (w < 1) return { ...base, beforeStart: true };
  const rot = rotationFor(w);
  let first = true;
  for (const s of slotsFor(d)) {
    if (s.type === 'review') { base.slots.push(s); continue; }
    if (s.type === 'test') { base.slots.push({ ...s, special: 'test' }); continue; }
    if (cons) { base.slots.push(consolidationSlot(s, first)); first = false; continue; }
    const lane = rot[s.id]?.[d];
    if (!lane) continue;
    base.slots.push(withLesson({ ...s, lane, track: lane }, nextInLane(lane, sessionsBefore(lane, key, s.start)), w, lane));
  }
  return base;
}

function withLesson(s, l, w, lane = s.lane) {
  if (!l) {
    // this subject is out of topics: take a flagged lesson, or another subject's next one
    const flagged = db.all('courseProgress').filter(p => p.status === 'flagged').map(p => rawLesson(p.lessonId)).find(Boolean);
    if (flagged) return { ...s, lane: flagged.lane, track: flagged.track, lesson: shaped(flagged), status: 'flagged', reason: 'redo a flagged lesson', special: 'buffer' };
    const other = upNext(1)[0];
    if (other) return { ...s, lane: other.lane, track: other.track, lesson: other, status: status(other.id), reason: `${trackName(lane)} has no topics left`, special: 'buffer' };
    return { ...s, lane, track: lane, prepare: true, status: 'prepare' };
  }
  return { ...s, lane: l.lane, track: l.track, lesson: l, status: status(l.id), ahead: l.week > w };
}

function consolidationSlot(s, first) {
  return first
    ? { ...s, special: 'consolidate', track: null, task: 'Redo the lessons flagged for another go.', target: 'lesson/flagged' }
    : { ...s, special: 'consolidate', track: null, task: 'Review cards, then retake your weakest test from memory.', target: 'lesson/review' };
}

export function nextBlock(at = new Date()) {
  if (!P.get()) return null;
  if (selfPaced()) {
    const l = upNext(1)[0];
    return l ? { id: 'next', type: 'lesson', selfPaced: true, lesson: l, track: l.track, lane: l.lane, minutes: l.minutes, start: '', end: '', label: 'next lesson', status: status(l.id), date: dayKey(at) } : null;
  }
  for (let i = 0; i < 7; i++) {
    const k = addDays(dayKey(at), i);
    for (const s of day(k).slots || []) {
      if (i === 0 && toMin(s.end) <= nowMin(at)) continue;
      return { ...s, date: k };
    }
  }
  return null;
}

export function slotTitle(s) {
  if (s.special === 'test') return 'Weekly test';
  if (s.special === 'mixed') return 'Mixed practice';
  if (s.special === 'consolidate') return s.task;
  if (s.type === 'review') return 'Review cards · plan tomorrow';
  if (s.prepare) return `Add topics to ${trackName(s.track)}`;
  if (s.lesson) return `${trackName(s.lesson.track)}: ${s.lesson.title}`;
  return s.label;
}

// ---------- Cards (spaced repetition) ----------
const INTERVALS = () => META?.cardIntervals || [1, 3, 7, 14, 30, 60];
export function dueCards({ limit = 100, track, at = today() } = {}) {
  const due = db.all('cards').filter(c => c.due <= at && (!track || c.track === track)).sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
  return interleave(due, c => c.track).slice(0, limit);
}
export const dueCount = () => db.all('cards').filter(c => c.due <= today()).length;

export async function addCards(l, due = addDays(today(), 1)) {
  for (const [i, c] of (l.cards || []).entries()) {
    const id = `${l.id}#${i}`;
    const old = db.get('cards', id);
    if (old) { if (old.due > due) await db.put('cards', { ...old, due }); continue; }
    await db.put('cards', { id, lessonId: l.id, track: l.track, front: c.front, back: c.back, box: 0, due, lapses: 0, history: [] });
  }
}
/** Your own review card (any subject): the starter lessons have none until you add some. */
export async function addOwnCard({ track, front, back, lessonId = '' }) {
  const id = `own-${db.uid()}`;
  return db.put('cards', { id, lessonId, track, front, back, box: 0, due: addDays(today(), 1), lapses: 0, history: [], own: true });
}

export async function gradeCard(id, grade) {
  const c = db.get('cards', id);
  if (!c) throw new Error('No card with that id');
  const iv = INTERVALS();
  let { box, lapses } = c;
  let days;
  if (grade === 'again') { box = 0; days = 1; lapses++; }
  else if (grade === 'hard') days = Math.max(1, Math.round(iv[box] * 0.5));
  else if (grade === 'good') { box = Math.min(iv.length - 1, box + 1); days = iv[box]; }
  else if (grade === 'easy') { box = Math.min(iv.length - 1, box + 2); days = iv[box]; }
  else throw new Error('grade must be again, hard, good or easy');
  const row = { ...c, box, lapses, due: addDays(today(), days), history: [...(c.history || []), { at: new Date().toISOString(), grade }].slice(-30) };
  await db.put('cards', row);
  await D.addPractice('anki', 1);
  return row;
}

// ---------- Completing a lesson ----------
export async function startLesson(id) {
  const l = lesson(id);
  if (!l) throw new Error('No lesson with that id');
  const p = progress(id);
  if (!p || p.status === 'flagged') await db.put('courseProgress', { ...(p || {}), id, lessonId: id, track: l.track, lane: l.lane, week: l.week, status: p?.status === 'flagged' ? 'flagged' : 'in progress', startedAt: new Date().toISOString(), attempts: (p?.attempts || 0) + 1 });
  const t = db.setting('lessonTimer', null);
  if (t?.lessonId === id) return db.setSetting('lessonTimer', resumeTimer(t));
  await db.setSetting('lessonTimer', { lessonId: id, start: Date.now(), plannedMin: l.minutes });
}
export const pauseLesson = () => db.setSetting('lessonTimer', pauseTimer(db.setting('lessonTimer', null)));
export const resetLessonTimer = () => db.setSetting('lessonTimer', null);

/** feel: how the lesson felt ('easy' | 'right' | 'hard'); the program adapts to it. */
export async function completeLesson({ lessonId, minutes, score = null, notes = '', hintsUsed = 0, solutionsRevealed = 0, feel = null }) {
  const l = lesson(lessonId);
  if (!l) throw new Error('No lesson with that id');
  const t = db.setting('lessonTimer', null);
  const p = progress(lessonId) || {};
  if (minutes == null) minutes = t?.lessonId === lessonId ? Math.max(1, Math.round(elapsedMs(t) / 60000)) : l.minutes;
  minutes = Math.max(1, Math.round(Number(minutes)));
  if (score != null) score = Math.max(0, Math.min(1, Number(score) > 1 ? Number(score) / 100 : Number(score)));
  const mastered = score == null || score >= META.masteryThreshold;
  const row = {
    ...p, id: lessonId, lessonId, track: l.track, lane: l.lane, week: l.week,
    status: mastered ? 'done' : 'flagged', startedAt: p.startedAt || (t?.lessonId === lessonId ? new Date(t.start).toISOString() : new Date(Date.now() - minutes * 60000).toISOString()),
    completedAt: new Date().toISOString(), minutes: (p.status === 'flagged' ? (p.minutes || 0) : 0) + minutes, score, mastered,
    hintsUsed: (p.hintsUsed || 0) + hintsUsed, solutionsRevealed: (p.solutionsRevealed || 0) + solutionsRevealed, notes: notes || p.notes || '',
    feel: ['easy', 'right', 'hard'].includes(feel) ? feel : p.feel || null,
  };
  await db.put('courseProgress', row);
  await D.logStudy({ subject: l.virtual ? (l.subject || 'Study') : trackName(l.track), minutes, note: l.title });
  await addCards(l);
  if (t?.lessonId === lessonId) await db.setSetting('lessonTimer', null);
  const next = l.virtual ? null : nextInLane(l.lane);
  return { status: row.status, mastered, score, minutes, next: next && { id: next.id, title: next.title, week: next.week } };
}
export async function setFeel(lessonId, feel) {
  const p = progress(lessonId);
  if (p) await db.put('courseProgress', { ...p, feel });
}

export async function resetLesson(id) {
  await db.remove('courseProgress', id);
}

// ---------- Mixed practice and the weekly test ----------
function rng(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
function shuffle(arr, r) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export function interleave(items, key) {
  const groups = new Map();
  for (const x of items) { const k = key(x); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  const out = [];
  while (out.length < items.length) for (const g of groups.values()) if (g.length) out.push(g.shift());
  return out;
}

const recentDone = (from, to) => db.all('courseProgress').filter(p => p.completedAt && dayKey(new Date(p.completedAt)) >= from && dayKey(new Date(p.completedAt)) <= to && lesson(p.lessonId) && !lesson(p.lessonId).virtual);

export function mixedLesson(key = today()) {
  const r = rng('mixed' + key);
  const byTrack = new Map();
  for (const p of recentDone(addDays(key, -14), key)) {
    const l = lesson(p.lessonId);
    for (const s of l.steps || []) for (const [i, t] of (s.tasks || []).entries()) {
      if (s.kind !== 'practice') continue;
      if (!byTrack.has(l.track)) byTrack.set(l.track, []);
      byTrack.get(l.track).push({ ...t, from: l.id, fromTitle: l.title, track: l.track, ref: `${l.id}:${i}` });
    }
  }
  let tasks = [];
  for (const [, list] of byTrack) tasks.push(...shuffle(list, r).slice(0, 2));
  tasks = interleave(shuffle(tasks, r), t => t.track).slice(0, 10);
  const cards = shuffle(dueCards({ at: key }), r).slice(0, 5);
  const m = P.get()?.minutes || 45;
  const per = tasks.length ? Math.max(5, Math.floor((m - 10) / tasks.length)) : 0;
  return {
    id: `mixed-${key}`, virtual: true, kind: 'mixed', track: 'mixed', subject: 'Mixed practice', lane: 'mixed', week: weekOf(key), minutes: m,
    title: 'Mixed practice', objectives: ['Recognise which method a problem needs without being told the topic', 'Solve problems from different subjects back to back'],
    resources: [],
    steps: [
      { kind: 'warmup', minutes: 10, title: 'Review cards', cardIds: cards.map(c => c.id), body: cards.length ? 'Five due cards, mixed across subjects.' : 'No cards due. Recall one idea from each subject this week and write it down.' },
      { kind: 'practice', minutes: m - 10, title: tasks.length ? `${tasks.length} mixed problems` : 'Mixed problems', tasks: tasks.length ? tasks.map(t => ({ ...t, minutes: per })) : [{ prompt: 'No practice from the last 14 days yet. Pick two tasks from recent lessons in different subjects and do them without notes.', hints: ['Start with the one you feel least sure about.'], check: 'You can explain why your answer works.', solution: '' }], body: 'Subjects alternate on purpose: before each problem, name the method first, then solve it.' },
    ],
    cards: [],
  };
}

export function testQuestions(w = weekOf()) {
  const from = weekStartKey(w), to = addDays(from, 6);
  const r = rng('test' + w);
  const qs = [];
  for (const p of recentDone(from, to)) {
    const l = lesson(p.lessonId);
    for (const s of l.steps || []) if (s.kind === 'exit') for (const q of s.questions || []) qs.push({ track: l.track, lessonId: l.id, q: q.q, a: q.a });
  }
  const earlier = shuffle(db.all('cards').filter(c => { const l = lesson(c.lessonId); return !l || l.week < w; }), r)
    .slice(0, Math.max(3, Math.round(qs.length / 3))).map(c => ({ track: c.track, lessonId: c.lessonId, q: c.front, a: c.back, card: c.id }));
  const all = [...shuffle(qs, r).slice(0, 24), ...earlier].slice(0, 30);
  return interleave(shuffle(all, r), q => q.track);
}

export async function recordTest({ week, scores }) {
  if (!Array.isArray(scores)) throw new Error('scores must be a list of {track, right, total}');
  const clean = scores.filter(s => s.total > 0).map(s => ({ track: s.track, right: Number(s.right) || 0, total: Number(s.total) }));
  await db.put('courseTests', { id: `w${String(week).padStart(2, '0')}`, week, date: today(), scores: clean });
  const weak = clean.filter(s => s.right / s.total < META.testThreshold).map(s => s.track);
  const monday = addDays(weekStartKey(week), 7);
  for (const p of db.all('courseProgress')) {
    const l = lesson(p.lessonId);
    if (!l || l.week !== week || !weak.includes(l.track)) continue;
    await db.put('courseProgress', { ...p, status: 'flagged', mastered: false, flaggedBy: 'test' });
    for (const c of db.all('cards').filter(c => c.lessonId === l.id)) await db.put('cards', { ...c, due: monday });
  }
  return { weakTracks: weak };
}
export const testResults = () => db.all('courseTests').sort((a, b) => a.week - b.week);

export async function recordDiagnostic(results) {
  const prev = db.setting('courseDiagnostic', []);
  await db.setSetting('courseDiagnostic', [...prev, { date: today(), week: weekOf(), results }]);
}
export const diagnosticHistory = () => db.setting('courseDiagnostic', []);

function virtualLesson(id) {
  if (String(id).startsWith('mixed-')) return mixedLesson(id.slice(6));
  return null;
}

// ---------- Progress summary (Study screen + AI) ----------
export function progressSummary() {
  idx();
  const p = pace();
  const prog = P.get();
  const tracks = META.tracks.map(t => {
    const lessons = [...byId.values()].filter(l => l.track === t.id);
    const rows = lessons.map(l => progress(l.id)).filter(Boolean).filter(x => ['done', 'flagged'].includes(x.status));
    const scored = rows.filter(x => x.score != null);
    return {
      track: t.id, name: t.name, color: t.color, done: rows.length, total: lessons.length, written: lessons.filter(l => !l.starter).length,
      pace: p[t.id]?.label || 'not started', paceColor: p[t.id]?.color || 'green', behind: p[t.id]?.behind || 0,
      masteryRate: scored.length ? Math.round((scored.filter(x => x.score >= META.masteryThreshold).length / scored.length) * 100) : null,
      flagged: rows.filter(x => x.status === 'flagged').map(x => ({ id: x.lessonId, title: lesson(x.lessonId)?.title })),
      paused: !!prog?.subjects.find(s => s.id === t.id)?.paused,
    };
  });
  return { program: P.describe(), week: weekOf(), tracks, cardsDue: dueCount(), tests: testResults(), consolidationWeeks: META.consolidation, adapting: P.adaptNotes().map(n => n.text) };
}

// ---------- Lessons written by the AI ----------
const KINDS = new Set(['warmup', 'example', 'learn', 'read', 'practice', 'build', 'exit', 'reflect', 'summary', 'cards', 'plan', 'test', 'log', 'simulate', 'measure']);
export function validateLessons(week, lessons) {
  idx();
  const errors = [];
  if (!Array.isArray(lessons) || !lessons.length) return ['lessons must be a non-empty list'];
  for (const [i, l] of lessons.entries()) {
    const at = `lessons[${i}] (${l?.id || 'no id'})`;
    if (!l || typeof l !== 'object') { errors.push(`${at}: not an object`); continue; }
    const base = byId.get(l.id);
    if (!base) { errors.push(`${at}: unknown id; use an id from the brief (get_study_program lists every lesson id)`); continue; }
    if (week != null && base.week !== week) errors.push(`${at}: this lesson is in week ${base.week}, not ${week}`);
    if (!l.title) errors.push(`${at}: title missing`);
    if (!Array.isArray(l.objectives) || l.objectives.length < 2 || l.objectives.length > 5) errors.push(`${at}: 2–5 objectives`);
    if (!Array.isArray(l.cards) || l.cards.length < 3 || l.cards.length > 8 || l.cards.some(c => !c.front || !c.back)) errors.push(`${at}: 3–8 cards, each {front, back}`);
    if (!Array.isArray(l.steps) || l.steps.length < 3) { errors.push(`${at}: at least 3 steps`); continue; }
    const total = l.steps.reduce((a, s) => a + (Number(s.minutes) || 0), 0);
    if (Math.abs(total - base.minutes) > Math.max(5, base.minutes * 0.15)) errors.push(`${at}: step minutes add up to ${total}, the session is ${base.minutes}`);
    for (const s of l.steps) {
      if (!KINDS.has(s.kind)) errors.push(`${at}: unknown step kind ${s.kind}`);
      if (s.kind === 'exit' && (!Array.isArray(s.questions) || s.questions.length < 3 || s.questions.length > 5 || s.questions.some(q => !q.q || !q.a))) errors.push(`${at}: exit needs 3–5 questions with answers`);
      if (s.kind === 'practice' && (!Array.isArray(s.tasks) || s.tasks.length < 2 || s.tasks.some(t => !t.prompt || !t.check))) errors.push(`${at}: practice needs 2–5 tasks, each with prompt and check`);
    }
    if (!l.steps.some(s => s.kind === 'exit')) errors.push(`${at}: needs an exit step`);
    for (const r of l.resources || []) if (!/^https:\/\//.test(r.url || '')) errors.push(`${at}: resource urls must be https`);
  }
  return errors;
}

export async function saveLessons(lessons, week = null) {
  const errors = validateLessons(week, lessons);
  if (errors.length) return { saved: false, errors };
  for (const l of lessons) {
    const base = byId.get(l.id);
    await db.put('courseLessons', { ...l, id: l.id, lessonId: l.id, track: base.track, lane: base.lane, minutes: base.minutes, kind: l.kind || base.kind, program: true, generatedAt: new Date().toISOString() });
  }
  dirty = true;
  return { saved: true, count: lessons.length };
}
export const saveWeekLessons = (week, lessons) => saveLessons(lessons, week);
/** Go back to the starter version of a lesson. */
export async function unwriteLesson(id) { await db.remove('courseLessons', id); dirty = true; }

export const template = (kind, minutes) => P.stepPlan(kind, minutes);

/** What the AI needs to write lessons: the learner, the program and each lesson's slot. */
export function lessonBrief(ids) {
  idx();
  const prog = P.get();
  const list = ids.map(id => byId.get(id)).filter(Boolean);
  return {
    learner: { goal: prog.goal, program: prog.title, style: prog.style === 'do' ? 'learn by doing: short explanations, most time on tasks' : 'full explanations before tasks' },
    lessons: list.map(l => {
      const s = prog.subjects.find(x => x.id === l.track);
      const prev = (byLane.get(l.lane) || []).filter(x => x.seq < l.seq).at(-1);
      const recent = db.all('courseProgress').filter(r => r.track === l.track && r.completedAt).sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 3);
      return {
        id: l.id, title: l.title, subject: s?.name, level: s?.level, minutes: l.minutes, kind: l.kind, week: l.week,
        stepTemplate: P.stepPlan(l.kind, l.minutes), previousLesson: prev ? { id: prev.id, title: prev.title, finished: completed(prev.id) } : null,
        nextTopics: (byLane.get(l.lane) || []).filter(x => x.seq > l.seq).slice(0, 3).map(x => x.title),
        recentFeel: recent.map(r => r.feel).filter(Boolean), recentScores: recent.map(r => r.score).filter(x => x != null),
        resources: s?.resources || [],
      };
    }),
  };
}
export function weekBrief(week) {
  idx();
  const w = weekMeta(week);
  return { week, start: w?.start, theme: w?.theme, ...lessonBrief([...byId.values()].filter(l => l.week === week).map(l => l.id)) };
}

// ---------- Calendar export ----------
export function weekEvents(w = weekOf()) {
  const events = [];
  const from = weekStartKey(Math.max(1, w));
  for (let k = from; k <= addDays(from, 6); k = addDays(k, 1)) {
    for (const s of day(k).slots || []) {
      const [y, m, dd] = k.split('-').map(Number);
      const [sh, sm] = s.start.split(':').map(Number), [eh, em] = s.end.split(':').map(Number);
      events.push({ id: `course-${k}-${s.id}`, title: `${s.label} · ${slotTitle(s)}`, start: new Date(y, m - 1, dd, sh, sm).toISOString(), end: new Date(y, m - 1, dd, eh, em).toISOString(), notes: (s.lesson?.objectives || []).join('\n'), remind: 5 });
    }
  }
  return events;
}

// Evening review: a two-line log and tomorrow's plan.
export const dayLog = (key = today()) => db.setting(`courseLog:${key}`, null);
export const saveDayLog = (key, v) => db.setSetting(`courseLog:${key}`, { ...v, at: new Date().toISOString() });
export function planFor(key) {
  if (selfPaced()) return upNext(2).map(l => `${trackName(l.track)}: ${l.title}`);
  return (day(key).slots || []).map(s => `at ${s.start}: ${slotTitle(s)}`);
}
