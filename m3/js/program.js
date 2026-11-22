// The study program (Yaver M III). The user chooses what to learn, how well they know it,
// how much it matters and when they can study; everything else is built from that choice:
// the lessons (one per topic), the weekly timetable, pace, review cards and tests. It adapts:
// a subject with weak scores, lessons to redo or "too hard" ratings gets more of the week,
// and one rated "too easy" again and again gets less, and is suggested a level up.
// The program is one synced setting ('program'); AI-written lesson content lives in the
// courseLessons store under the same lesson ids, so it syncs too.
import * as db from './db.js';
import { today, addDays, parseDay } from './util.js';

export const PALETTE = ['#4f8cff', '#a274ff', '#ff9f43', '#22b8a7', '#6cc04a', '#ff6b6b', '#e8b31c', '#ec5fa8', '#8e9aaf'];
export const LEVELS = [['new', 'New to me'], ['some', 'I know some'], ['good', 'I know it well']];
export const PRIORITIES = [[1, 'Low'], [2, 'Normal'], [3, 'High']];
export const LENGTHS = [25, 45, 60, 90];
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_TIMES = ['19:00', '07:00', '13:00'];

// Starting points. Each one only fills the form: every subject and topic can be changed.
export const PRESETS = [
  { id: 'code', name: 'Learn to code', icon: 'terminal', goal: 'Write real programs with confidence', subjects: [
    ['Python', ['Variables and types', 'Conditions and loops', 'Functions', 'Lists and dictionaries', 'Strings and files', 'Errors and debugging', 'Modules and packages', 'Classes and objects', 'Testing your code', 'A small project']],
    ['Algorithms', ['Big-O: how code grows', 'Arrays and two pointers', 'Hash maps', 'Stacks and queues', 'Recursion', 'Binary search', 'Sorting', 'Trees', 'Graphs and BFS/DFS', 'Dynamic programming basics']],
    ['Tools', ['The terminal', 'Git basics', 'Branches and pull requests', 'Your editor and debugger', 'Reading documentation']],
  ] },
  { id: 'data', name: 'Data science and AI', icon: 'chart', goal: 'Analyse data and build machine learning models', subjects: [
    ['Python for data', ['NumPy arrays', 'pandas DataFrames', 'Cleaning data', 'Grouping and joining', 'Plotting', 'A data analysis project']],
    ['Math', ['Vectors and matrices', 'Derivatives and gradients', 'Probability', 'Distributions', 'Statistics and testing', 'Linear regression by hand']],
    ['Machine learning', ['What learning from data means', 'Train, validate, test', 'Linear and logistic regression', 'Trees and forests', 'Overfitting and regularisation', 'Neural networks', 'Training a network', 'Evaluating models', 'An end-to-end project']],
  ] },
  { id: 'language', name: 'A new language', icon: 'chat', goal: 'Hold a real conversation', subjects: [
    ['Vocabulary', ['Greetings and introductions', 'Numbers, days and time', 'Food and shopping', 'Travel and directions', 'Work and study', 'Feelings and opinions', 'Health and the body', 'Home and family']],
    ['Grammar', ['Pronouns and the verb to be', 'Present tense', 'Questions and negatives', 'Past tense', 'Future', 'Adjectives and comparisons', 'Connecting sentences']],
    ['Listening and speaking', ['Introduce yourself', 'Order in a café', 'Ask for directions', 'Talk about your day', 'Describe a picture', 'Tell a short story']],
  ] },
  { id: 'exam', name: 'Exam preparation', icon: 'check', goal: 'Pass the exam with a good score', subjects: [
    ['Mathematics', ['Numbers and algebra', 'Equations and inequalities', 'Functions and graphs', 'Geometry', 'Probability and statistics', 'Mixed past-paper questions']],
    ['Science', ['Key definitions', 'Core processes', 'Formulas and units', 'Experiments and data', 'Mixed past-paper questions']],
    ['Reading and writing', ['Reading for the main idea', 'Inference questions', 'Vocabulary in context', 'Structuring an essay', 'Timed practice']],
    ['Practice tests', ['Full practice test 1', 'Review mistakes', 'Full practice test 2', 'Review mistakes', 'Full practice test 3']],
  ] },
  { id: 'school', name: 'My school or university courses', icon: 'book', goal: 'Keep up with my courses and do well in exams', subjects: [] },
  { id: 'custom', name: 'Something else', icon: 'sparkle', goal: '', subjects: [] },
];

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10);
export const newId = () => Math.random().toString(36).slice(2, 7);
const topic = t => (typeof t === 'string' ? { id: newId(), t } : t);

