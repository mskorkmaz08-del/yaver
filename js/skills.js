// Skill levels: six areas drawn as a hexagon, like a footballer's attribute card. Every lesson,
// test, solved problem, finished task, study session and Çetele count adds experience (XP) to
// an area. XP only ever grows, so levels never drop: a quiet week shows as "form" (this week
// against the week before), never as lost progress. Each area has a 1–99 rating that rises
// quickly at first and slows near the top, a level with the XP still needed for the next one,
// and the shape from four weeks ago drawn underneath so growth is visible at a glance.
import * as db from './db.js';
import * as CT from './cetele.js';
import * as C from './course.js';
import * as D from './data.js';
import { today, addDays } from './util.js';

// Related areas sit next to each other around the hexagon. k is the XP at which an area rates
// about 70: roughly a year of the plan lands each area in the 80s.
export const AREAS = [
  { id: 'python', name: 'Python', short: 'PY', k: 3000, tracks: ['python'] },
  { id: 'algo', name: 'Algorithms & math', short: 'ALG', k: 3000, tracks: ['algo', 'math'] },
  { id: 'systems', name: 'C++ & tools', short: 'SYS', k: 2500, tracks: ['cpp', 'tools'] },
  { id: 'robo', name: 'Robotics & AI', short: 'ROB', k: 3000, tracks: ['robo', 'ai', 'build'] },
  { id: 'discipline', name: 'Discipline', short: 'DIS', k: 11000 },
  { id: 'spirit', name: 'Çetele & reading', short: 'ÇET', k: 18000 },
];
const AREA_OF_TRACK = Object.fromEntries(AREAS.flatMap(a => (a.tracks || []).map(t => [t, a.id])));

