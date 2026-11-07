// Food photo: Diet → Photo a meal → Estimate (Gemini mocked) → change a weight
// → log. Checks the request (image, JSON schema), scaling, the logged meal's
// extras and the nutrients card. Run from the repo root with the site on :8765.
import { chromium, devices } from 'playwright';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'yaver-food-'));
// A tiny valid PNG (1×1) as the "photo".
const photo = join(dir, 'meal.png');
writeFileSync(photo, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const fail = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' · ' + extra : ''}`); if (!ok) fail.push(name); };

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
let sent = null;
const answer = {
  dish: 'Plov with salad', meal: 'Lunch', confidence: 'medium', note: 'Oil in the rice is hard to see.',
  items: [
    { name: 'Plov', grams: 300, calories: 540, protein: 21, carbs: 66, fat: 21, fiber: 3, sugar: 4, sodium: 690, potassium: 420, calcium: 45, iron: 2.7, magnesium: 60, zinc: 3.6, vitaminA: 450, vitaminC: 3, vitaminD: 0, vitaminB12: 1.5, caffeine: 0 },
    { name: 'Tomato cucumber salad', grams: 120, calories: 60, protein: 1.5, carbs: 6, fat: 3.5, fiber: 1.8, sugar: 3.6, sodium: 180, potassium: 260, calcium: 18, iron: 0.4, magnesium: 14, zinc: 0.2, vitaminA: 40, vitaminC: 14, vitaminD: 0, vitaminB12: 0, caffeine: 0 },
  ],
};
await page.route('https://generativelanguage.googleapis.com/**', async route => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (req.url().includes('/models?')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ models: [{ name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent'] }] }) });
  sent = { url: req.url(), body: req.postDataJSON() };
  await new Promise(r => setTimeout(r, 300));
  return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }) });
});

await page.goto('http://localhost:8765/');
await page.waitForSelector('.sheet');
await page.evaluate(async () => { const db = await import('./js/db.js'); await db.setSetting('onboarded', true); await db.setSetting('geminiKey', 'AIzaSyTestKeyForFood0000000'); });
await page.goto('http://localhost:8765/#diet');
await page.reload();
await page.waitForSelector('[data-snap]');
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-snap]')]);
await chooser.setFiles(photo);
await page.waitForSelector('.food-sheet [data-go]');
await page.fill('.food-sheet [name=note]', 'cooked with lots of oil');
await page.click('.food-sheet [data-go]');
await page.waitForSelector('.food-sheet [data-g="0"]', { timeout: 10000 });
const req = sent?.body;
check('sends the photo to Gemini', !!req?.contents?.[0]?.parts?.[0]?.inlineData?.data && /gemini-3-flash:generateContent/.test(sent.url), sent?.url);
check('asks for JSON with a schema', req?.generationConfig?.responseMimeType === 'application/json' && !!req.generationConfig.responseSchema?.properties?.items);
check('prompt asks for the visible portion and includes the note', /actually visible/.test(req?.contents[0].parts[1].text) && /lots of oil/.test(req?.contents[0].parts[1].text));
const before = await page.textContent('.food-total b');
check('totals add up the items', before.trim() === '600 kcal', before);
await page.fill('.food-sheet [data-g="0"]', '150');
await page.dispatchEvent('.food-sheet [data-g="0"]', 'change');
await page.waitForFunction(() => document.querySelector('.food-total b').textContent.trim() === '330 kcal');
check('changing a weight rescales it', true, '150 g plov → 330 kcal');
await page.screenshot({ path: join(dir, 'review.png') });
console.log('screenshot', join(dir, 'review.png'));
await page.click('.food-sheet [data-log]');
await page.waitForTimeout(500);
const meal = await page.evaluate(async () => (await import('./js/db.js')).all('meals').at(-1));
check('meal logged with extras', meal?.name === 'Plov with salad' && meal.meal === 'Lunch' && meal.calories === 330 && meal.protein === 12 && meal.source === 'photo' && meal.items?.length === 2 && meal.micros?.vitaminC > 0, JSON.stringify({ c: meal?.calories, p: meal?.protein, f: meal?.fiber, na: meal?.sodium }));
const card = await page.evaluate(() => [...document.querySelectorAll('.nutrients .nut span')].map(s => s.textContent));
check('nutrients card shows fiber, sodium and vitamins', card.includes('Fiber') && card.includes('Sodium') && card.includes('Vitamin C'), card.join(', '));
await page.screenshot({ path: join(dir, 'diet.png'), fullPage: true });
check('no page errors', !errors.length, errors.join(' | '));
await browser.close();
console.log(fail.length ? `\n${fail.length} failed` : '\nall checks passed');
process.exit(fail.length ? 1 : 0);
