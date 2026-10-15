// The Yaver Course: all the logic shared by the Study/Course/Lesson screens and
// the AI tutor's tools. Content (course.json + one file per week) is bundled in
// data/course/ and cached offline; progress, review cards, test results and
// AI-generated weeks live in IndexedDB like everything else.
import * as db from './db.js';
import * as D from './data.js';
import { today, addDays, parseDay, dayKey } from './util.js';

let META = null;
const BUNDLED = new Map(); // week -> lessons[]
let loading = null;

// ---------- Loading ----------
export function init() {
  if (loading) return loading;
  loading = (async () => {
    META = await (await fetch('data/course/course.json')).json();
    await Promise.all(META.weeks.filter(w => w.file).map(async w => {
      try {
        const res = await fetch(`data/course/${w.file}`);
        if (res.ok) BUNDLED.set(w.week, (await res.json()).lessons || []);
      } catch {}
    }));
    rebuildIndex();
    window.dispatchEvent(new Event('course-ready'));
  })().catch(e => { loading = null; console.warn('course load failed', e); throw e; });
  return loading;
}
export const ready = () => !!META;
export const meta = () => META;

// Index: all lessons (bundled win over generated for the same week), by id and by lane in seq order.
let byId = new Map();
let byLane = new Map();
let indexedAt = -1;
function rebuildIndex() {
  byId = new Map();
  const bundledWeeks = new Set(BUNDLED.keys());
  const lessons = [...[...BUNDLED.values()].flat()];
  for (const row of db.all('courseLessons')) if (!bundledWeeks.has(row.week)) lessons.push({ ...row, id: row.lessonId || row.id, generated: true });
  lessons.sort((a, b) => a.week - b.week || a.seq - b.seq);
  byLane = new Map();
  for (const l of lessons) {
    byId.set(l.id, l);
    if (!byLane.has(l.lane)) byLane.set(l.lane, []);
    byLane.get(l.lane).push(l);
  }
  indexedAt = db.all('courseLessons').length;
}
function idx() { if (indexedAt !== db.all('courseLessons').length) rebuildIndex(); }
export const lesson = id => { idx(); return byId.get(id) || virtualLesson(id); };
export const laneLessons = lane => { idx(); return byLane.get(lane) || []; };
export const track = id => META.tracks.find(t => t.id === id) || { id, name: id, color: 'var(--dim)' };
export const trackName = id => track(id).name;
export const weekMeta = n => META.weeks.find(w => w.week === n);

// ---------- Settings ----------
const DEFAULTS = { active: false, start: '2026-10-19', slots: {}, showWork: false, teachBy: {} };
export const settings = () => ({ ...DEFAULTS, ...db.setting('course', {}) });
export const saveSettings = patch => db.setSetting('course', { ...settings(), ...patch });
export const active = () => settings().active;

export async function activate() {
  await saveSettings({ active: true });
  const weekday = slotsFor('weekday').filter(s => s.type === 'lesson' || s.type === 'review');
  await db.setSetting('dailyStudyMin', weekday.reduce((a, s) => a + s.minutes, 0) - 20);
  await db.setSetting('streakMin', 60);
}
export const MINIMUM_DAY = '60 minutes: review cards plus one lesson. Never miss two days in a row.';

// ---------- Calendar maths ----------
const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const fromMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const nowMin = (d = new Date()) => d.getHours() * 60 + d.getMinutes();
const dow = key => (parseDay(key).getDay() + 6) % 7; // Mon = 0 … Sun = 6
const dayKind = key => (dow(key) < 5 ? 'weekday' : dow(key) === 5 ? 'sat' : 'sun');
const DAY = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function weekOf(key = today()) {
  const start = settings().start || META.start;
  if (key >= start) return Math.floor((parseDay(key) - parseDay(start)) / (7 * 86400000) + 1e-9) + 1;
  if (key >= addDays(start, -4)) return 0;
  return -1;
}
export const weekStartKey = n => addDays(settings().start || META.start, 7 * (n - 1));
export const phaseOf = n => META.phases.find(p => n >= p.weeks[0] && n <= p.weeks[1]) || null;
export const isConsolidation = n => META.consolidation.includes(n);

