// Body (v56, rebuilt v57, one section since v67): setup from height and weight only,
// the athletic target and diet plan, a day's effect on fat and muscle, the projection,
// the Body · Training · Diet switch, the bottom bar (Body bottom right, no Diet tab),
// the muscle map lit by sessions marked done, the split, measurements (tape body fat),
// performance tests, the morning readiness check, training load, body insights,
// Use as my diet goals and the body tools. Run from the repo root with the site on :8765.
import { chromium, devices } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const fail = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' · ' + extra : ''}`); if (!ok) fail.push(name); };
const status = () => page.evaluate(async () => (await import('./js/body.js')).status());

await page.goto('http://localhost:8765/');
await page.waitForSelector('.sheet');
await page.evaluate(async () => { const db = await import('./js/db.js'); await db.setSetting('onboarded', true); });
await page.goto('http://localhost:8765/#body');
await page.reload();
await page.click('[data-setup]');
const fields = await page.$$eval('.sheet input, .sheet select', els => els.map(e => e.name));
check('setup asks only height and weight', fields.join() === 'height,kg', fields.join());
await page.fill('.sheet [name=height]', '178');
await page.fill('.sheet [name=kg]', '80');
await page.click('.sheet button[type=submit]');
await page.waitForSelector('.goal');
const bar = await page.$$eval('.tabbar > button[data-tab]', bs => bs.filter(b => getComputedStyle(b).display !== 'none').map(b => b.dataset.tab));
check('bottom bar: Body bottom right, no Diet tab', bar.at(-1) === 'body' && !bar.includes('diet') && bar.length === 6, bar.join());
check('Body tab is lit', await page.$eval('.tabbar [data-tab=body]', b => b.classList.contains('active')));

const s0 = await status();
const t = s0.target;
check('estimates body fat and burn (training plan counts as moderate)', Math.abs(s0.profile.bodyFat - 21) < 0.6 && Math.abs(s0.profile.tdee - 2740) < 5 && s0.profile.training === 4 && s0.profile.trainingFrom === 'plan', JSON.stringify({ bf: s0.profile.bodyFat, tdee: s0.profile.tdee }));
check('athletic target and plan', Math.abs(t.kg - 79.2) < 0.3 && t.mode === 'cut' && t.calories === 2290 && t.protein === 175 && t.fat === 65 && t.carbs === 250, JSON.stringify(t));

await page.evaluate(async () => {
  const D = await import('./js/data.js'); const { today, addDays } = await import('./js/util.js');
  for (let i = 4; i >= 0; i--) await D.logMeal({ name: 'Big day', calories: 3200, protein: 150, carbs: 330, fat: 120, meal: 'Lunch', date: addDays(today(), -i) });
});
await page.waitForTimeout(300);
const s1 = await status();
check('a surplus day: muscle capped by training, the rest fat', Math.abs(s1.today.muscle - 30) < 1 && Math.abs(s1.today.fat - (460 - 84) / 7.7) < 2, `fat ${Math.round(s1.today.fat)} g, muscle ${Math.round(s1.today.muscle)} g`);
check('projects a month ahead', s1.projection && Math.abs(s1.projection.month.muscle - 0.9) < 0.05 && s1.projection.month.fat > 1, JSON.stringify(s1.projection?.month));
const deficit = await page.evaluate(async () => { const B = await import('./js/body.js'); const p = B.profile(); return [B.effect(1900, 60, p), B.effect(1900, 150, p)]; });
check('a deficit burns fat; low protein also loses some muscle', deficit[0].fat < 0 && deficit[0].muscle < 0 && deficit[1].muscle > 0, JSON.stringify(deficit.map(d => [Math.round(d.fat), Math.round(d.muscle)])));

await page.click('[data-btab=diet]');
await page.waitForSelector('.body-line');
check('Diet sits inside Body (switch, Body tab still lit)', await page.$eval('[data-btab=diet]', b => b.classList.contains('on')) && await page.$eval('.tabbar [data-tab=body]', b => b.classList.contains('active')));
check('Diet shows what eating does', /muscle\s*\+30 g/.test(await page.textContent('.body-line')) && /in a month/.test(await page.textContent('.body-line')));
await page.click('[data-btab=training]');
await page.waitForSelector('.muscles .muscle-map');
check('muscle map has front and back', (await page.$$('.muscle-map')).length === 2 && (await page.$$('.muscle-map [data-m]')).length >= 20);
const session = await page.evaluate(async () => (await import('./js/training.js')).sessionOn());
check('today shows the plan\'s session or rest', session ? (await page.textContent('.train .session')) === session.name : /Rest day/.test(await page.textContent('.train')));
// A session done yesterday lights its muscles.
await page.evaluate(async () => { const T = await import('./js/training.js'); const { today, addDays } = await import('./js/util.js'); await T.markDone(addDays(today(), -1), 'lowerPower'); });
await page.waitForTimeout(300);
const sets = await page.evaluate(async () => (await import('./js/training.js')).setsThisWeek());
check('a done session adds sets to its muscles', sets.quadriceps === 4 + 4 + 3 && sets.gluteal > 10 && !sets.chest, JSON.stringify(sets));
check('quads lit as 10+ sets', await page.$eval('.muscle-map [data-m=quadriceps]', g => g.classList.contains('m3')));
await page.dispatchEvent('.muscle-map [data-m=hamstring]', 'click');
await page.waitForFunction(() => /Hamstrings/.test(document.querySelector('.muscle-info').textContent));
check('tapping a muscle explains it', /hard set/.test(await page.textContent('.muscle-info')));
const s2 = await status();
check('logged sessions replace the planned count', s2.profile.trainingFrom === 'logged' && s2.profile.training === 0.5);
await page.click('[data-days="3"]');
await page.waitForFunction(() => document.querySelector('[data-days="3"]').classList.contains('on'));
check('3 days switches to full body', /Full body A/.test(await page.textContent('.split')));
await page.click('[data-days="4"]');
await page.waitForFunction(() => document.querySelector('[data-days="4"]').classList.contains('on'));
await page.screenshot({ path: '/tmp/yaver-body.png', fullPage: true });
console.log('screenshot /tmp/yaver-body.png');

await page.click('[data-btab=body]');
await page.waitForSelector('[data-goals]');
await page.click('[data-goals]');
await page.waitForTimeout(300);
const goals = await page.evaluate(async () => (await import('./js/data.js')).goals());
check('Use as my diet goals sets calories and protein', goals.dailyProtein === 175 && goals.dailyCalories > 1500, `${goals.dailyCalories} / ${goals.dailyProtein}`);

await page.click('[data-log=weight]');
await page.fill('.sheet [name=kg]', '79.4');
await page.click('.sheet button[type=submit]');
await page.waitForTimeout(300);
await page.click('[data-log=measure]');
await page.fill('.sheet [name=waist]', '86');
await page.click('.sheet button[type=submit]');
await page.waitForTimeout(400);
const p3 = await page.evaluate(async () => (await import('./js/body.js')).profile());
check('weight then waist: body fat from RFM', p3.kg === 79.4 && p3.fatFrom === 'waist' && Math.abs(p3.bodyFat - (64 - 20 * 178 / 86)) < 0.2, `${p3.kg} kg, ${p3.bodyFat}%`);
check('one body record per day', await page.evaluate(async () => (await import('./js/db.js')).all('weighins').length) === 1);
await page.click('[data-log=measure]');
await page.fill('.sheet [name=neck]', '38');
await page.click('.sheet button[type=submit]');
await page.waitForTimeout(400);
const p4 = await page.evaluate(async () => (await import('./js/body.js')).profile());
const navy = 495 / (1.0324 - 0.19077 * Math.log10(86 - 38) + 0.15456 * Math.log10(178)) - 450;
check('neck + waist: US Navy tape body fat', p4.fatFrom === 'tape' && Math.abs(p4.bodyFat - navy) < 0.2, `${p4.bodyFat}% vs ${navy.toFixed(1)}`);
check('stats show tape body fat and waist/height', /tape/.test(await page.textContent('.bstats')) && /0\.48/.test(await page.textContent('.bstats')));
await page.click('[data-log=test]');
await page.fill('.sheet [name=pullups]', '9');
await page.fill('.sheet [name=jump]', '44');
await page.click('.sheet button[type=submit]');
await page.waitForTimeout(400);
const tlist = await page.textContent('.tlist');
check('tests show value against target', /9\s*\/ 15 reps/.test(tlist) && /44\s*\/ 55 cm/.test(tlist), tlist.replace(/\s+/g, ' ').slice(0, 120));
await page.click('[data-log=ready] >> nth=0');
await page.fill('.sheet [name=sleep]', '5.5');
await page.selectOption('.sheet [name=energy]', 'low');
await page.selectOption('.sheet [name=soreness]', 'heavy');
await page.click('.sheet button[type=submit]');
await page.waitForSelector('.ready-top');
const rd = await page.evaluate(async () => (await import('./js/body.js')).readiness());
check('morning check: low readiness says take it easy', rd.call === 'easy' && /Take it easy/.test(await page.textContent('.ready')), JSON.stringify({ s: rd.score, c: rd.call }));
// Resting pulse 6 over a 4-week baseline lowers readiness and raises a recovery finding.
const rec = await page.evaluate(async () => {
  const B = await import('./js/body.js'); const { today, addDays } = await import('./js/util.js'); const IN = await import('./js/insights.js');
  for (let i = 12; i >= 3; i--) await B.logReadiness({ sleep: 8, rhr: 55, sleepQ: 'good', energy: 'high', soreness: 'none', stress: 'low' }, addDays(today(), -i));
  await B.logReadiness({ sleep: 8, rhr: 61, sleepQ: 'good', energy: 'high', soreness: 'none', stress: 'low' }, addDays(today(), -1));
  await B.logReadiness({ sleep: 8, rhr: 62, sleepQ: 'good', energy: 'high', soreness: 'none', stress: 'low' }, today());
  return { r: B.readiness(), ids: IN.all().map(i => i.id) };
});
check('pulse over baseline lowers readiness; recovery finding', rec.r.up >= 5 && rec.r.score === 80 && rec.ids.includes('rhr-up'), JSON.stringify({ up: rec.r.up, s: rec.r.score, ids: rec.ids }));
// Training load: sessions with RPE × minutes, spike against the 4-week average.
const ld = await page.evaluate(async () => {
  const T = await import('./js/training.js'); const B = await import('./js/body.js'); const db = await import('./js/db.js'); const { today, addDays } = await import('./js/util.js');
  for (const w of db.all('workouts')) await db.remove('workouts', w.id);
  for (const i of [26, 23, 19, 16, 12, 9]) await T.markDone(addDays(today(), -i), 'fullA', { rpe: 6, min: 50 });
  for (const i of [6, 5, 4, 3, 2, 1]) await T.markDone(addDays(today(), -i), 'fullA', { rpe: 9, min: 90 });
  return B.load();
});
check('training load ratio flags a spike', ld.zone === 'spike' && ld.weeks[3].load === 6 * 810, JSON.stringify({ r: ld.ratio, z: ld.zone }));
await page.click('[data-btab=training]');
await page.waitForSelector('.load-bars');
check('Training shows the load and the spike', /spike/.test(await page.textContent('.load')));
await page.click('[data-btab=body]');
await page.waitForSelector('.finds');
check('Body lists body findings', /load is/.test(await page.textContent('.finds')) && /Resting pulse/.test(await page.textContent('.finds')));

const tools = await page.evaluate(async () => {
  const { runTool, toolDefinitions } = await import('./js/ai/tools.js');
  await runTool('log_weight', { kg: 79, date: '2026-01-05' });
  await runTool('log_workout', { date: '2026-01-06', session: 'upperStrength', rpe: 8, minutes: 70 });
  await runTool('log_body', { date: '2026-01-05', arm: 36.5, broad: 231 });
  const ready = await runTool('log_readiness', { date: '2026-01-06', sleep_hours: 7.5, resting_pulse: 57, energy: 'high' });
  const db = (await import('./js/db.js'));
  return { status: await runTool('body_status', {}), ready, defs: toolDefinitions.filter(t => /body_status|log_weight|log_workout|log_body|log_readiness/.test(t.name)).length, w: db.all('workouts').find(w => w.date === '2026-01-06'), rec: db.all('weighins').find(w => w.date === '2026-01-05') };
}).catch(e => ({ error: e.message }));
check('body tools (status, weight, workout with RPE, body, readiness)', tools.defs === 5 && tools.w?.rpe === 8 && tools.w?.min === 70 && tools.rec?.kg === 79 && tools.rec?.arm === 36.5 && tools.ready?.readiness?.score > 0 && JSON.stringify(tools.status).includes('2026-01-05') && /athletic/i.test(tools.status?.goal) && tools.status?.trainingLoad, tools.error || JSON.stringify(tools.ready));
check('no page errors', !errors.length, errors.join(' | '));
await browser.close();
console.log(fail.length ? `\n${fail.length} failed` : '\nall checks passed');
process.exit(fail.length ? 1 : 0);
