// Body (v56): profile, athletic target, a day's effect on fat and muscle, the
// 30-day projection, the figure, weigh-ins, Use as my diet goals, the Diet line,
// and the body_status / log_weight tools. Run from the repo root with the site on :8765.
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
await page.evaluate(async () => { const db = await import('./js/db.js'); await db.setSetting('onboarded', true); });
await page.goto('http://localhost:8765/#body');
await page.reload();
await page.waitForSelector('[data-setup]');
check('asks for a profile first', true);
await page.click('[data-setup]');
await page.fill('.sheet [name=height]', '178');
await page.fill('.sheet [name=kg]', '80');
await page.fill('.sheet [name=birth]', String(new Date().getFullYear() - 30));
await page.selectOption('.sheet [name=activity]', 'light');
await page.fill('.sheet [name=training]', '3');
await page.click('.sheet button[type=submit]');
await page.waitForSelector('.body-fig svg.figure');

const s0 = await page.evaluate(async () => (await import('./js/body.js')).status());
check('estimates body fat, lean mass and burn', Math.abs(s0.profile.bodyFat - 21) < 0.6 && Math.abs(s0.profile.tdee - 2430) < 5 && s0.profile.fatFrom === 'BMI', JSON.stringify({ bf: s0.profile.bodyFat, tdee: s0.profile.tdee, ffmi: s0.profile.ffmi }));
check('athletic target from height (FFMI 22 at 12%)', Math.abs(s0.target.kg - 79.2) < 0.3 && s0.target.mode === 'cut' && s0.target.calories === 1980, JSON.stringify(s0.target));
check('no projection without logged days', s0.projection === null);

// Five days of 2,900 kcal with 150 g protein: a 470 kcal surplus a day.
await page.evaluate(async () => {
  const D = await import('./js/data.js'); const { today, addDays } = await import('./js/util.js');
  for (let i = 4; i >= 0; i--) await D.logMeal({ name: 'Big day', calories: 2900, protein: 150, carbs: 300, fat: 110, meal: 'Lunch', date: addDays(today(), -i) });
});
await page.waitForTimeout(300);
const s1 = await page.evaluate(async () => (await import('./js/body.js')).status());
check('a surplus day: muscle capped by training, the rest fat', Math.abs(s1.today.muscle - 30) < 1 && Math.abs(s1.today.fat - 50) < 2, `fat ${Math.round(s1.today.fat)} g, muscle ${Math.round(s1.today.muscle)} g`);
check('week adds up the counted days', s1.week.days === 5 && Math.abs(s1.week.fat - 5 * s1.today.fat) < 1);
check('projects a month ahead', s1.projection && Math.abs(s1.projection.month.muscle - 0.9) < 0.05 && Math.abs(s1.projection.month.fat - 1.5) < 0.1 && Math.abs(s1.projection.month.kg - 82.4) < 0.15, JSON.stringify(s1.projection?.month));
const deficit = await page.evaluate(async () => { const B = await import('./js/body.js'); const p = B.profile(); return [B.effect(1900, 60, p), B.effect(1900, 150, p)]; });
check('a deficit burns fat; low protein also loses some muscle', deficit[0].fat < 0 && deficit[0].muscle < 0 && deficit[1].muscle > 0 && deficit[1].fat < deficit[0].fat, JSON.stringify(deficit.map(d => [Math.round(d.fat), Math.round(d.muscle)])));

await page.goto('http://localhost:8765/#diet');
await page.waitForSelector('.body-line');
check('Diet shows the body line', /fat\s*\+50 g/.test(await page.textContent('.body-line')), (await page.textContent('.body-line')).replace(/\s+/g, ' ').trim());
await page.click('.body-line');
await page.waitForSelector('.body-fig');
const txt = await page.textContent('#view');
check('screen shows today, projection and target', /\+470 kcal/.test(txt) && /In a month/.test(txt) && /82\.4 kg/.test(txt) && /79\.2 kg/.test(txt));
const now = await page.getAttribute('.figure .f-body', 'd');
await page.click('[data-view=target]');
await page.waitForSelector('[data-view=target].on');
const tgt = await page.getAttribute('.figure .f-body', 'd');
check('figure changes between now and target', now && tgt && now !== tgt);
check('target view has no dashed outline over itself', !(await page.$('.figure .f-goal')));
await page.click('[data-view=now]');
await page.screenshot({ path: '/tmp/yaver-body.png', fullPage: true });
console.log('screenshot /tmp/yaver-body.png');

await page.click('[data-goals]');
await page.waitForTimeout(300);
const goals = await page.evaluate(async () => (await import('./js/data.js')).goals());
check('Use as my diet goals sets calories and protein', goals.dailyCalories === 1980 && goals.dailyProtein === 160, `${goals.dailyCalories} / ${goals.dailyProtein}`);

// A weigh-in with the waist moves body fat to the waist formula.
await page.click('[data-weigh]');
await page.fill('.sheet [name=kg]', '79.4');
await page.fill('.sheet [name=waist]', '86');
await page.click('.sheet button[type=submit]');
await page.waitForTimeout(400);
const s2 = await page.evaluate(async () => (await import('./js/body.js')).profile());
check('weigh-in with waist: body fat from RFM', s2.kg === 79.4 && s2.fatFrom === 'waist' && Math.abs(s2.bodyFat - (64 - 20 * 178 / 86)) < 0.2, `${s2.kg} kg, ${s2.bodyFat}%`);
check('one weigh-in per day', await page.evaluate(async () => (await import('./js/db.js')).all('weighins').length) === 1);

const tools = await page.evaluate(async () => {
  const { runTool, toolDefinitions } = await import('./js/ai/tools.js');
  const r = await runTool('log_weight', { kg: 79, date: '2026-01-05' });
  return { status: await runTool('body_status', {}), r, defs: toolDefinitions.filter(t => /body_status|log_weight/.test(t.name)).length };
}).catch(e => ({ error: e.message }));
check('body_status and log_weight tools', tools.defs === 2 && JSON.stringify(tools.status).includes('target') && JSON.stringify(tools.status).includes('2026-01-05'), tools.error || JSON.stringify(tools).slice(0, 200));
check('no page errors', !errors.length, errors.join(' | '));
await browser.close();
console.log(fail.length ? `\n${fail.length} failed` : '\nall checks passed');
process.exit(fail.length ? 1 : 0);