// Every XP event: { day, area, xp, what }.
export function events() {
  const out = [];
  const push = (day, area, xp, what) => { if (day && xp > 0) out.push({ day: String(day).slice(0, 10), area, xp: Math.round(xp), what }); };
  // Course lessons: a mastered lesson is worth 60 + 40 × score; one to redo still counts for 30.
  for (const p of db.all('courseProgress')) {
    if (!p.completedAt) continue;
    const l = C.ready() ? C.lesson(p.lessonId) : null;
    const area = AREA_OF_TRACK[p.track || l?.track] || (l?.track === 'mixed' ? 'algo' : null);
    if (!area) continue;
    const s = p.score == null ? 0.75 : p.score;
    push(p.completedAt, area, p.status === 'done' ? 60 + 40 * s : 30, `Lesson: ${l?.title || p.lessonId}`);
  }
  // Weekly tests: up to 150 per track, by score.
  for (const t of db.all('courseTests')) for (const s of t.scores || []) {
    const area = AREA_OF_TRACK[s.track];
    if (area && s.total) push(t.date, area, 150 * (s.right / s.total), `Week ${t.week} test`);
  }
  // Problems solved (25 each) go to algorithms; card reviews (2 each) to discipline.
  for (const r of db.all('kv')) {
    const m = /^practice:(problems|anki):(\d{4}-\d{2}-\d{2})/.exec(r.id);
    if (!m || !(Number(r.value) > 0)) continue;
    if (m[1] === 'problems') push(m[2], 'algo', 25 * r.value, `${r.value} problem${r.value > 1 ? 's' : ''} solved`);
    else push(m[2], 'discipline', 2 * r.value, `${r.value} cards reviewed`);
  }
  // Discipline: study time (1 XP per 4 minutes), finished tasks and milestones.
  for (const s of db.all('sessions')) push(s.date, 'discipline', (Number(s.minutes) || 0) / 4, `${s.minutes} min study`);
  for (const t of db.all('tasks')) if (t.done) push(t.doneAt, 'discipline', 10, `Done: ${t.title}`);
  for (const m of db.all('milestones')) if (m.done) push(m.doneAt, 'discipline', 30, `Milestone: ${m.title}`);
  // Çetele: meeting a daily target is worth 50 (a share of it for part of the way); a weekly
  // target 150. Days with every minimum met add 40 discipline.
  const items = new Map(CT.items().map(i => [i.id, i]));
  const days = new Set();
  // Çetele XP is capped at 120 a day so a long list of counts can't outgrow the lessons.
  const spiritDay = {};
  for (const r of db.all('ceteleLog')) {
    const it = items.get(r.item);
    if (!it || !(r.value > 0)) continue;
    days.add(r.day);
    const per = it.per === 'week' ? 150 : 50;
    const xp = Math.min(per * 1.5, (per * r.value) / Math.max(1, Number(it.target) || 1), 120 - (spiritDay[r.day] || 0));
    spiritDay[r.day] = (spiritDay[r.day] || 0) + Math.max(0, xp);
    push(r.day, 'spirit', xp, `${it.name} ${r.value}${it.unit ? ' ' + it.unit : ''}`);
  }
  for (const d of days) if (CT.day(d).complete) push(d, 'discipline', 40, 'Every Çetele minimum met');
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

// Rating 1–99: a square-root curve, so the first lessons show clearly and the top takes long.
// Level n needs 50·n·(n+1) XP in total.
const rating = (xp, k) => Math.max(1, Math.min(99, Math.round(1 + 98 * Math.sqrt(xp / (xp + k)))));
const levelOf = xp => Math.floor((Math.sqrt(1 + (8 * xp) / 100) - 1) / 2);
const xpFor = n => 50 * n * (n + 1);

export function summary(at = today()) {
  const ev = events();
  const sum = (area, from, to) => ev.filter(e => e.area === area && e.day > from && e.day <= to).reduce((a, e) => a + e.xp, 0);
  const past = addDays(at, -28), w1 = addDays(at, -7), w2 = addDays(at, -14);
  const areas = AREAS.map(a => {
    const xp = sum(a.id, '', at);
    const then = sum(a.id, '', past);
    const level = levelOf(xp);
    const week = sum(a.id, w1, at), prev = sum(a.id, w2, w1);
    return {
      ...a, xp, level, rating: rating(xp, a.k), ratingThen: rating(then, a.k),
      next: xpFor(level + 1), toNext: xpFor(level + 1) - xp, frac: (xp - xpFor(level)) / (xpFor(level + 1) - xpFor(level)),
      week, prev, form: week > prev * 1.1 ? 'up' : week < prev * 0.9 ? 'down' : 'same',
    };
  });
  const overall = Math.round(areas.reduce((s, a) => s + a.rating, 0) / areas.length);
  const overallThen = Math.round(areas.reduce((s, a) => s + a.ratingThen, 0) / areas.length);
  const totalXp = areas.reduce((s, a) => s + a.xp, 0);
  const recent = ev.filter(e => e.day > addDays(at, -14)).slice(-8).reverse();
  return { areas, overall, overallThen, totalXp, level: levelOf(totalXp / AREAS.length), recent, streaks: streaks() };
}

function streaks() {
  const s = D.studySummary().streak;
  const c = CT.streak();
  return [
    { name: 'Study', current: s.current, best: Math.max(s.best || 0, s.current) },
    { name: 'Çetele', current: c.current, best: c.best },
  ];
}

// The hexagon as SVG: grid rings, axes, the shape from four weeks ago (steel outline) and now
// (gold), each corner labelled with its short name and rating.
export function radar(sum, { size = 280, labels = true } = {}) {
  const n = AREAS.length, R = 100, ang = i => (-90 + (360 / n) * i) * Math.PI / 180;
  const pt = (i, f) => [R * f * Math.cos(ang(i)), R * f * Math.sin(ang(i))].map(v => v.toFixed(1)).join(',');
  const ring = f => AREAS.map((_, i) => pt(i, f)).join(' ');
  const shape = key => sum.areas.map((a, i) => pt(i, Math.max(0.1, a[key] / 99))).join(' ');
  const lab = labels ? sum.areas.map((a, i) => {
    const x = 128 * Math.cos(ang(i)), y = 128 * Math.sin(ang(i));
    const anchor = Math.abs(x) < 8 ? 'middle' : x > 0 ? 'start' : 'end';
    return `<g class="sk-lab" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><text text-anchor="${anchor}" y="-3" class="sk-r">${a.rating}</text><text text-anchor="${anchor}" y="11" class="sk-n">${a.short}</text></g>`;
  }).join('') : '';
  return `<svg class="sk-radar" viewBox="${labels ? '-170 -150 340 300' : '-108 -108 216 216'}" width="${size}" role="img" aria-label="Skill ratings: ${sum.areas.map(a => `${a.name} ${a.rating}`).join(', ')}">
    ${[0.25, 0.5, 0.75, 1].map(f => `<polygon class="sk-ring" points="${ring(f)}"/>`).join('')}
    ${AREAS.map((_, i) => `<line class="sk-axis" x1="0" y1="0" x2="${pt(i, 1).split(',')[0]}" y2="${pt(i, 1).split(',')[1]}"/>`).join('')}
    <polygon class="sk-then" points="${shape('ratingThen')}"/>
    <polygon class="sk-now" points="${shape('rating')}"/>
    ${sum.areas.map((a, i) => `<circle class="sk-dot" cx="${pt(i, Math.max(0.1, a.rating / 99)).split(',')[0]}" cy="${pt(i, Math.max(0.1, a.rating / 99)).split(',')[1]}" r="3.2"/>`).join('')}
    ${lab}
  </svg>`;
}
