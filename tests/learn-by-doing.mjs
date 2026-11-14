// Learn by doing (v64): lessons fold their lecture steps into "In short", keep the doing
// steps, end with the full text as an optional step; "I know this" and "skip basics".
// Run with the site on :8765.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 420, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) failed++; };
await p.goto('http://localhost:8765/'); await p.waitForTimeout(1500);
const r = await p.evaluate(async () => {
  const C = await import('/js/course.js'); const db = await import('/js/db.js');
  for (let i = 0; i < 40 && !C.ready(); i++) await new Promise(r => setTimeout(r, 250));
  await C.saveSettings({ active: true });
  const raw = C.rawLesson('python-w04-2'), l = C.lesson('python-w04-2'), read = C.lesson('ai-w03-1');
  const out = { mode: C.lessonMode(), rawMin: raw.minutes, min: l.minutes, kinds: l.steps.map(s => s.kind).join(' '), brief: l.steps.find(s => s.brief)?.body || '',
    last: l.steps.at(-1), rawLearn: raw.steps.find(s => s.kind === 'learn').body.length, readKinds: read.steps.map(s => `${s.kind}${s.recall ? '*' : ''}`).join(' '),
    build: C.lesson('build-w03-1').steps.length === C.rawLesson('build-w03-1').steps.length, basics: C.basicsLeft().length };
  await C.saveSettings({ mode: 'full' });
  out.full = C.lesson('python-w04-2').minutes;
  await C.saveSettings({ mode: 'do' });
  const sk = await C.skipLesson('python-w01-1');
  out.skipped = db.get('courseProgress', 'python-w01-1'); out.cards = db.all('cards').filter(c => c.lessonId === 'python-w01-1').length; out.sessions = db.all('sessions').length;
  out.n = await C.skipBasics(); out.left = C.basicsLeft().length;
  return out;
});
ok(r.mode === 'do', 'learn by doing is the default style');
ok(r.min < r.rawMin && r.full === r.rawMin, `lesson is shorter by doing (${r.rawMin} → ${r.min} min), full text keeps ${r.full}`);
ok(/^warmup example learn practice exit read$/.test(r.kinds), `doing steps kept, lecture folded: ${r.kinds}`);
ok(r.brief.length < r.rawLearn && r.brief.includes('- **'), 'In short lists the key facts and is shorter than the lecture');
ok(r.last.optional && r.last.minutes === 0 && r.last.body.length >= r.rawLearn, 'full explanation is the optional last step');
ok(/exit\*/.test(r.readKinds), `a reading lesson ends with answering from memory: ${r.readKinds}`);
ok(r.build, 'a build lesson is unchanged');
ok(r.skipped.status === 'done' && r.skipped.skipped && r.cards > 0 && r.sessions === 0, 'I know this: done, cards scheduled, no study time logged');
ok(r.basics === 9 && r.n === 8 && r.left === 0, 'skip basics marks the remaining basics lessons');
await p.evaluate(() => { location.hash = '#lesson/python-w04-2'; }); await p.waitForTimeout(1500);
ok(await p.locator('details.full-text').count() === 1, 'lesson screen folds the full explanation');
ok(await p.locator('[data-skip-lesson]').count() >= 1, 'lesson screen has I know this');
await p.evaluate(() => { location.hash = '#course'; }); await p.waitForTimeout(1200);
ok(await p.locator('[data-mode="full"]').count() === 1 && await p.locator('[data-algo]').count() > 0, 'Course shows the style switch and algorithm sets');
ok(!errs.length, `no page errors ${errs.join('; ')}`);
await b.close();
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall checks passed');