export function mondayOf(key = today()) {
  const d = (parseDay(key).getDay() + 6) % 7;
  return addDays(key, -d);
}

/** A complete program from a preset (or blank). Ids are fresh, so two programs never share lessons. */
export function fromPreset(id) {
  const p = PRESETS.find(x => x.id === id) || PRESETS.at(-1);
  return normalize({
    title: p.id === 'custom' || p.id === 'school' ? '' : p.name, goal: p.goal, preset: p.id,
    subjects: p.subjects.map(([name, topics], i) => ({ name, color: PALETTE[i % PALETTE.length], topics })),
  });
}

/** Fill every missing field with a sensible default and give subjects and topics stable ids. */
export function normalize(p = {}) {
  const subjects = (p.subjects || []).filter(s => s && String(s.name || '').trim()).map((s, i) => ({
    id: s.id || `${slug(s.name) || 's'}${newId().slice(0, 3)}`,
    name: String(s.name).trim(),
    color: s.color || PALETTE[i % PALETTE.length],
    level: ['new', 'some', 'good'].includes(s.level) ? s.level : 'new',
    priority: [1, 2, 3].includes(Number(s.priority)) ? Number(s.priority) : 2,
    topics: (s.topics || []).map(topic).filter(t => t && String(t.t || '').trim()).map(t => ({ id: t.id || newId(), t: String(t.t).trim() })),
    resources: (s.resources || []).filter(r => r && /^https:\/\//.test(r.url || '')).map(r => ({ title: r.title || r.url, url: r.url })),
    paused: !!s.paused,
  }));
  const days = Array.isArray(p.days) && p.days.length === 7 ? p.days.map(Boolean) : [true, true, true, true, true, false, false];
  const perDay = Math.max(1, Math.min(3, Number(p.perDay) || 1));
  const times = [...(p.times || []), ...DEFAULT_TIMES].slice(0, 3).map(t => (/^\d\d:\d\d$/.test(t) ? t : '19:00'));
  return {
    v: 1,
    title: String(p.title || '').trim() || 'My study program',
    goal: String(p.goal || '').trim(),
    preset: p.preset || 'custom',
    subjects,
    days: days.some(Boolean) ? days : [true, true, true, true, true, false, false],
    perDay, times,
    minutes: LENGTHS.includes(Number(p.minutes)) ? Number(p.minutes) : 45,
    pacing: p.pacing === 'schedule' ? 'schedule' : 'self',
    start: p.start && parseDay(p.start).getDay() === 1 ? p.start : mondayOf(p.start || today()),
    style: p.style === 'full' ? 'full' : 'do',
    weeklyTest: p.weeklyTest !== false,
    reviewEvery: [0, 4, 6, 8].includes(Number(p.reviewEvery)) ? Number(p.reviewEvery) : 0,
    adaptive: p.adaptive !== false,
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ---------- Reading and saving ----------
let cache = { raw: undefined, prog: null };
export function get() {
  const raw = db.setting('program', null);
  if (raw !== cache.raw) cache = { raw, prog: raw ? normalize(raw) : null };
  return cache.prog;
}
export const exists = () => !!get()?.subjects.length;
export async function save(p) {
  const prog = normalize(p);
  await db.setSetting('program', prog);
  // a new timetable starts fresh; past weeks keep the rotation they had
  const frozen = db.setting('programWeeks', {});
  const keep = {};
  for (const [w, v] of Object.entries(frozen)) if (Number(w) < currentWeek(prog)) keep[w] = v;
  await db.setSetting('programWeeks', keep);
  // the daily study goal follows the plan
  const sessionsPerWeek = prog.days.filter(Boolean).length * prog.perDay;
  await db.setSetting('dailyStudyMin', Math.round((sessionsPerWeek * prog.minutes) / 7 / 5) * 5 || 30);
  await db.setSetting('streakMin', Math.min(prog.minutes, 30));
  return prog;
}
export async function remove() {
  await db.setSetting('program', null);
  await db.setSetting('programWeeks', {});
}

export function currentWeek(p = get(), key = today()) {
  if (!p) return -1;
  if (key < p.start) return 0;
  return Math.floor((parseDay(key) - parseDay(p.start)) / (7 * 86400000) + 1e-9) + 1;
}

// ---------- The week: sessions and who gets them ----------
export const studyDays = (p = get()) => p.days.map((on, d) => (on ? d : -1)).filter(d => d >= 0);
export const sessionsPerWeek = (p = get()) => studyDays(p).length * p.perDay;
const active = p => p.subjects.filter(s => !s.paused);

/** Slots for a weekday (0 = Monday): the sessions at their times, a short review after the last, and the weekly test. */
export function slotsForDay(d, p = get()) {
  if (!p || !p.days[d]) return [];
  const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
  const fromMin = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const times = p.times.slice(0, p.perDay).sort();
  const out = times.map((t, i) => ({ id: `s${i + 1}`, type: 'lesson', label: p.perDay > 1 ? `Session ${i + 1}` : 'Study session', start: t, end: fromMin(Math.min(toMin(t) + p.minutes, 23 * 60 + 59)), minutes: p.minutes }));
  const last = out.at(-1);
  let at = toMin(last.end) + 5;
  out.push({ id: 'review', type: 'review', label: 'Review cards', start: fromMin(at), end: fromMin(at + 15), minutes: 15 });
  at += 20;
  if (p.weeklyTest && d === studyDays(p).at(-1)) out.push({ id: 'test', type: 'test', label: 'Weekly test', start: fromMin(at), end: fromMin(at + 30), minutes: 30 });
  return out.filter(s => toMin(s.end) > toMin(s.start));
}

/**
 * How much of the week each subject gets, and why. Without adaptation it is the priority
 * (low 1, normal 2, high 3). With it, recent results move it: mastery under 85%, lessons
 * flagged to redo, a weekly test under 75% and "too hard" ratings add time; "too easy" takes some away.
 */
export function weights(p = get()) {
  const out = {};
  for (const s of active(p)) {
    let factor = 1;
    const why = [];
    if (p.adaptive) {
      const rows = db.all('courseProgress').filter(r => r.track === s.id && ['done', 'flagged'].includes(r.status) && !r.skipped)
        .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')).slice(0, 8);
      const scored = rows.filter(r => r.score != null);
      const mastery = scored.length ? scored.reduce((a, r) => a + r.score, 0) / scored.length : null;
      if (mastery != null && mastery < 0.85) { factor += Math.min(0.6, (0.85 - mastery) * 1.5); why.push(`mastery ${Math.round(mastery * 100)}%`); }
      const flagged = db.all('courseProgress').filter(r => r.track === s.id && r.status === 'flagged').length;
      if (flagged) { factor += Math.min(3, flagged) * 0.15; why.push(`${flagged} to redo`); }
      const test = db.all('courseTests').sort((a, b) => b.week - a.week).map(t => (t.scores || []).find(x => x.track === s.id)).find(Boolean);
      if (test && test.total && test.right / test.total < 0.75) { factor += Math.min(0.5, 0.75 - test.right / test.total); why.push(`test ${Math.round((test.right / test.total) * 100)}%`); }
      const feel = rows.slice(0, 4).map(r => r.feel).filter(Boolean);
      const hard = feel.filter(f => f === 'hard').length, easy = feel.filter(f => f === 'easy').length;
      if (hard) { factor += hard * 0.12; why.push(`${hard} rated hard`); }
      if (easy >= 2) { factor -= Math.min(0.4, easy * 0.12); why.push(`${easy} rated easy`); }
    }
    out[s.id] = { weight: Math.max(0.3, s.priority * factor), base: s.priority, factor, why };
  }
  return out;
}

/** Spread the week's sessions over subjects in proportion to their weights, never the same subject twice in a row when it can be avoided. */
export function buildRotation(p = get(), { lessonsLeft = null, adaptive = true } = {}) {
  const ids = studyDays(p).flatMap(d => slotsForDay(d, p).filter(s => s.type === 'lesson').map(s => [d, s.id]));
  const w = adaptive ? weights(p) : Object.fromEntries(active(p).map(s => [s.id, { weight: s.priority }]));
  let subs = active(p).filter(s => !lessonsLeft || lessonsLeft[s.id] > 0);
  if (!subs.length) subs = active(p);
  const rotation = {};
  for (const s of slotsForDay(studyDays(p)[0] ?? 0, p)) if (s.type === 'lesson') rotation[s.id] = Array(7).fill(null);
  if (!subs.length || !ids.length) return rotation;
  const total = subs.reduce((a, s) => a + (w[s.id]?.weight || 1), 0);
  // largest remainder: every subject gets at least one session when there are enough
  const exact = subs.map(s => ({ id: s.id, q: ((w[s.id]?.weight || 1) / total) * ids.length }));
  const quota = Object.fromEntries(exact.map(e => [e.id, Math.floor(e.q)]));
  if (ids.length >= subs.length) for (const e of exact) if (!quota[e.id]) quota[e.id] = 1;
  let left = ids.length - Object.values(quota).reduce((a, b) => a + b, 0);
  for (const e of [...exact].sort((a, b) => (b.q % 1) - (a.q % 1))) { if (left <= 0) break; quota[e.id]++; left--; }
  while (left < 0) { const big = Object.entries(quota).sort((a, b) => b[1] - a[1])[0]; quota[big[0]]--; left++; }
  // deal out: the subject with most sessions still to place, not the one just placed
  let prev = null;
  for (const [d, sid] of ids) {
    const order = Object.entries(quota).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || (w[b[0]]?.weight || 0) - (w[a[0]]?.weight || 0));
    const pick = (order.find(([id]) => id !== prev) || order[0])?.[0];
    if (!pick) break;
    quota[pick]--;
    rotation[sid][d] = pick;
    prev = pick;
  }
  return rotation;
}

/** Sessions a subject gets in a plain (unadapted) week: used to place its topics into weeks. */
export function baseSessions(p = get()) {
  const rot = buildRotation(p, { adaptive: false });
  const out = {};
  for (const row of Object.values(rot)) for (const id of row) if (id) out[id] = (out[id] || 0) + 1;
  return out;
}

export const isReviewWeek = (w, p = get()) => !!p.reviewEvery && w > 0 && w % p.reviewEvery === 0;

/** The week a lesson falls in: its subject's topics spread over that subject's weekly sessions, review weeks skipped. */
export function weekForIndex(i, perWeek, p = get()) {
  const n = Math.max(1, perWeek || 1);
  let left = Math.floor(i / n), w = 1;
  for (;;) { if (!isReviewWeek(w, p)) { if (left === 0) return w; left--; } w++; if (w > 520) return w; }
}

// ---------- Lessons from topics ----------
const KIND = { new: 'deep', some: 'deep', good: 'practice' };
/** Step plan for a lesson length: warm-up, learn, practise, exit ticket, in proportion. */
export function stepPlan(kind, minutes) {
  const m = Math.max(15, minutes);
  if (kind === 'practice') { const w = Math.round(m * 0.1), l = Math.round(m * 0.15), e = Math.max(5, Math.round(m * 0.1)); return [['warmup', w], ['learn', l], ['practice', m - w - l - e], ['exit', e]]; }
  const w = Math.max(3, Math.round(m * 0.1)), l = Math.round(m * 0.35), e = Math.max(5, Math.round(m * 0.12));
  return [['warmup', w], ['learn', l], ['practice', m - w - l - e], ['exit', e]];
}

/** A lesson that works without AI: what to learn, a doing-first practice block and an exit ticket. "Write this lesson" replaces it with a full one. */
export function starterLesson(s, t, i, week, p = get(), prev = null) {
  const kind = KIND[s.level] || 'deep';
  const plan = stepPlan(kind, p.minutes);
  const res = s.resources.length ? `Use one good source and stay on it: ${s.resources.map(r => `[${r.title}](${r.url})`).join(', ')}.` : 'Pick one good source (a course chapter, the official docs, a textbook section or a short video) and stay on it.';
  const level = { new: 'This is new to you, so start from the idea itself and one small example.', some: 'You know some of this already: skim what you know and spend the time on the parts that feel shaky.', good: 'You know this well: skip the reading and go straight to harder practice.' }[s.level];
  const steps = plan.map(([k, m]) => {
    if (k === 'warmup') return { kind: k, minutes: m, title: 'Warm up', questions: prev ? [{ q: `From memory: what are the key ideas of "${prev.t}"?`, a: 'Check against your notes from that lesson.', from: `${s.id}-${prev.id}` }] : [], body: prev ? '' : 'First lesson in this subject: write down what you already know about it in two or three lines.' };
    if (k === 'learn') return { kind: k, minutes: m, title: `Learn: ${t.t}`, body: `${level}\n\n${res}\n\nRead or watch with a question in mind: *what problem does ${t.t} solve, and how would I use it?* Write the answer in your own words in the notes.\n\nWant a full lesson with explanations, worked examples and checked tasks? Tap **Write this lesson** and Yaver writes it for this topic and your level.` };
    if (k === 'practice') return { kind: k, minutes: m, title: 'Do it yourself', tasks: [
      { prompt: `Without looking, write the three most important ideas of **${t.t}**, then check them against your source and fix what was wrong.`, hints: ['Start with the one you are surest of.'], check: 'All three ideas match your source.' },
      { prompt: `Make or solve one example of **${t.t}** yourself, from a blank page.`, hints: ['Copy the shape of an example from your source, then change it.'], check: 'Your example works, or you can say exactly where it breaks.' },
      { prompt: `Use **${t.t}** on something a bit harder: a past question, an exercise from your source, or ask Yaver for one at your level.`, hints: ['Ask Yaver: "give me one exercise on this at my level".'], check: 'You solved it, or you know the one step you are missing.' },
    ] };
    return { kind: 'exit', minutes: m, title: 'Exit ticket', questions: [
      { q: `Explain ${t.t} in one or two sentences, as if to a friend.`, a: 'Right if it matches your source and uses no jargon you could not explain.' },
      { q: `Give one example where you would use ${t.t}.`, a: 'Right if the example really needs it.' },
      { q: `What is the most common mistake with ${t.t}?`, a: 'Right if you can name it and say how to avoid it.' },
    ] };
  });
  return {
    id: `${s.id}-${t.id}`, track: s.id, lane: s.id, week, seq: i + 1, kind, minutes: p.minutes, title: t.t, starter: true,
    objectives: [`Explain ${t.t} in your own words`, `Use ${t.t} in an example of your own`, 'Know what you still need to practise'],
    resources: s.resources.map(r => ({ ...r, type: 'link' })), steps, cards: [],
  };
}

/** Every lesson of the program, in order per subject, with AI-written content where it exists. */
export function lessons(p = get()) {
  if (!p) return [];
  const written = new Map(db.all('courseLessons').filter(r => r.program !== false).map(r => [r.lessonId || r.id, r]));
  const per = baseSessions(p);
  const out = [];
  for (const s of p.subjects) {
    s.topics.forEach((t, i) => {
      const week = weekForIndex(i, per[s.id], p);
      const base = starterLesson(s, t, i, week, p, s.topics[i - 1] || null);
      const w = written.get(base.id);
      out.push(w ? { ...base, ...w, id: base.id, track: s.id, lane: s.id, week, seq: i + 1, minutes: w.minutes || p.minutes, title: w.title || t.t, starter: false, written: true } : base);
    });
  }
  return out;
}

/** The weeks the program spans (at least 4, two past the last lesson), with their themes. */
export function weeks(p = get()) {
  if (!p) return [];
  const all = lessons(p);
  const last = Math.max(4, ...all.map(l => l.week + 2), currentWeek(p) + 1);
  return Array.from({ length: last }, (_, k) => {
    const n = k + 1;
    const start = addDays(p.start, 7 * k);
    const ls = all.filter(l => l.week === n);
    const review = isReviewWeek(n, p);
    return { week: n, start, end: addDays(start, 6), consolidation: review, theme: review ? 'Review week: redo what was flagged, retake your weakest test, no new topics.' : ls.slice(0, 4).map(l => l.title).join(' · ') + (ls.length > 4 ? ` +${ls.length - 4}` : '') };
  });
}

/** Plain-language notes on how the program is adapting right now (for Study and the AI). */
export function adaptNotes(p = get()) {
  if (!p) return [];
  const w = weights(p);
  const notes = [];
  for (const s of active(p)) {
    const x = w[s.id];
    if (!x) continue;
    if (x.factor > 1.05) notes.push({ track: s.id, text: `${s.name} gets more time: ${x.why.join(', ')}.` });
    else if (x.factor < 0.95) notes.push({ track: s.id, text: `${s.name} gets a little less time: ${x.why.join(', ')}.` });
    const lv = levelHint(s.id, p);
    if (lv) notes.push({ track: s.id, text: lv.text, level: lv.level });
  }
  return notes;
}

/** Suggest a level change when the last lessons were consistently too easy or too hard. */
export function levelHint(sid, p = get()) {
  const s = p.subjects.find(x => x.id === sid);
  if (!s) return null;
  const rows = db.all('courseProgress').filter(r => r.track === sid && r.status && r.completedAt).sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 3);
  if (rows.length < 3) return null;
  const easy = rows.every(r => r.feel === 'easy' || (r.score != null && r.score >= 0.95 && r.feel !== 'hard'));
  const hard = rows.every(r => r.feel === 'hard' || (r.score != null && r.score < 0.6));
  const order = ['new', 'some', 'good'];
  const i = order.indexOf(s.level);
  if (easy && i < 2) return { level: order[i + 1], text: `${s.name} looks easy for you lately. Moving it up a level makes lessons more practice-heavy.` };
  if (hard && i > 0) return { level: order[i - 1], text: `${s.name} has been hard lately. A level down gives each lesson more explanation first.` };
  return null;
}
export async function setLevel(sid, level) {
  const p = get();
  await save({ ...p, subjects: p.subjects.map(s => (s.id === sid ? { ...s, level } : s)) });
}

/** A compact description for the AI. */
export function describe(p = get()) {
  if (!p) return null;
  return {
    title: p.title, goal: p.goal, start: p.start, week: currentWeek(p), pacing: p.pacing, minutesPerSession: p.minutes,
    days: p.days.map((on, d) => (on ? DAY_NAMES[d] : null)).filter(Boolean), sessionsPerDay: p.perDay, times: p.times.slice(0, p.perDay),
    weeklyTest: p.weeklyTest, reviewEvery: p.reviewEvery || null, adaptive: p.adaptive, lessonStyle: p.style,
    subjects: p.subjects.map(s => ({ id: s.id, name: s.name, level: s.level, priority: s.priority, paused: s.paused, topics: s.topics.map(t => t.t), resources: s.resources })),
    adapting: adaptNotes(p).map(n => n.text),
  };
}

/** Apply a change from the AI or a form: subjects by name or id, topics added or replaced. */
export async function applyChange(change = {}) {
  const cur = get() || normalize({});
  const next = { ...cur, ...Object.fromEntries(Object.entries(change).filter(([k]) => ['title', 'goal', 'days', 'perDay', 'times', 'minutes', 'pacing', 'start', 'style', 'weeklyTest', 'reviewEvery', 'adaptive'].includes(k))) };
  if (Array.isArray(change.days) && change.days.every(d => typeof d === 'string')) next.days = DAY_NAMES.map(n => change.days.some(d => d.toLowerCase().startsWith(n.toLowerCase())));
  if (Array.isArray(change.subjects)) {
    const subs = [...cur.subjects];
    for (const c of change.subjects) {
      if (!c?.name && !c?.id) continue;
      const i = subs.findIndex(s => s.id === c.id || s.name.toLowerCase() === String(c.name || '').toLowerCase());
      if (c.remove) { if (i >= 0) subs.splice(i, 1); continue; }
      const old = i >= 0 ? subs[i] : { name: c.name, topics: [], resources: [] };
      let topics = old.topics;
      if (Array.isArray(c.topics)) {
        // keep ids of topics that stay, so their progress stays with them
        const byText = new Map(old.topics.map(t => [t.t.toLowerCase(), t]));
        topics = c.topics.map(x => byText.get(String(x).toLowerCase()) || { id: newId(), t: String(x) });
      }
      if (Array.isArray(c.add_topics)) topics = [...topics, ...c.add_topics.map(x => ({ id: newId(), t: String(x) }))];
      const row = { ...old, ...Object.fromEntries(Object.entries(c).filter(([k]) => ['name', 'level', 'priority', 'color', 'resources', 'paused'].includes(k))), topics };
      if (i >= 0) subs[i] = row; else subs.push(row);
    }
    next.subjects = subs;
  }
  return save(next);
}
