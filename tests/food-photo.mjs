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
const calls = [];
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
  if (req.url().includes('/models?')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ models: [{ name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  calls.push(req.url().match(/models\/([^:]+):/)[1]);
  // The main model is overloaded ("high demand"); Flash Lite answers.
  if (req.url().includes('gemini-3-flash:')) return route.fulfill({ status: 503, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } }) });
  if (req.url().includes('streamGenerateContent')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Lite here.' }] }, finishReason: 'STOP' }] })}\r\n\r\n` });
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
check('sends the photo to Gemini', !!req?.contents?.[0]?.parts?.[0]?.inlineData?.data, sent?.url);
check('busy model hands over to Flash Lite', calls.join() === 'gemini-3-flash,gemini-3.1-flash-lite', calls.join());
check('keeps thinking low for speed', req?.generationConfig?.thinkingConfig?.thinkingLevel === 'low');
const remembered = await page.evaluate(async () => (await import('./js/db.js')).setting('foodModel'));
check('remembers the model that answered', remembered === 'gemini-3.1-flash-lite', remembered);
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
// Typed meal: words instead of a photo, same check-and-log sheet.
await page.click('[data-type-meal]');
await page.waitForSelector('.food-sheet textarea[name=note]');
check('typed meal has no photo', !(await page.$('.food-sheet .food-img')));
await page.fill('.food-sheet textarea[name=note]', '2 eggs and black tea with 1 sugar');
await page.click('.food-sheet [data-go]');
await page.waitForSelector('.food-sheet [data-log]', { timeout: 10000 });
const treq = sent.body.contents[0].parts;
check('typed meal sends only the words', treq.length === 1 && !treq[0].inlineData && /2 eggs and black tea with 1 sugar/.test(treq[0].text) && /what the user wrote/.test(treq[0].text));
const nMeals = await page.evaluate(async () => (await import('./js/db.js')).all('meals').length);
await page.click('.food-sheet [data-log]');
await page.waitForTimeout(400);
check('typed meal is logged', await page.evaluate(async n => (await import('./js/db.js')).all('meals').length === n + 1, nMeals));

// The chat also moves to a backup model when the main one is overloaded.
calls.length = 0;
await page.evaluate(async () => { const db = await import('./js/db.js'); await db.setSetting('geminiModel', 'gemini-3-flash'); });
await page.click('#fab');
await page.fill('[data-input]', 'hello');
await page.click('[data-send]');
await page.waitForFunction(() => document.querySelector('.chat-wrap:not(.busy)') && [...document.querySelectorAll('.msg.bot .bot-text')].some(b => /Lite here/.test(b.textContent)), null, { timeout: 15000 }).catch(() => {});
const chat = await page.evaluate(() => [...document.querySelectorAll('.msg.bot .bot-text')].map(b => b.textContent).join(' | '));
check('chat falls back when Gemini is busy', /Lite here/.test(chat) && calls[0] === 'gemini-3-flash', `${calls.join()} → ${chat.slice(0, 60)}`);
check('no page errors', !errors.length, errors.join(' | '));
await browser.close();
console.log(fail.length ? `\n${fail.length} failed` : '\nall checks passed');
process.exit(fail.length ? 1 : 0);
