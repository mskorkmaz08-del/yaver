// Food diary: meals over several days, the 7/30-day report (averages, low
// vitamins, thin days), the Diet card, the CSV export and the diet_history tool.
// Run from the repo root with the site served on port 8765.
import { chromium, devices } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block', acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const fail = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' · ' + extra : ''}`); if (!ok) fail.push(name); };

await page.goto('http://localhost:8765/');
await page.waitForSelector('.sheet');
const r = await page.evaluate(async () => {
  const db = await import('./js/db.js');
  const D = await import('./js/data.js');
  const { addDays, today } = await import('./js/util.js');
  await db.setSetting('onboarded', true);
  await db.setSetting('dailyCalories', 2000);
  await db.setSetting('dailyProtein', 100);
  const micros = { potassium: 2000, calcium: 900, iron: 4, magnesium: 300, zinc: 9, vitaminA: 700, vitaminC: 80, vitaminD: 2, vitaminB12: 2.4, caffeine: 80 };
  // Three days: two full photo days low in vitamin D and iron, one thin manual day.
  for (const i of [1, 2]) await D.logMeal({ name: 'Plov', meal: 'Lunch', date: addDays(today(), -i), calories: 1900, protein: 90, carbs: 200, fat: 70, fiber: 25, sugar: 30, sodium: 2600, micros, items: [{ name: 'Plov', grams: 400 }], source: 'photo' });
  await D.logMeal({ name: 'Tea and a bun', meal: 'Breakfast', date: addDays(today(), -3), calories: 400, protein: 8 });
  const L = await import('./js/dietlog.js');
  const rep = L.report(7);
  const { runTool } = await import('./js/ai/tools.js');
  const tool = await runTool('diet_history', { days: 7 });
  return {
    logged: rep.loggedDays, detailed: rep.detailedDays,
    kcal: rep.nutrients.find(x => x.key === 'calories').avg,
    low: rep.low.map(x => x.key), high: rep.high.map(x => x.key), thin: rep.lowCalorieDays.length,
    csv: L.csv().split('\n'),
    tool: { low: tool.low, perDay: tool.perDay?.length, meals: tool.meals?.length, err: tool.error },
    synced: 'meals' in db.syncPayload(),
  };
});
check('counts logged and detailed days', r.logged === 3 && r.detailed === 2, `${r.logged}/${r.detailed}`);
check('average calories over logged days', Math.round(r.kcal) === 1400, String(r.kcal));
check('vitamin D and iron flagged low', r.low[0] === 'vitaminD' && r.low.includes('iron') && !r.low.includes('vitaminC'), r.low.join());
check('sodium flagged over the limit', r.high.includes('sodium'), r.high.join());
check('thin day found', r.thin === 1);
check('CSV has a header and one row per meal', r.csv.length === 4 && /^date,meal,name,calories/.test(r.csv[0]) && /Plov 400g/.test(r.csv.join('\n')) && /manual/.test(r.csv.join('\n')), r.csv[0].slice(0, 60));
check('diet_history tool for the assistant', !r.tool.err && r.tool.perDay === 3 && r.tool.meals === 3 && r.tool.low.some(x => /Vitamin D/.test(x)), JSON.stringify(r.tool).slice(0, 100));
check('meals sync between devices', r.synced);

await page.goto('http://localhost:8765/#diet');
await page.reload();
await page.waitForSelector('.diary');
const card = (await page.textContent('.diary')).replace(/\s+/g, ' ');
check('Diet card shows the 7-day picture', /3 of 7 days logged/.test(card) && /Running low: Vitamin D/.test(card) && /Above the limit: Sodium/.test(card), card.slice(0, 160));
await page.click('[data-span="30"]');
await page.waitForFunction(() => /of 30 days/.test(document.querySelector('.diary').textContent));
check('30-day switch', true);
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('[data-csv]')]);
check('diary downloads as CSV', !!dl && /yaver-food-diary-.*\.csv$/.test(dl.suggestedFilename()), dl?.suggestedFilename());
check('no page errors', !errors.length, errors.join(' | '));
await browser.close();
console.log(fail.length ? `\n${fail.length} failed` : '\nall checks passed');
process.exit(fail.length ? 1 : 0);