// Slot template for a kind of day, with the user's time overrides applied.
export function slotsFor(kind) {
  const over = settings().slots?.[kind] || {};
  return META.slots[kind].map(s => {
    const o = over[s.id] || {};
    const start = o.start || s.start, end = o.end || s.end;
    return { ...s, start, end, minutes: toMin(end) - toMin(start) };
  }).sort((a, b) => toMin(a.start) - toMin(b.start));
}

// Refuse templates that cut into the protected sleep window.
export function checkSlotTimes(kind, overrides) {
  const sleepEnd = toMin(META.sleep.end), sleepStart = toMin(META.sleep.start);
  const list = META.slots[kind].map(s => ({ ...s, ...(overrides[s.id] || {}) }));
  for (const s of list) {
    const a = toMin(s.start), b = toMin(s.end);
    if (!(a < b)) return `${s.label}: end must be after start.`;
    if (a < sleepEnd || b > sleepStart) return `${s.label} would cut into sleep (${META.sleep.start}–${META.sleep.end} stays protected, 7 hours).`;
  }
  const sorted = list.filter(s => s.type !== 'info').sort((x, y) => toMin(x.start) - toMin(y.start));
  for (let i = 1; i < sorted.length; i++) if (toMin(sorted[i].start) < toMin(sorted[i - 1].end)) return `${sorted[i].label} overlaps ${sorted[i - 1].label}.`;
  return null;
}

// ---------- Progress ----------
export const progress = id => db.get('courseProgress', id) || null;
const completed = id => ['done', 'flagged'].includes(progress(id)?.status);
export function status(id) {
  const p = progress(id);
  if (!p) return 'todo';
  if (p.status === 'flagged') return 'flagged';
  if (p.status === 'done') return 'done';
  return 'in progress';
}
// The lane's next unfinished lesson (never skip, just shift).
export function nextInLane(lane) {
  return laneLessons(lane).find(l => !completed(l.id)) || null;
}
export const doneInLane = lane => laneLessons(lane).filter(l => completed(l.id)).length;

// Which week needs preparing when a lane has run out of lessons.
export function weekToPrepare() {
  idx();
  const have = new Set([...byId.values()].map(l => l.week));
  for (const w of META.weeks) if (w.week >= 16 && !w.consolidation && !have.has(w.week)) return w.week;
  return null;
}
export const hasWeek = n => { idx(); return [...byId.values()].some(l => l.week === n); };

// ---------- Pace ----------
// Sessions of a lane scheduled from week 1 up to now (consolidation weeks don't count).
export function expected(lane, at = new Date()) {
  const key = dayKey(at), w = weekOf(key);
  let n = 0;
  for (let wk = 1; wk <= Math.min(w, 63); wk++) {
    if (isConsolidation(wk)) continue;
    const ph = phaseOf(wk);
    if (!ph) continue;
    for (let d = 0; d < 6; d++) {
      const k = addDays(weekStartKey(wk), d);
      if (k > key) break;
      const kind = d < 5 ? 'weekday' : 'sat';
      for (const s of slotsFor(kind)) {
        if (ph.rotation[s.id]?.[d] !== lane) continue;
        if (k < key || toMin(s.end) <= nowMin(at)) n++;
      }
    }
  }
  return n;
}
export function weeklySessions(trackId, w = Math.max(1, weekOf())) {
  const ph = phaseOf(w) || META.phases[0];
  return Object.values(ph.rotation).flat().filter(l => l && META.lanes[l]?.track === trackId).length;
}
export function pace(at = new Date()) {
  const out = {};
  for (const [lane, def] of Object.entries(META.lanes)) {
    if (lane === 'setup') continue;
    const e = expected(lane, at), d = doneInLane(lane);
    if (!e && !d) continue;
    const t = (out[def.track] ||= { track: def.track, name: trackName(def.track), expected: 0, done: 0, lanes: {} });
    t.expected += e; t.done += d; t.lanes[lane] = { expected: e, done: d };
  }
  for (const t of Object.values(out)) {
    t.behind = Math.max(0, t.expected - t.done);
    t.ahead = Math.max(0, t.done - t.expected);
    t.label = t.behind ? `${t.behind} behind` : t.ahead ? `${t.ahead} ahead` : 'on plan';
    t.color = !t.behind ? 'green' : t.behind < weeklySessions(t.track) ? 'yellow' : 'red';
  }
  return out;
}

