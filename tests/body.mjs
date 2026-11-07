// Body (v56, rebuilt v57): setup from height and weight only, the athletic target
// and diet plan, a day's effect on fat and muscle, the projection, the muscle map
// lit by sessions marked done, the training split (3/4/5 days), weigh-ins, Use as
// my diet goals, the Diet line and the body tools. Run from the repo root with the site on :8765.
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

await page.goto('http://localhost:8765/#diet');
await page.waitForSelector('.body-line');
check('Diet shows the body line', /muscle\s*\+30 g/.test(await page.textContent('.body-line')));
await page.click('.body-line');
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

await page.click('[data-goals]');
await page.waitForTimeout(300);
const goals = await page.evaluate(async () => (await import('./js/data.js')).goals());
check('Use as my diet goals sets calories and protein', goals.dailyProtein === 175 && goals.dailyCalories > 1500, `${goals.dailyCalories} / ${goals.dailyProtein}`);

await page.click('[data-weigh]');
await page.fill('.sheet [name=kg]', '79.4');
await page.fill('.sheet [name=waist]', '86');
await page.click('.sheet button[type=submit]');
await page.waitForTimeout(400);
const p3 = await page.evaluate(async () => (await import('./js/body.js')).profile());
check('weigh-in with waist: body fat from RFM', p3.kg === 79.4 && p3.fatFrom === 'waist' && Math.abs(p3.bodyFat - (64 - 20 * 178 / 86)) < 0.2, `${p3.kg} kg, ${p3.bodyFat}%`);
check('one weigh-in per day', await page.evaluate(async () => (await import('./js/db.js')).all('weighins').length) === 1);

const tools = await page.evaluate(async () => {
  const { runTool, toolDefinitions } = await import('./js/ai/tools.js');
  await runTool('log_weight', { kg: 79, date: '2026-01-05' });
  await runTool('log_workout', { date: '2026-01-06', session: 'upperStrength' });
  return { status: await runTool('body_status', {}), defs: toolDefinitions.filter(t => /body_status|log_weight|log_workout/.test(t.name)).length, w: (await import('./js/db.js')).all('workouts').length };
}).catch(e => ({ error: e.message }));
check('body_status, log_weight and log_workout tools', tools.defs === 3 && tools.w === 2 && JSON.stringify(tools.status).includes('2026-01-05') && /athletic/i.test(tools.status?.goal), tools.error || '');
check('no page errors', !errors.length, errors.join(' | '));
await browser.close();
console.log(fail.length ? `\n${fail.length} failed` : '\nall checks passed');
process.exit(fail.length ? 1 : 0);
