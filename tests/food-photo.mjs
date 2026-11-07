// Food photo: Diet → Photo a meal → Estimate (Gemini mocked) → change a weight
// → log. Checks the two requests (v55: a Google Search research step, then the
// JSON-schema answer), scaling, the logged meal's extras (fat quality, sources),
// the nutrients card, and the Fill the gaps suggestions. Run from the repo root with the site on :8765.
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
let sent = null, research = null, tipsReq = null;
const calls = [];
const answer = {
  dish: 'Plov with salad', meal: 'Lunch', confidence: 'medium', note: 'Oil in the rice is hard to see.',
  items: [
    { name: 'Plov', grams: 300, calories: 540, protein: 21, carbs: 66, fat: 21, fiber: 3, sugar: 4, sodium: 690, potassium: 420, calcium: 45, iron: 2.7, magnesium: 60, zinc: 3.6, vitaminA: 450, vitaminC: 3, vitaminD: 0, vitaminB12: 1.5, caffeine: 0, satFat: 4, monoFat: 6, polyFat: 10, omega3: 0.2, basis: '26 cm plate, about half covered', source: 'local plov recipe' },
    { name: 'Tomato cucumber salad', grams: 120, calories: 60, protein: 1.5, carbs: 6, fat: 3.5, fiber: 1.8, sugar: 3.6, sodium: 180, potassium: 260, calcium: 18, iron: 0.4, magnesium: 14, zinc: 0.2, vitaminA: 40, vitaminC: 14, vitaminD: 0, vitaminB12: 0, caffeine: 0, satFat: 0.5, monoFat: 0.8, polyFat: 2, omega3: 0.1 },
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
  const body = req.postDataJSON();
  const ok = obj => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(obj) });
  // Step 1: research with Google Search, answered as notes plus the pages used.
  if (body.tools?.[0]?.google_search) {
    research = { url: req.url(), body };
    return ok({ candidates: [{ content: { parts: [{ text: 'Plov 300 g: Kazakh plov recipe uses about 30 ml cottonseed oil per portion...' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.org/plov', title: 'eda.kz' } }] } }] });
  }
  if (body.generationConfig?.responseSchema?.properties?.summary) {
    tipsReq = body;
    return ok({ candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: 'Lots of seed oil today and little omega-3.', items: [{ food: 'Baked mackerel', amount: '150 g', when: 'Dinner', why: 'omega-3 3 g, protein 28 g' }, { food: 'Kefir', amount: '1 glass (250 ml)', when: 'Snack', why: 'calcium 30%' }], ease_off: 'Fried food in seed oil' }) }] } }] });
  }
  sent = { url: req.url(), body };
  await new Promise(r => setTimeout(r, 300));
  return ok({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
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
check('first looks things up with Google Search', !!research?.body?.contents?.[0]?.parts?.[0]?.inlineData?.data && /brand, logo, label/.test(research.body.contents[0].parts[1].text) && /Kazakhstan/.test(research.body.contents[0].parts[1].text));
check('the answer step uses the research notes', /cottonseed oil/.test(req?.contents?.[0]?.parts?.[1]?.text || ''));
check('busy model hands over to Flash Lite', calls.join() === 'gemini-3-flash,gemini-3.1-flash-lite,gemini-3.1-flash-lite', calls.join());
check('keeps thinking low for speed', req?.generationConfig?.thinkingConfig?.thinkingLevel === 'low');
const remembered = await page.evaluate(async () => (await import('./js/db.js')).setting('foodModel'));
check('remembers the model that answered', remembered === 'gemini-3.1-flash-lite', remembered);
check('asks for JSON with a schema', req?.generationConfig?.responseMimeType === 'application/json' && !!req.generationConfig.responseSchema?.properties?.items);
check('research measures against reference objects and includes the note', /reference objects/.test(research?.body.contents[0].parts[1].text) && /never from a "standard serving"/.test(research?.body.contents[0].parts[1].text) && /lots of oil/.test(research?.body.contents[0].parts[1].text));
check('shows how each amount was judged', /26 cm plate/.test(await page.textContent('.food-sheet .food-items')));
check('shows what was looked up', /eda\.kz/.test(await page.textContent('.food-sheet .food-sources')));
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
check('meal logged with extras', meal?.name === 'Plov with salad' && meal.meal === 'Lunch' && meal.calories === 330 && meal.protein === 12 && meal.source === 'photo' && meal.items?.length === 2 && meal.micros?.vitaminC > 0 && meal.micros?.polyFat > 0 && meal.sources?.[0]?.title === 'eda.kz' && /plate/.test(meal.items[0].basis), JSON.stringify({ c: meal?.calories, p: meal?.protein, f: meal?.fiber, na: meal?.sodium }));
const card = await page.evaluate(() => [...document.querySelectorAll('.nutrients .nut span')].map(s => s.textContent));
check('nutrients card shows fiber, sodium and vitamins', card.includes('Fiber') && card.includes('Sodium') && card.includes('Vitamin C'), card.join(', '));
check('nutrients card shows the fat split', /poly \d+%/.test(await page.textContent('.nutrients .fat-mix')) && card.includes('Omega-3'));
// Fill the gaps: Yaver sends the day's gaps (fat split included), shows the foods.
await page.click('[data-tips]');
await page.waitForSelector('.tips .tip', { timeout: 10000 });
const tipsText = tipsReq?.contents?.[0]?.parts?.[0]?.text || '';
check('suggestions are asked with the day\'s gaps', /polyunsaturated \d+%/.test(tipsText) && /Kazakhstan/.test(tipsText) && /Today so far: 330/.test(tipsText), tipsText.slice(0, 80));
check('suggestions show foods with amounts', /Baked mackerel/.test(await page.textContent('.tips')) && /150 g/.test(await page.textContent('.tips')));
await page.screenshot({ path: join(dir, 'diet.png'), fullPage: true });
// Typed meal: words instead of a photo, same check-and-log sheet.
await page.click('[data-type-meal]');
await page.waitForSelector('.food-sheet textarea[name=note]');
check('typed meal has no photo', !(await page.$('.food-sheet .food-img')));
await page.fill('.food-sheet textarea[name=note]', '2 eggs and black tea with 1 sugar');
await page.click('.food-sheet [data-go]');
await page.waitForSelector('.food-sheet [data-log]', { timeout: 10000 });
const treq = research.body.contents[0].parts;
check('typed meal sends only the words', treq.length === 1 && !treq[0].inlineData && /2 eggs and black tea with 1 sugar/.test(treq[0].text) && /The user wrote what they ate/.test(treq[0].text));
const nMeals = await page.evaluate(async () => (await import('./js/db.js')).all('meals').length);
await page.click('.food-sheet [data-log]');
await page.waitForTimeout(400);
check('typed meal is logged', await page.evaluate(async n => (await import('./js/db.js')).all('meals').length === n + 1, nMeals));
check('suggestions offer an update after more food', /Update/.test(await page.textContent('[data-tips]')));

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
