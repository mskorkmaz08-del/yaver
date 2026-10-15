// Checks the course content in data/course/ against the lesson rules.
// Node, no dependencies:  node tests/validate-course.mjs [--week N] [--fix-seq]
//   --week N   only check that week's file (still checks it against the rotation)
//   --fix-seq  rewrite every lesson's `seq` so it counts up per lane across the course
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../data/course');
const args = process.argv.slice(2);
const onlyWeek = args.includes('--week') ? Number(args[args.indexOf('--week') + 1]) : null;
const fixSeq = args.includes('--fix-seq');

const errors = [];
const warn = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

const readJSON = f => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { err(path.relative(ROOT, f), `invalid JSON (${e.message})`); return null; }
};

const course = readJSON(path.join(ROOT, 'course.json'));
if (!course) finish();
let urlList = [];
const urlsFile = path.join(ROOT, 'urls.json');
if (fs.existsSync(urlsFile)) urlList = (readJSON(urlsFile)?.urls || []).map(u => u.url);
else warn.push('urls.json missing: URL check skipped');
const verified = new Set(urlList);
const urlOk = u => verified.has(u) || verified.has(u.replace(/\/$/, '')) || verified.has(u + '/');

// Step template per lesson kind: [kind, minutes] (minutes for 90/120 or 60/90 variants are computed).
export function template(kind, minutes) {
  switch (kind) {
    case 'deep': return [['warmup', 10], ['pretest', 5], ['learn', 35], ['practice', 30], ['exit', 10]];
    case 'practice': return [['warmup', 5], ['learn', 10], ['practice', 60], ['reflect', 10], ['exit', 5]];
    case 'build': return [['plan', 10], ['build', minutes - 25], ['test', 10], ['log', 5]];
    case 'prep': return [['learn', 15], ['simulate', 20], ['measure', 15], ['teachnotes', 10]];
    case 'lab': return [['build', 60], ['measure', 25], ['handout', 25], ['exit', 10]];
    case 'light': return minutes === 90 ? [['read', 65], ['summary', 10], ['cards', 15]] : [['read', 40], ['summary', 10], ['cards', 10]];
    default: return null; // setup, diagnostic: free-form
  }
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// How many sessions each lane gets in a normal week of a phase.
export function laneCounts(phase) {
  const counts = {};
  for (const row of Object.values(phase.rotation)) for (const lane of row) if (lane && course.lanes[lane]) counts[lane] = (counts[lane] || 0) + 1;
  return counts;
}

const allLessons = new Map();
const weekFiles = [];
for (const w of course.weeks) {
  if (!w.file) continue;
  const f = path.join(ROOT, w.file);
  if (!fs.existsSync(f)) { if (onlyWeek === null || onlyWeek === w.week) warn.push(`week ${w.week}: ${w.file} not written yet`); continue; }
  const data = readJSON(f);
  if (!data) continue;
  weekFiles.push({ w, f, data });
  for (const l of data.lessons || []) {
    if (allLessons.has(l.id)) err(l.id, `duplicate id (also in week ${allLessons.get(l.id).week})`);
    allLessons.set(l.id, l);
  }
}

for (const { w, data } of weekFiles) {
  if (onlyWeek !== null && w.week !== onlyWeek) continue;
  const where = `week ${w.week}`;
  if (data.week !== w.week) err(where, `file says week ${data.week}`);
  if (!Array.isArray(data.lessons) || !data.lessons.length) { err(where, 'no lessons'); continue; }
  if (w.consolidation) err(where, 'consolidation weeks have no regular lessons');
  // Lessons per lane must equal the lane's sessions in the rotation.
  const want = w.week === 0 ? { setup: 4 } : laneCounts(course.phases.find(p => p.id === w.phase));
  const have = {};
  for (const l of data.lessons) have[l.lane] = (have[l.lane] || 0) + 1;
  for (const lane of new Set([...Object.keys(want), ...Object.keys(have)])) {
    if ((want[lane] || 0) !== (have[lane] || 0)) err(where, `lane ${lane}: ${have[lane] || 0} lessons, rotation schedules ${want[lane] || 0}`);
  }
  for (const l of data.lessons) checkLesson(l, w.week);
}

function checkLesson(l, week) {
  const id = l.id || '(no id)';
  const req = ['id', 'track', 'lane', 'week', 'seq', 'kind', 'minutes', 'title', 'objectives', 'resources', 'steps', 'cards', 'deliverable'];
  for (const k of req) if (l[k] === undefined || l[k] === null || l[k] === '') err(id, `missing ${k}`);
  const lane = course.lanes[l.lane];
  if (!lane) { err(id, `unknown lane ${l.lane}`); return; }
  if (!/^[a-z]+-w\d\d-[a-z0-9]+$/.test(l.id || '')) err(id, 'id must look like <track>-wNN-<k>');
  else if (!l.id.startsWith(`${l.track}-w${String(week).padStart(2, '0')}-`)) err(id, `id must start with ${l.track}-w${String(week).padStart(2, '0')}-`);
  if (l.week !== week) err(id, `week ${l.week} but stored in week ${week}`);
  if (lane.track !== l.track && l.lane !== 'setup') err(id, `lane ${l.lane} belongs to track ${lane.track}`);
  if (l.minutes < 60) err(id, 'lessons are at least 60 minutes');
  if (l.lane !== 'setup' && l.minutes !== lane.minutes) err(id, `minutes ${l.minutes} but lane ${l.lane} is ${lane.minutes}`);
  const free = l.lane === 'setup';
  if (free ? !['setup', 'diagnostic'].includes(l.kind) : l.kind !== lane.kind) err(id, `kind ${l.kind} does not match lane kind ${lane.kind}`);
  if (!Array.isArray(l.objectives) || l.objectives.length < 2 || l.objectives.length > 4) err(id, 'objectives: 2–4');
  if (!Array.isArray(l.resources) || !l.resources.length) err(id, 'at least one resource');
  for (const r of l.resources || []) {
    if (!r.title || !r.url) err(id, 'resource needs title and url');
    else if (!/^https:\/\//.test(r.url)) err(id, `resource url not https: ${r.url}`);
    else if (verified.size && !urlOk(r.url)) err(id, `url not in verified list: ${r.url}`);
  }
  const steps = l.steps || [];
  const total = steps.reduce((a, s) => a + (Number(s.minutes) || 0), 0);
  if (total !== l.minutes) err(id, `step minutes sum to ${total}, lesson is ${l.minutes}`);
  const tpl = template(l.kind, l.minutes);
  if (tpl) {
    const got = steps.map(s => `${s.kind}:${s.minutes}`).join(' ');
    const exp = tpl.map(([k, m]) => `${k}:${m}`).join(' ');
    if (got !== exp) err(id, `steps "${got}" should be "${exp}"`);
  } else if (steps.length < 2) err(id, 'free-form lessons still need at least 2 steps');
  for (const s of steps) {
    if (!s.title) err(id, `step ${s.kind} needs a title`);
    if (['learn', 'pretest', 'read', 'summary', 'plan', 'build', 'test', 'log', 'simulate', 'measure', 'teachnotes', 'handout', 'reflect', 'cards'].includes(s.kind) && !s.body && !s.tasks) err(id, `step ${s.kind} needs a body`);
    if (s.kind === 'learn' && l.kind === 'deep' && (s.body || '').length < 900) err(id, `learn body is thin (${(s.body || '').length} chars; deep lessons need a real explanation and a worked example)`);
    if ((s.kind === 'warmup' || s.kind === 'exit') && (!Array.isArray(s.questions) || !s.questions.length)) err(id, `${s.kind} needs questions`);
    for (const q of s.questions || []) if (!q.q || !q.a) err(id, `${s.kind} question needs q and a`);
    if (s.kind === 'exit' && (s.questions?.length < 3 || s.questions?.length > 5)) err(id, 'exit ticket: 3–5 questions');
    if (s.kind === 'exit' && l.kind === 'deep' && !s.teachBack) err(id, 'exit ticket needs a teachBack prompt');
    if (s.kind === 'practice') {
      if (!Array.isArray(s.tasks) || s.tasks.length < 2 || s.tasks.length > (l.kind === 'diagnostic' ? 7 : 5)) err(id, 'practice: 2–5 tasks');
      for (const t of s.tasks || []) {
        if (!t.prompt) err(id, 'task needs a prompt');
        if (!t.check) err(id, `task needs a check: ${String(t.prompt).slice(0, 40)}`);
        if (!t.solution) err(id, `task needs a solution: ${String(t.prompt).slice(0, 40)}`);
        if (!Array.isArray(t.hints) || !t.hints.length) err(id, 'task needs hints');
      }
    }
    for (const u of String(JSON.stringify(s)).match(/https?:\/\/[^\s)"\\\]]+/g) || []) {
      if (!u.startsWith('https://')) err(id, `link not https: ${u}`);
      else if (verified.size && !urlOk(u)) err(id, `link not in verified list: ${u}`);
    }
  }
  if (!free && (!Array.isArray(l.cards) || l.cards.length < 3 || l.cards.length > 6)) err(id, 'cards: 3–6');
  for (const c of l.cards || []) if (!c.front || !c.back) err(id, 'card needs front and back');
  for (const p of l.prereqs || []) if (!allLessons.has(p)) (onlyWeek !== null ? warn.push(`${id}: prereq ${p} not found (yet)`) : err(id, `prereq ${p} does not exist`));
  if (l.track === 'robo' && !('teachBy' in l && 'safety' in l)) err(id, 'robotics lessons need teachBy and safety');
}

// seq: continuous per lane across the course, in week order then file order.
const bySeq = {};
for (const { w, data } of weekFiles.sort((a, b) => a.w.week - b.w.week)) {
  for (const l of data.lessons || []) {
    bySeq[l.lane] = (bySeq[l.lane] || 0) + 1;
    if (fixSeq) l.seq = bySeq[l.lane];
    else if (onlyWeek === null && l.seq !== bySeq[l.lane]) err(l.id, `seq ${l.seq}, expected ${bySeq[l.lane]} (run with --fix-seq)`);
  }
}
if (fixSeq) for (const { f, data } of weekFiles) fs.writeFileSync(f, JSON.stringify(data, null, 1) + '\n');

finish();
function finish() {
  for (const m of warn) console.log('warn  ' + m);
  for (const m of errors.slice(0, 300)) console.log('ERROR ' + m);
  console.log(errors.length ? `\n${errors.length} problem(s)` : `ok: ${allLessons.size} lessons in ${weekFiles.length} week file(s)`);
  process.exit(errors.length ? 1 : 0);
}
