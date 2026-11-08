// Insights (v60): no card without data; with two weeks of food (late dinners and
// bad mornings after them, low protein and vitamin D), a fat-loss plan eaten in a
// surplus, thin study and fast spending, Home shows the top three, most important
// first; Hide for today works; get_insights gives the assistant everything.
// Run from the repo root with the site on :8765.
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
await page.reload();
await page.waitForSelector('.cetdial');
check('no insights card without data', !(await page.$('.insights')));

await page.evaluate(async () => {
  const db = await import('./js/db.js'); const D = await import('./js/data.js'); const L = await import('./js/dietlog.js'); const B = await import('./js/body.js');
  const { today, addDays } = await import('./js/util.js');
  await db.setSetting('dailyProtein', 150); await db.setSetting('bodyHeight', 178); await db.setSetting('monthlyBudget', 100);
  await B.logWeight({ kg: 80 });
  const micros = { vitaminD: 1, iron: 12, calcium: 900, potassium: 3500, magnesium: 350, zinc: 9, vitaminA: 800, vitaminC: 90, vitaminB12: 3, caffeine: 50 };
  for (let i = 1; i <= 12; i++) {
    const day = addDays(today(), -i), late = i % 2 === 0;
    await D.logMeal({ name: 'Breakfast', meal: 'Breakfast', date: day, time: '08:30', calories: 700, protein: 30, micros });
    await D.logMeal({ name: 'Lunch', meal: 'Lunch', date: day, time: '13:00', calories: 1200, protein: 40, micros });
    await D.logMeal({ name: late ? 'Late doner' : 'Dinner', meal: 'Dinner', date: day, time: late ? '22:40' : '19:00', calories: 1500, protein: 30, micros });
    // The morning after a late day (i - 1) is bad; after the others, good.
    await L.setFeel(addDays(today(), -i + 1), late ? 'bad' : 'good');
  }
  await D.logStudy({ subject: 'Python', minutes: 20, date: addDays(today(), -2) });
  await D.addExpense({ amount: 400, category: 'Food', date: today() });
});
await page.waitForTimeout(500);
const all = await page.evaluate(async () => (await import('./js/insights.js')).all().map(i => `${i.level}:${i.id}`));
console.log('  found', all.join(', '));
check('late eating linked to bad mornings', all.includes('3:late-mornings'));
check('surplus against the fat-loss plan', all.includes('3:plan-surplus'));
check('feeling bad often', all.includes('3:feel-bad'));
check('protein under goal', all.includes('2:protein-low'));
check('vitamin D low all week', all.some(x => /^2:low-.*vitaminD/.test(x)));
check('study behind', all.includes('2:study-behind'));
const day = new Date().getDate();
check('spending pace (from day 5 of the month)', day < 5 || all.some(x => /money-pace/.test(x)));
check('sorted by importance', all.map(x => Number(x[0])).every((v, i, a) => !i || a[i - 1] >= v));

await page.reload();
await page.waitForSelector('.insights');
const rows = await page.$$eval('.insights .insight', els => els.map(e => e.className));
check('Home shows the top three, most important first', rows.length === 3 && rows.every(c => /lv3/.test(c)), rows.join(' | '));
const text = (await page.textContent('.insights')).replace(/\s+/g, ' ');
check('plain text with numbers', /felt bad on \d+ of \d+ mornings/.test(text) || /kcal a day over your burn/.test(text), text.slice(0, 200));
const firstId = await page.getAttribute('.insights [data-in-hide]', 'data-in-hide');
await page.click('.insights [data-in-hide]');
await page.waitForFunction(id => !document.querySelector(`.insights [data-in-hide="${id}"]`), firstId);
check('Hide for today removes it', true, firstId);
await page.screenshot({ path: '/tmp/yaver-insights.png' });
await page.locator('.insights').screenshot({ path: '/tmp/yaver-insights-card.png' });

const tool = await page.evaluate(async () => (await (await import('./js/ai/tools.js')).runTool('get_insights', {})));
check('get_insights gives the assistant every finding, hidden ones too', tool.insights?.length === all.length && tool.insights.some(i => i.importance === 'act on it'), String(tool.insights?.length));
check('no page errors', !errors.length, errors.join(' | '));
await browser.close();
console.log(fail.length ? `\n${fail.length} failed` : '\nall checks passed');
process.exit(fail.length ? 1 : 0);