// ---------- Teaching deadlines ----------
export const teachBy = l => settings().teachBy?.[l.id] ?? l.teachBy ?? null;
export async function setTeachBy(id, date) {
  const tb = { ...settings().teachBy, [id]: date || null };
  await saveSettings({ teachBy: tb });
}
export function deadlines(within = 7, key = today()) {
  idx();
  const out = [];
  for (const l of laneLessons('robo-prep').concat(laneLessons('robo-lab'))) {
    const d = teachBy(l);
    if (!d || completed(l.id)) continue;
    const days = Math.round((parseDay(d) - parseDay(key)) / 86400000);
    if (days <= within) out.push({ lessonId: l.id, title: l.title, teachBy: d, days });
  }
  return out.sort((a, b) => a.teachBy.localeCompare(b.teachBy));
}

// ---------- Today ----------
// Every slot of a day, each with the lesson it holds right now.
export function day(key = today()) {
  const w = weekOf(key);
  const kind = dayKind(key);
  const ph = phaseOf(w);
  const cons = isConsolidation(w);
  const base = { date: key, week: w, kind, phase: ph?.id || null, phaseName: ph?.name || '', consolidation: cons, slots: [] };
  if (w < 0) return { ...base, beforeStart: true };
  const all = slotsFor(kind).filter(s => s.type !== 'fixed' || settings().showWork);
  if (w === 0) {
    const l = nextInLane('setup');
    base.slots = all.filter(s => s.type === 'info' || s.id === 'deep1' || s.type === 'review')
      .map(s => (s.id === 'deep1' ? withLesson({ ...s, end: fromMin(toMin(s.start) + (l?.minutes || 90)), minutes: l?.minutes || 90, label: 'Week 0 · setup' }, l, w) : s));
    return base;
  }
  const d = dow(key);
  for (const s of all) {
    if (s.type === 'info' || s.type === 'fixed' || s.type === 'review' || s.type === 'plan') { base.slots.push(s); continue; }
    if (s.type === 'test' || s.type === 'ship') { base.slots.push({ ...s, special: s.type }); continue; }
    if (cons) { const c = consolidationSlot(s, kind, w, key); if (c) base.slots.push(c); continue; }
    const lane = ph?.rotation[s.id]?.[d];
    if (!lane) continue;
    if (lane === 'mixed') { base.slots.push({ ...s, special: 'mixed', lesson: mixedLesson(key), lane, track: 'mixed' }); continue; }
    if (lane === 'buffer') { base.slots.push(bufferSlot(s, w, key)); continue; }
    base.slots.push(withLesson({ ...s, lane, track: META.lanes[lane].track }, nextInLane(lane), w, lane));
  }
  return base;
}

function withLesson(s, l, w, lane = s.lane) {
  if (!l) {
    const n = weekToPrepare();
    return { ...s, lane, track: s.track || META.lanes[lane]?.track, prepare: n, status: 'prepare' };
  }
  const tb = l.track === 'robo' ? teachBy(l) : null;
  const urgent = tb && !completed(l.id) && (parseDay(tb) - parseDay(today())) / 86400000 <= 7;
  return { ...s, lane: l.lane, track: l.track, lesson: l, status: status(l.id), ahead: l.week > w, urgent: !!urgent, teachBy: tb };
}

