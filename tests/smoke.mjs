import { chromium, devices } from 'playwright';
const base = 'http://localhost:8765/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block', geolocation: { latitude: 43.2389, longitude: 76.8897 }, permissions: ['geolocation'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const sse = evs => evs.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const start = { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } };
const requests = [];
await page.route('https://api.anthropic.com/**', async route => {
  const body = route.request().postDataJSON();
  requests.push({ url: route.request().url(), headers: route.request().headers(), body });
  const last = body.messages.at(-1);
  const isToolResult = Array.isArray(last.content) && last.content.some(b => b.type === 'tool_result');
  let evs;
  if (!isToolResult) {
    evs = [start,
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'On it. ' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'add_expense', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"amount": 120, "category": "Food", "note": "Lunch"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_2', name: 'add_meeting', input: {} } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ title: 'Meeting with Ayşe', start: new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T15:00' }) } },
      { type: 'content_block_stop', index: 2 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 30 } },
      { type: 'message_stop' }];
  } else {
    evs = [start,
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Logged **120** for lunch and booked Ayşe for tomorrow 15:00.\n- Budget left: plenty\n- Streak: keep going' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 30 } },
      { type: 'message_stop' }];
  }
  await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sse(evs) });
});

// Gemini: list models, then stream a function call, then a text answer.
const gRequests = [];
await page.route('https://generativelanguage.googleapis.com/**', async route => {
  const url = route.request().url();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET,POST' } });
  if (url.includes('/models?')) {
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ models: [
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3-flash-preview', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }] }) });
  }
  const body = route.request().postDataJSON();
  gRequests.push({ url, headers: route.request().headers(), body });
  const last = body.contents.at(-1);
  const isResult = last.parts.some(p => p.functionResponse);
  const chunks = isResult
    ? [{ candidates: [{ content: { role: 'model', parts: [{ text: 'Logged 45 min of ' }] } }] }, { candidates: [{ content: { role: 'model', parts: [{ text: 'Algorithms.' }] }, finishReason: 'STOP' }] }]
    : [{ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'log_study', args: { subject: 'Algorithms', minutes: 45 } }, thoughtSignature: 'sig123' }] }, finishReason: 'STOP' }] }];
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: chunks.map(c => `data: ${JSON.stringify(c)}\r\n\r\n`).join('') });
});

await page.route('https://tile.openstreetmap.org/**', r => r.fulfill({ status: 204 }));
await page.route('https://overpass-api.de/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ elements: [
  { type: 'node', lat: 43.2395, lon: 76.8905, tags: { name: 'Arbat Pharmacy', 'addr:street': 'Abay Ave', 'addr:housenumber': '12', opening_hours: '08:00-22:00' } },
  { type: 'node', lat: 43.2410, lon: 76.8870, tags: { name: 'Europharma' } }] }) }));
await page.goto(base);
await page.waitForSelector('.sheet');
await page.screenshot({ path: 'tests/shots/0-onboarding.png' });
await page.fill('input[name=userName]', 'Mustafa');
await page.selectOption('select[name=currency]', 'KZT');
await page.fill('input[name=apiKey]', 'AIzaTestKey');
await page.click('.sheet button[type=submit]');
await page.waitForTimeout(500);

