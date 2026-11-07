// Teams: dev team and students. People, activities, "last met" from activities
// and calendar meetings, overdue reminders on Home, the Teams screen and the
// assistant tools. Run from the repo root with the site served on port 8765.
import { chromium, devices } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const fail = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' · ' + extra : ''}`); if (!ok) fail.push(name); };

await page.goto('http://localhost:8765/');
await page.waitForSelector('.sheet');
await page.evaluate(async () => {
  const db = await import('./js/db.js');
  await db.setSetting('onboarded', true);
});
await page.reload();
await page.waitForTimeout(500);

const r = await page.evaluate(async () => {
  const T = await import('./js/teams.js');
  const D = await import('./js/data.js');
  const { runTool } = await import('./js/ai/tools.js');
  const { reminders } = await import('./js/reminders.js');
  const days = n => new Date(Date.now() - n * 86400e3).toISOString();
  const ayse = await T.addPerson({ name: 'Ayşe Yılmaz', team: 'student' });
  const ali = await T.addPerson({ name: 'Ali Kaya', team: 'student' });
  const irem = await T.addPerson({ name: 'İrem', team: 'student' });
  const emre = await T.addPerson({ name: 'Emre', team: 'dev', role: 'Backend' });
  await T.logActivity({ title: 'Python workshop', team: 'student', date: days(3), place: 'Lab 2', people: ['Ayşe', 'Zeynep'] });
  await T.logActivity({ title: 'Sprint review', team: 'dev', date: days(1), place: 'Zoom', people: ['Emre'] });
  // A calendar meeting that names Ali counts as meeting him (planned, in the future).
  await D.addEvent({ title: '1:1 with Ali', start: new Date(Date.now() + 2 * 86400e3).toISOString() });
  // Irem was met 30 days ago: overdue for a 14-day target. "irem" in a title matches İrem.
  await D.addEvent({ title: 'Call irem', start: days(30) });
  const st = p => { const s = T.status(p); return { days: s.days, next: !!s.next, overdue: s.overdue }; };
  const tool = await runTool('log_team_activity', { title: 'Code review', kind: 'meeting', team: 'dev', place: 'Office', people: ['Emre', 'Can'] });
  const status = await runTool('team_status', {});
  return {
    ayse: st(ayse), ali: st(ali), irem: st(irem), emre: st(emre),
    zeynep: !!T.findPerson('zeynep'), can: T.findPerson('Can')?.team,
    tool, statusNames: Object.values(status.teams).flat().map(p => p.name).join(','),
    reminder: reminders().find(n => n.kind === 'teams')?.text || '',
  };
});
check('activity sets last met', r.ayse.days === 3 && !r.ayse.overdue, JSON.stringify(r.ayse));
check('calendar meeting counts as planned', r.ali.next && !r.ali.overdue, JSON.stringify(r.ali));
check('İrem matched by "irem" and overdue', r.irem.days === 30 && r.irem.overdue, JSON.stringify(r.irem));
check('dev team has no target by default', !r.emre.overdue, JSON.stringify(r.emre));
check('unknown names are added to the team', r.zeynep && r.can === 'dev');
check('log_team_activity tool', !r.tool.error && r.tool.added_people?.includes('Can'), JSON.stringify(r.tool).slice(0, 90));
check('team_status lists everyone', /Ayşe Yılmaz/.test(r.statusNames) && /Emre/.test(r.statusNames), r.statusNames);
check('Home reminder names who is overdue', /İrem/.test(r.reminder) && !/Ayşe/.test(r.reminder), r.reminder);
const sync = await page.evaluate(async () => { const db = await import('./js/db.js'); const p = db.syncPayload(); return p.people?.length > 0 && p.activities?.length > 0; });
check('people and activities sync between devices', sync);

await page.goto('http://localhost:8765/#teams');
await page.waitForSelector('.team-pick');
await page.waitForTimeout(400);
const v = await page.evaluate(() => ({
  title: document.querySelector('.page-head h1').textContent,
  need: [...document.querySelectorAll('.need b')].map(b => b.textContent),
  people: document.querySelectorAll('[data-p]').length,
  acts: [...document.querySelectorAll('[data-a] small')].map(s => s.textContent),
}));
check('Teams screen shows students', v.title === 'Students' && v.people === 4, `${v.title} · ${v.people} people`);
check('not met lately lists İrem', v.need.join() === 'İrem', v.need.join());
check('activity shows where and who', v.acts.some(t => /Lab 2/.test(t) && /Ayşe/.test(t)), v.acts.join(' | '));
await page.screenshot({ path: '/tmp/teams-students.png' });
await page.click('[data-team="dev"]');
await page.waitForFunction(() => document.querySelector('.page-head h1').textContent === 'Dev team');
const dev = await page.evaluate(() => [...document.querySelectorAll('[data-a] b')].map(b => b.textContent));
check('Dev team tab shows its activities', dev.includes('Sprint review') && dev.includes('Code review') && !dev.includes('Python workshop'), dev.join(', '));
// Log an activity through the form.
await page.click('[data-log]');
await page.fill('.sheet [name=title]', 'Deploy party');
await page.fill('.sheet [name=place]', 'Roof');
await page.fill('.sheet [name=people]', 'Emre');
await page.click('.sheet button[type=submit]');
await page.waitForFunction(() => [...document.querySelectorAll('[data-a] b')].some(b => b.textContent === 'Deploy party'));
check('form logs an activity', true);
// Person sheet shows history.
await page.click('[data-team="student"]');
await page.waitForSelector('[data-p]');
await page.click('[data-p] >> text=Ayşe Yılmaz');
await page.waitForSelector('.sheet .apple-ev');
const hist = await page.textContent('.sheet .apple-ev');
check('person sheet shows history', /Python workshop/.test(hist) && /3 days ago/.test(hist), hist.replace(/\s+/g, ' ').slice(0, 90));
await page.click('.sheet [data-cancel]');
await page.goto('http://localhost:8765/#home');
await page.waitForTimeout(500);
const home = await page.evaluate(() => [...document.querySelectorAll('[data-open^="teams"]')].map(b => b.textContent).join(' | '));
check('Home shows the teams reminder', /İrem/.test(home), home);
check('no page errors', !errors.length, errors.join(' | '));
await browser.close();
console.log(fail.length ? `\n${fail.length} failed` : '\nall checks passed');
process.exit(fail.length ? 1 : 0);