function bufferSlot(s, w, key) {
  // 1) a flagged lesson waiting for a second go, 2) the most-behind track, 3) the nearest teaching deadline.
  const flagged = db.all('courseProgress').filter(p => p.status === 'flagged').sort((a, b) => a.completedAt.localeCompare(b.completedAt))[0];
  if (flagged && lesson(flagged.lessonId)) return { ...withLesson({ ...s, special: 'buffer', reason: 'redo a flagged lesson' }, lesson(flagged.lessonId), w), status: 'flagged' };
  const p = Object.values(pace(new Date(`${key}T${s.start}`)));
  let worst = null;
  for (const t of p) for (const [lane, v] of Object.entries(t.lanes)) {
    const behind = v.expected - v.done;
    if (behind > 0 && (!worst || behind > worst.behind)) worst = { lane, behind };
  }
  if (worst && nextInLane(worst.lane)) return withLesson({ ...s, special: 'buffer', reason: `${trackName(META.lanes[worst.lane].track)} is ${worst.behind} behind` }, nextInLane(worst.lane), w, worst.lane);
  const dl = deadlines(60, key)[0];
  if (dl) { const l = lesson(dl.lessonId); return withLesson({ ...s, special: 'buffer', reason: `teaching deadline ${dl.teachBy}` }, nextInLane(l.lane) || l, w, l.lane); }
  return { ...s, special: 'buffer', free: true, track: null, label: 'Buffer · free, or read ahead' };
}

function consolidationSlot(s, kind, w, key) {
  if (kind === 'sat') return s.id === 'build' ? { ...s, special: 'consolidate', track: 'build', task: 'Finish and document the projects: READMEs, tests, a clean commit history.' } : null;
  const tasks = {
    deep1: w === 6 ? 'Retake the Week 0 diagnostic, then compare with your first score.' : 'Retake an earlier weekly test: the one with your lowest score.',
    deep2: 'Redo flagged practice tasks without notes.',
    build: 'Finish and document projects.',
  };
  if (tasks[s.id]) return { ...s, special: 'consolidate', track: s.id === 'build' ? 'build' : null, task: tasks[s.id], diagnostic: w === 6 && s.id === 'deep1' };
  // Teaching prep still appears when a deadline needs it.
  if (s.id === 'prep') { const dl = deadlines(21, key)[0]; if (dl) return withLesson({ ...s, lane: 'robo-prep', track: 'robo' }, nextInLane('robo-prep'), w); }
  return null;
}

// The slot that is on now or next (for Home).
export function nextBlock(at = new Date()) {
  for (let i = 0; i < 3; i++) {
    const k = addDays(dayKey(at), i);
    const d = day(k);
    for (const s of d.slots || []) {
      if (s.type === 'info' || s.type === 'fixed') continue;
      if (i === 0 && toMin(s.end) <= nowMin(at)) continue;
      return { ...s, date: k };
    }
  }
  return null;
}

export function slotTitle(s) {
  if (s.special === 'test') return 'Weekly test';
  if (s.special === 'ship') return 'Ship & weekly review';
  if (s.special === 'mixed') return 'Mixed practice';
  if (s.special === 'consolidate') return s.task;
  if (s.type === 'review') return 'Review cards · log · plan tomorrow';
  if (s.type === 'plan') return "Confirm Monday's first block";
  if (s.prepare) return `Prepare week ${s.prepare}`;
  if (s.free) return s.label;
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
  if (!p || p.status === 'flagged') await db.put('courseProgress', { ...(p || {}), id, lessonId: id, status: p?.status === 'flagged' ? 'flagged' : 'in progress', startedAt: new Date().toISOString(), attempts: (p?.attempts || 0) + 1 });
  await db.setSetting('lessonTimer', { lessonId: id, start: Date.now(), plannedMin: l.minutes });
}

export async function completeLesson({ lessonId, minutes, score = null, notes = '', hintsUsed = 0, solutionsRevealed = 0 }) {
  const l = lesson(lessonId);
  if (!l) throw new Error('No lesson with that id');
  const t = db.setting('lessonTimer', null);
  const p = progress(lessonId) || {};
  if (minutes == null) minutes = t?.lessonId === lessonId ? Math.max(1, Math.round((Date.now() - t.start) / 60000)) : l.minutes;
  minutes = Math.max(1, Math.round(Number(minutes)));
  if (score != null) score = Math.max(0, Math.min(1, Number(score) > 1 ? Number(score) / 100 : Number(score)));
  const mastered = score == null || score >= META.masteryThreshold;
  const row = {
    ...p, id: lessonId, lessonId, track: l.track, lane: l.lane, week: l.week,
    status: mastered ? 'done' : 'flagged', startedAt: p.startedAt || (t?.lessonId === lessonId ? new Date(t.start).toISOString() : new Date(Date.now() - minutes * 60000).toISOString()),
    completedAt: new Date().toISOString(), minutes: (p.status === 'flagged' ? (p.minutes || 0) : 0) + minutes, score, mastered,
    hintsUsed: (p.hintsUsed || 0) + hintsUsed, solutionsRevealed: (p.solutionsRevealed || 0) + solutionsRevealed, notes: notes || p.notes || '',
  };
  await db.put('courseProgress', row);
  if (!l.virtual) await D.logStudy({ subject: trackName(l.track), minutes, note: l.title });
  else await D.logStudy({ subject: l.subject || 'Course', minutes, note: l.title });
  await addCards(l);
  if (t?.lessonId === lessonId) await db.setSetting('lessonTimer', null);
  const next = l.virtual ? null : nextInLane(l.lane);
  return { status: row.status, mastered, score, minutes, next: next && { id: next.id, title: next.title, week: next.week } };
}

