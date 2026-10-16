// Mac bridge: run `CLAUDE_BIN=<fake> node bridge/yaver-bridge.mjs` first, then
// `node tests/mac-bridge.mjs <token>`. Checks Mac-first routing and Gemini fallback.
import { chromium, devices } from 'playwright';
const token = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
let geminiCalls = 0;
await page.route('https://generativelanguage.googleapis.com/**', async route => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (route.request().url().includes('/models?')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
  geminiCalls++;
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Gemini here.' }] }, finishReason: 'STOP' }] })}\r\n\r\n` });
});
await page.goto('http://localhost:8765/');
await page.waitForSelector('.sheet');
await page.evaluate(async t => {
  const db = await import('./js/db.js');
  await db.setSetting('onboarded', true);
  await db.setSetting('geminiKey', 'AIzaSyTestKeyForFallback000');
  await db.setSetting('macUrl', 'http://localhost:8787/');
  await db.setSetting('macToken', t);
}, token);
await page.reload();
await page.waitForTimeout(600);
const ask = async q => {
  await page.fill('[data-input]', q);
  await page.click('[data-send]');
  await page.waitForFunction(() => document.querySelector('.chat-wrap:not(.busy)'), null, { timeout: 15000 });
  await page.waitForTimeout(200);
  return page.evaluate(() => { const b = [...document.querySelectorAll('.msg.bot')].at(-1); return { text: b.querySelector('.bot-text').textContent, via: b.querySelector('.via')?.textContent, receipts: b.querySelectorAll('.receipt').length }; });
};
await page.click('#fab');
console.log('MAC', JSON.stringify(await ask('log 30 min of python')));
console.log('COURSE', JSON.stringify(await ask('what is on today in my course?')));
console.log('SESSIONS', await page.evaluate(async () => (await import('./js/db.js')).all('sessions').length));
await page.evaluate(async () => { const db = await import('./js/db.js'); await db.setSetting('macUrl', 'http://localhost:8799'); });
await page.waitForTimeout(31000); // let the 30s online cache expire
console.log('FALLBACK', JSON.stringify(await ask('hello')), 'geminiCalls', geminiCalls);
console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
await browser.close();
