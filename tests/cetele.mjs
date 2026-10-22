// Çetele: defaults seeded, +/−, check items, weekly fasting, streak, Home card,
// reminders and the AI tool. Mocked Gemini calls log_cetele.
import { chromium, devices } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
let step = 0;
await page.route('https://generativelanguage.googleapis.com/**', async route => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (route.request().url().includes('/models?')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
  const part = step++ === 0 ? { functionCall: { name: 'log_cetele', args: { item: 'quran', add: 3 } } } : { text: 'Logged 3 pages of Quran.' };
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [part] }, finishReason: 'STOP' }] })}\r\n\r\n` });
});
await page.goto('http://localhost:8765/');
await page.waitForSelector('.sheet');
await page.evaluate(async () => { const db = await import('./js/db.js'); await db.setSetting('onboarded', true); await db.setSetting('geminiKey', 'AIzaSyTestKeyForCetele0000'); });
await page.goto('http://localhost:8765/#cetele');
await page.reload();
await page.waitForSelector('.ct-row');
const checks = [];
const ok = (n, c) => checks.push([n, !!c]);
ok('seven default items', (await page.$$('.ct-row')).length === 7);
ok('çetele tab highlighted', await page.$eval('.tabbar [data-tab=cetele]', b => b.classList.contains('active')));
// Namaz 5 taps → met
for (let i = 0; i < 5; i++) { await page.click('[data-plus=namaz]'); await page.waitForTimeout(60); }
ok('namaz met after 5', await page.$eval('[data-plus=namaz]', b => b.closest('.ct-row').classList.contains('met')));
await page.click('[data-toggle=tahajjud]'); await page.waitForTimeout(80);
ok('tahajjud checked', await page.$eval('[data-toggle=tahajjud]', b => b.getAttribute('aria-pressed') === 'true'));
await page.click('[data-plus=salawat]'); await page.waitForTimeout(80);
ok('salawat +10', (await page.textContent('[data-set=salawat]')).trim() === '10');
await page.click('[data-minus=salawat]'); await page.waitForTimeout(80);
ok('salawat back to 0', (await page.textContent('[data-set=salawat]')).trim() === '0');
await page.screenshot({ path: 'shots/cetele.png' });
// Fill everything for yesterday and today → streak 2
const streak = await page.evaluate(async () => {
  const CT = await import('./js/cetele.js'); const u = await import('./js/util.js');
  for (const d of [u.addDays(u.today(), -1), u.today()]) for (const it of CT.items()) if (it.per === 'day') await CT.setValue(it.id, it.target, d);
  await CT.add('fasting', 1);
  return { s: CT.streak().current, fast: CT.day().rows.find(r => r.id === 'fasting').progress, complete: CT.day().complete };
});
ok('streak counts yesterday and today', streak.s === 2 && streak.complete);
ok('weekly fasting counts', streak.fast === 1);
// Reset Quran today, check reminder and Home card
await page.evaluate(async () => { const CT = await import('./js/cetele.js'); await CT.setValue('quran', 1); });
await page.goto('http://localhost:8765/#home'); await page.waitForTimeout(400);
const home = await page.textContent('#view');
ok('home çetele card', /çetele/.test(home) && /6\/6 today|5\/6 today/.test(home));
ok('reminder names the open item', /Çetele: Kur'an 4 pages left/.test(home));
await page.screenshot({ path: 'shots/cetele-home.png' });
// AI logs Quran pages
await page.click('#fab');
await page.fill('[data-input]', 'I read 3 pages of Quran');
await page.click('[data-send]');
await page.waitForFunction(() => document.querySelector('.chat-wrap:not(.busy)') && document.querySelectorAll('.msg.bot').length, null, { timeout: 15000 });
await page.waitForTimeout(300);
const q = await page.evaluate(async () => (await import('./js/cetele.js')).valueOn('quran'));
ok('AI log_cetele added 3 pages', q === 4);
ok('receipt shown', (await page.$$('.receipt')).length === 1);
ok('no page errors', !errors.length);
for (const [n, c] of checks) console.log(c ? 'ok  ' : 'FAIL', n);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(checks.every(c => c[1]) ? 0 : 1);