export async function resetLesson(id) {
  await db.remove('courseProgress', id);
}

// ---------- Mixed practice (Sat deep2) and weekly test (Sun) ----------
function rng(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
function shuffle(arr, r) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
// Reorder so consecutive items come from different groups where possible.
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
  const per = tasks.length ? Math.max(5, Math.floor(75 / tasks.length)) : 0;
  return {
    id: `mixed-${key}`, virtual: true, kind: 'mixed', track: 'mixed', subject: 'Mixed practice', lane: 'mixed', week: weekOf(key), minutes: 90,
    title: 'Mixed practice', objectives: ['Recognise which method a problem needs without being told the topic', 'Solve problems from different tracks back to back'],
    resources: [],
    steps: [
      { kind: 'warmup', minutes: 15, title: 'Review cards', cardIds: cards.map(c => c.id), body: cards.length ? 'Five due cards, mixed across tracks.' : 'No cards due. Recall one idea from each track this week and write it down.' },
      { kind: 'practice', minutes: 75, title: tasks.length ? `${tasks.length} mixed problems` : 'Mixed problems', tasks: tasks.length ? tasks : [{ prompt: 'No practice from the last 14 days yet. Pick two exercises from this week\'s lessons in different tracks and solve them without notes.', hints: ['Start with the one you feel least sure about.'], check: 'You can explain why your solution works.', solution: '' }], body: 'Topics alternate on purpose: before each problem, name the method first, then solve it. Time-box each one.' },
    ],
    cards: [], deliverable: 'Solutions in learning-log/mixed/' + key + '.md',
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
  const earlier = shuffle(db.all('cards').filter(c => { const l = lesson(c.lessonId); return l && l.week < w; }), r)
    .slice(0, Math.max(3, Math.round(qs.length / 3))).map(c => ({ track: c.track, lessonId: c.lessonId, q: c.front, a: c.back, card: c.id }));
  let all = [...shuffle(qs, r).slice(0, 24), ...earlier].slice(0, 30);
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

// Diagnostic (Week 0, retaken in Week 6).
export async function recordDiagnostic(results) {
  const prev = db.setting('courseDiagnostic', []);
  await db.setSetting('courseDiagnostic', [...prev, { date: today(), week: weekOf(), results }]);
}
export const diagnosticHistory = () => db.setting('courseDiagnostic', []);

function virtualLesson(id) {
  if (String(id).startsWith('mixed-')) return mixedLesson(id.slice(6));
  return null;
}

// ---------- Progress summary (Course screen + AI) ----------
export function progressSummary() {
  idx();
  const p = pace();
  const tracks = META.tracks.map(t => {
    const lessons = [...byId.values()].filter(l => l.track === t.id && l.lane !== 'setup');
    const rows = lessons.map(l => progress(l.id)).filter(Boolean).filter(x => ['done', 'flagged'].includes(x.status));
    const scored = rows.filter(x => x.score != null);
    return {
      track: t.id, name: t.name, color: t.color, done: rows.length, total: lessons.length,
      pace: p[t.id]?.label || 'not started', paceColor: p[t.id]?.color || 'green', behind: p[t.id]?.behind || 0,
      masteryRate: scored.length ? Math.round((scored.filter(x => x.score >= META.masteryThreshold).length / scored.length) * 100) : null,
      flagged: rows.filter(x => x.status === 'flagged').map(x => ({ id: x.lessonId, title: lesson(x.lessonId)?.title })),
    };
  });
  return { week: weekOf(), tracks, cardsDue: dueCount(), tests: testResults(), consolidationWeeks: META.consolidation, deadlines: deadlines(30), diagnostic: diagnosticHistory() };
}

// ---------- Generated weeks (16+) ----------
export function validateLessons(week, lessons) {
  const errors = [];
  const w = weekMeta(week);
  if (!w) return [`week ${week} is not in the course`];
  if (week < 16) errors.push('weeks 0–15 are bundled; only weeks 16 and later can be generated');
  if (w.consolidation) errors.push(`week ${week} is a consolidation week: it has no lessons`);
  if (!Array.isArray(lessons) || !lessons.length) return [...errors, 'lessons must be a non-empty list'];
  const ph = phaseOf(week);
  const want = {};
  for (const row of Object.values(ph.rotation)) for (const lane of row) if (lane && META.lanes[lane]) want[lane] = (want[lane] || 0) + 1;
  const have = {};
  const ids = new Set();
  for (const [i, l] of lessons.entries()) {
    const at = `lessons[${i}] (${l?.id || 'no id'})`;
    if (!l || typeof l !== 'object') { errors.push(`${at}: not an object`); continue; }
    have[l.lane] = (have[l.lane] || 0) + 1;
    const lane = META.lanes[l.lane];
    if (!lane) { errors.push(`${at}: unknown lane ${l.lane}`); continue; }
    if (ids.has(l.id)) errors.push(`${at}: duplicate id`);
    ids.add(l.id);
    if (!new RegExp(`^${lane.track}-w${String(week).padStart(2, '0')}-[a-z0-9]+$`).test(l.id || '')) errors.push(`${at}: id must be ${lane.track}-w${String(week).padStart(2, '0')}-<k>`);
    if (l.track !== lane.track) errors.push(`${at}: track must be ${lane.track}`);
    if (l.minutes !== lane.minutes) errors.push(`${at}: minutes must be ${lane.minutes}`);
    if (l.kind !== lane.kind) errors.push(`${at}: kind must be ${lane.kind}`);
    if (!l.title) errors.push(`${at}: title missing`);
    if (!Array.isArray(l.objectives) || l.objectives.length < 2 || l.objectives.length > 4) errors.push(`${at}: 2–4 objectives`);
    if (!Array.isArray(l.cards) || l.cards.length < 3 || l.cards.length > 6) errors.push(`${at}: 3–6 cards`);
    const tpl = template(l.kind, l.minutes);
    const got = (l.steps || []).map(s => `${s.kind}:${s.minutes}`).join(' ');
    const exp = tpl.map(([k, m]) => `${k}:${m}`).join(' ');
    if (got !== exp) errors.push(`${at}: steps must be exactly "${exp}" (got "${got}")`);
    for (const s of l.steps || []) {
      if (s.kind === 'exit' && (!Array.isArray(s.questions) || s.questions.length < 3 || s.questions.length > 5)) errors.push(`${at}: exit needs 3–5 questions with answers`);
      if (s.kind === 'practice' && (!Array.isArray(s.tasks) || s.tasks.length < 2 || s.tasks.some(t => !t.prompt || !t.check))) errors.push(`${at}: practice needs 2–5 tasks, each with prompt and check`);
    }
    for (const r of l.resources || []) if (!/^https:\/\//.test(r.url || '')) errors.push(`${at}: resource urls must be https`);
  }
  for (const lane of new Set([...Object.keys(want), ...Object.keys(have)])) if ((want[lane] || 0) !== (have[lane] || 0)) errors.push(`lane ${lane}: ${have[lane] || 0} lessons, the rotation needs ${want[lane] || 0}`);
  return errors;
}

export async function saveWeekLessons(week, lessons) {
  const errors = validateLessons(week, lessons);
  if (errors.length) return { saved: false, errors };
  for (const old of db.all('courseLessons').filter(r => r.week === week)) await db.remove('courseLessons', old.id);
  // seq continues each lane from the lessons before this week.
  const seqStart = {};
  for (const l of lessons) {
    if (seqStart[l.lane] == null) seqStart[l.lane] = laneLessons(l.lane).filter(x => x.week < week).length;
    seqStart[l.lane]++;
    await db.put('courseLessons', { ...l, id: l.id, lessonId: l.id, week, seq: seqStart[l.lane], teachBy: l.teachBy ?? null, safety: l.safety ?? null, generatedAt: new Date().toISOString() });
  }
  rebuildIndex();
  return { saved: true, count: lessons.length };
}

export function template(kind, minutes) {
  switch (kind) {
    case 'deep': return [['warmup', 10], ['pretest', 5], ['learn', 35], ['practice', 30], ['exit', 10]];
    case 'practice': return [['warmup', 5], ['learn', 10], ['practice', 60], ['reflect', 10], ['exit', 5]];
    case 'build': return [['plan', 10], ['build', minutes - 25], ['test', 10], ['log', 5]];
    case 'prep': return [['learn', 15], ['simulate', 20], ['measure', 15], ['teachnotes', 10]];
    case 'lab': return [['build', 60], ['measure', 25], ['handout', 25], ['exit', 10]];
    case 'light': return minutes === 90 ? [['read', 65], ['summary', 10], ['cards', 15]] : [['read', 40], ['summary', 10], ['cards', 10]];
    default: return [];
  }
}

// What the AI needs to write week N: the outline plus each lane's session count and the lesson before.
export function weekBrief(week) {
  const w = weekMeta(week);
  const ph = phaseOf(week);
  const lanes = {};
  for (const [slot, row] of Object.entries(ph.rotation)) row.forEach((lane, d) => {
    if (!lane || !META.lanes[lane]) return;
    (lanes[lane] ||= { ...META.lanes[lane], sessions: [], previous: null }).sessions.push(`${DAY[d]} ${slot}`);
  });
  for (const [lane, v] of Object.entries(lanes)) { const prev = laneLessons(lane).filter(l => l.week < week).at(-1); v.previous = prev ? { id: prev.id, title: prev.title, week: prev.week } : null; }
  return { week, start: weekStartKey(week), theme: w.theme, phase: ph.name, outline: w.outline, lanes, stepTemplates: Object.fromEntries(['deep', 'practice', 'build', 'prep', 'lab', 'light'].map(k => [k, template(k, k === 'build' ? 90 : 60)])) };
}

// ---------- Calendar export ----------
export function weekEvents(w = weekOf(), { includeWork = settings().showWork } = {}) {
  const events = [];
  const from = w === 0 ? today() : weekStartKey(w);
  const to = w === 0 ? addDays(settings().start || META.start, -1) : addDays(from, 6);
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const d = day(k);
    for (const s of d.slots || []) {
      if (s.type === 'info' || (s.type === 'fixed' && !includeWork)) continue;
      const [y, m, dd] = k.split('-').map(Number);
      const [sh, sm] = s.start.split(':').map(Number), [eh, em] = s.end.split(':').map(Number);
      const start = new Date(y, m - 1, dd, sh, sm), end = new Date(y, m - 1, dd, eh, em);
      events.push({ id: `course-${k}-${s.id}`, title: `${slotName(s)} · ${slotTitle(s)}`, start: start.toISOString(), end: end.toISOString(), notes: (s.lesson?.objectives || []).join('\n'), remind: 5 });
    }
  }
  return events;
}
const slotName = s => ({ deep1: 'Deep 1', deep2: 'Deep 2', build: 'Build', prep: 'Prep', light: 'Light', lab: 'Lab', review: 'Review', test: 'Test', ship: 'Ship', plan: 'Plan', work: 'Work', students: 'Students' }[s.id] || s.label);

// Evening review: a two-line log and tomorrow's plan, confirmed (implementation intention).
export const dayLog = (key = today()) => db.setting(`courseLog:${key}`, null);
export const saveDayLog = (key, v) => db.setSetting(`courseLog:${key}`, { ...v, at: new Date().toISOString() });
export function planFor(key) {
  return (day(key).slots || []).filter(s => s.type !== 'info' && s.type !== 'fixed').map(s => `at ${s.start}: ${slotTitle(s)}`);
}