// Seed some data through the real forms/logic
await page.evaluate(async () => {
  const D = await import('./js/data.js');
  const U = await import('./js/util.js');
  const db = await import('./js/db.js');
  await db.setSetting('monthlyBudget', 15000);
  const t = U.today();
  for (const [a, c, n, d] of [[85, 'Coffee', 'Latte', 0], [420, 'Groceries', 'Migros', -1], [250, 'Transport', 'Taxi', -2], [1200, 'Bills', 'Phone', -5], [380, 'Food', 'Dinner with Ali', -3]]) await D.addExpense({ amount: a, category: c, note: n, date: U.addDays(t, d) });
  for (let i = 0; i < 9; i++) await D.logStudy({ subject: i % 2 ? 'Physics' : 'Mathematics', minutes: 30 + i * 10, date: U.addDays(t, -i) });
  await D.addEvent({ title: 'Project sync', start: `${t}T18:00`, location: 'Zoom' });
  await D.addEvent({ title: 'Advisor meeting', start: `${U.addDays(t, 2)}T10:30` });
  await D.logMeal({ name: 'Menemen & simit', meal: 'Breakfast', calories: 520, protein: 22, carbs: 48, fat: 26 });
  await D.logMeal({ name: 'Chicken döner', meal: 'Lunch', calories: 680, protein: 42, carbs: 60, fat: 28 });
  await D.addTask({ title: 'Submit lab report', due: U.addDays(t, 1) });
  await db.setSetting(`water:${t}`, 3);
});
await page.waitForTimeout(400);
await page.screenshot({ path: 'tests/shots/1-home.png', fullPage: true });
// Load the bundled ML roadmap through the Study tab
await page.click('.tabbar [data-tab=study]');
await page.waitForTimeout(300);
await page.click('[data-load-plan]');
await page.waitForTimeout(800);
for (const tab of ['money', 'calendar', 'study', 'diet']) {
  await page.click(`.tabbar [data-tab=${tab}]`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `shots/2-${tab}.png`, fullPage: true });
}
// Map with nearby search
await page.click('.tabbar [data-tab=map]');
await page.waitForTimeout(1200);
await page.click('[data-cat=pharmacy]');
await page.waitForSelector('.place-row', { timeout: 8000 });
await page.waitForTimeout(500);
await page.screenshot({ path: 'tests/shots/2-map.png', fullPage: true });
// Focus timer
await page.click('.tabbar [data-tab=study]');
await page.waitForTimeout(300);
await page.click('[data-start="25"]');
await page.waitForTimeout(1200);
await page.screenshot({ path: 'tests/shots/3-timer.png' });
await page.click('[data-cancel]');

await page.goto(base + '#settings');
await page.waitForTimeout(400);
await page.screenshot({ path: 'tests/shots/4-settings.png', fullPage: true });

// Assistant on Gemini (free)
await page.click('#fab');
await page.fill('[data-input]', 'log 45 min of algorithms');
await page.click('[data-send]');
await page.waitForFunction(() => document.querySelector('.chat-wrap:not(.busy)') && document.querySelectorAll('.receipt').length >= 1, null, { timeout: 10000 });
await page.screenshot({ path: 'tests/shots/5-chat-gemini.png' });
const gstate = await page.evaluate(async () => {
  const db = await import('./js/db.js');
  return { provider: db.setting('provider'), model: db.setting('geminiModel'), gapi: db.get('chats', 'main').gapi.map(m => m.role + ':' + m.parts.map(p => Object.keys(p).join('+')).join('|')), lastBot: document.querySelector('.msg.bot:last-child .bot-text').textContent };
});
console.log('GEMINI', JSON.stringify(gstate));
console.log('G-REQ', gRequests.length, gRequests[0].url, 'key', gRequests[0].headers['x-goog-api-key'], 'tools', gRequests[0].body.tools[0].functionDeclarations.length, 'sigBack', JSON.stringify(gRequests[1].body.contents.at(-2).parts[0].thoughtSignature));
await page.click('[data-new]');

// Switch to Claude
await page.evaluate(async () => { const db = await import('./js/db.js'); await db.setSetting('apiKey', 'sk-ant-test'); await db.setSetting('provider', 'anthropic'); });
await page.waitForTimeout(300);
await page.waitForTimeout(500);
await page.screenshot({ path: 'tests/shots/5-chat-empty.png' });
await page.fill('[data-input]', 'spent 120 on lunch, and set a meeting with Ayşe tomorrow at 3');
await page.click('[data-send]');
await page.waitForFunction(() => document.querySelector('.chat-wrap:not(.busy)') && document.querySelectorAll('.receipt').length >= 2, null, { timeout: 10000 });
await page.waitForTimeout(300);
await page.screenshot({ path: 'tests/shots/6-chat-reply.png' });

const state = await page.evaluate(async () => {
  const db = await import('./js/db.js');
  return { expenses: db.all('expenses').length, events: db.all('events').map(e => e.title), chatApi: db.get('chats', 'main').api.length, milestones: db.all('milestones').length, plan: db.setting('plan')?.title, currency: db.setting('currency') };
});
console.log('STATE', JSON.stringify(state));
console.log('REQUESTS', requests.length, requests.map(r => r.url).join(' '));
const r0 = requests[0];
console.log('HEADERS', r0.headers['anthropic-beta'], r0.headers['anthropic-dangerous-direct-browser-access'], r0.headers['x-api-key']);
console.log('BODY keys', Object.keys(r0.body).join(','), 'model', r0.body.model, 'effort', JSON.stringify(r0.body.output_config), 'fallbacks', r0.body.fallbacks, 'tools', r0.body.tools.length);
console.log('MSG2 roles', requests[1].body.messages.map(m => m.role).join(','));
console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
await browser.close();
