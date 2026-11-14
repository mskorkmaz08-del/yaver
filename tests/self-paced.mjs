// Self-paced course (v65): no timetable by default. Up next instead of timed slots,
// nothing "behind", no block alerts; Timetable brings the schedule back.
// Run with the site on :8765.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 420, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) failed++; };
await p.goto('http://localhost:8765/'); await p.waitForTimeout(1500);
const r = await p.evaluate(async () => {
  const C = await import('/js/course.js'); const db = await import('/js/db.js'); const R = await import('/js/reminders.js');
  for (let i = 0; i < 40 && !C.ready(); i++) await new Promise(r => setTimeout(r, 250));
  await C.saveSettings({ active: true, start: '2026-06-01' }); // months "late" on the old timetable
  const out = { self: C.selfPaced() };
  const up = C.upNext(6);
  out.up = up.map(l => l.id); out.tracks = new Set(up.map(l => l.track)).size;
  out.behind = Object.values(C.pace()).reduce((a, t) => a + t.behind, 0);
  const nb = C.nextBlock(); out.nb = { self: nb.selfPaced, start: nb.start, id: nb.lesson.id };
  out.rem = (R.reminders?.() || R.list?.() || []).map(x => x.text).join(' | ');
  await C.startLesson('algo-w05-1');
  out.resume = C.upNext(1)[0].id;
  await db.setSetting('lessonTimer', { lessonId: 'algo-w05-1', start: Date.now() - 9 * 3600000, plannedMin: 60 });
  await C.dropStaleTimer(); out.timer = db.setting('lessonTimer', null);
  await C.completeLesson({ lessonId: 'algo-w05-1', minutes: 10, score: 1 });
  out.afterDone = C.upNext(6).map(l => l.id).includes('algo-w05-1');
  await C.saveSettings({ pacing: 'schedule' });
  out.sched = { self: C.selfPaced(), behind: Object.values(C.pace()).reduce((a, t) => a + t.behind, 0), start: C.nextBlock()?.start };
  await C.saveSettings({ pacing: 'self' });
  return out;
});
ok(r.self, 'self-paced is the default');
ok(r.up.length === 6 && r.tracks >= 5, `up next offers the next lesson of several subjects: ${r.up.join(', ')}`);
ok(r.behind === 0, 'nothing is behind, even months after the old start date');
ok(r.nb.self && r.nb.start === '' && r.nb.id === r.up[0], 'the next block is the next lesson, with no clock time');
ok(!/behind|\d\d:\d\d ·|Weekly test and ship today/.test(r.rem), `reminders carry no times or pace: ${r.rem.slice(0, 160)}`);
ok(r.resume === 'algo-w05-1', 'a started lesson comes first');
ok(r.timer == null, 'a stopwatch left running for hours is dropped');
ok(!r.afterDone, 'a finished lesson leaves the list');
ok(!r.sched.self && r.sched.behind > 0 && /^\d\d:\d\d$/.test(r.sched.start || ''), 'Timetable brings back slots and pace');
await p.evaluate(() => { location.hash = '#course'; }); await p.waitForTimeout(1200);
ok(await p.locator('.today-card [data-open^="lesson/"]').count() >= 3 && await p.locator('.now-line').count() === 0, 'Course shows up next, no timeline');
ok(await p.locator('[data-pacing="schedule"]').count() === 1 && await p.locator('.pill[class*=pace-]').count() === 0, 'pacing switch shown, no pace pills');
await p.screenshot({ path: process.env.SHOT || '/dev/null', fullPage: false }).catch(() => {});
ok(!errs.length, `no page errors ${errs.join('; ')}`);
await b.close();
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall checks passed');
