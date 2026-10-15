// Sync test: an "iPhone" and a "MacBook" (two browser contexts, two databases)
// sync through a mocked api.github.com that keeps gists in memory.
// Run: serve the repo on :8765, then `node tests/sync-test.mjs` where `playwright` resolves.
import { chromium, devices } from 'playwright';

const base = process.env.YAVER_URL || 'http://localhost:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
let failed = 0;
const check = (ok, what, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ` · ${extra}` : ''}`); if (!ok) failed++; };

// ---- In-memory GitHub gists API ----
const gists = new Map();
const uploads = [];
let n = 0;
const TOKEN = 'github_pat_TESTTOKEN0123456789';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
const view = g => ({ id: g.id, description: g.description, public: false, updated_at: g.updated_at, files: Object.fromEntries(Object.entries(g.files).map(([k, v]) => [k, { filename: k, content: v, truncated: false, raw_url: `https://gist.example/${g.id}/${k}` }])) });
async function github(route) {
  const req = route.request();
  const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (req.headers().authorization !== `Bearer ${TOKEN}`) return json(401, { message: 'Bad credentials' });
  const url = new URL(req.url());
  const m = url.pathname.match(/^\/gists(?:\/(\w+))?$/);
  if (!m) return json(404, { message: 'Not Found' });
  const stamp = () => new Date(Date.UTC(2026, 9, 20, 6, 0, ++n)).toISOString();
  if (!m[1] && req.method() === 'GET') return json(200, [...gists.values()].map(g => ({ id: g.id, description: g.description, updated_at: g.updated_at })));
  if (!m[1] && req.method() === 'POST') {
    const b = req.postDataJSON();
    const g = { id: `g${gists.size + 1}`, description: b.description, public: b.public, updated_at: stamp(), files: Object.fromEntries(Object.entries(b.files).map(([k, v]) => [k, v.content])) };
    gists.set(g.id, g);
    uploads.push(JSON.stringify(b));
    return json(201, view(g));
  }
  const g = gists.get(m[1]);
  if (!g) return json(404, { message: 'Not Found' });
  if (req.method() === 'GET') return json(200, view(g));
  if (req.method() === 'PATCH') {
    const b = req.postDataJSON();
    for (const [k, v] of Object.entries(b.files)) { if (v === null) delete g.files[k]; else g.files[k] = v.content; }
    g.updated_at = stamp();
    uploads.push(JSON.stringify(b));
    return json(200, view(g));
  }
  return json(405, {});
}

async function device(name, opts) {
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://api.github.com/**', github);
  await page.goto(base);
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  await page.evaluate(async nm => {
    const db = await import('./js/db.js');
    await db.setSetting('onboarded', true);
    await db.setSetting('deviceName', nm);
    await db.setSetting('apiKey', 'sk-ant-SECRET-KEY');
    await db.setSetting('geminiKey', 'AIzaSECRETGEMINI');
    await db.put('chats', { id: 'main', api: [{ role: 'user', content: 'private chat' }], view: [] });
  }, name);
  return { page, errors, name };
}
const run = (d, fn, arg) => d.page.evaluate(fn, arg);
const syncNow = d => run(d, async () => { const s = await import('./js/sync.js'); try { return await s.syncNow({ confirmEmptyPush: async () => false }); } catch (e) { return { error: e.message, code: e.code }; } });
const setup = (d, pass) => run(d, async ([t, p]) => { const s = await import('./js/sync.js'); try { return await s.setup({ token: t, pass: p }); } catch (e) { return { error: e.message }; } }, [TOKEN, pass]);

const phone = await device('iPhone', devices['iPhone 13']);
const mac = await device('MacBook', { viewport: { width: 1440, height: 900 } });
const PASS = 'correct horse battery staple';

// iPhone has data first, then turns sync on (creates the gist)
await run(phone, async () => {
  const D = await import('./js/data.js'); const db = await import('./js/db.js');
  await D.addExpense({ amount: 1500, category: 'Food', note: 'Plov', date: '2026-10-19' });
  await D.addExpense({ amount: 900, category: 'Transport', note: 'Taxi to delete', date: '2026-10-19' });
  await D.addPractice('problems', 3);
  await D.addWater(2);
  await db.put('courseProgress', { id: 'python-w01-1', lessonId: 'python-w01-1', status: 'done', score: 0.8 });
});
let r = await setup(phone, PASS);
check(r?.ok && gists.size === 1, 'iPhone creates one secret gist', JSON.stringify(r));
const g = [...gists.values()][0];
check(g.description === 'Yaver sync, encrypted' && g.public === false && Object.keys(g.files).join() === 'yaver-sync.enc', 'Gist has the right description, is secret, holds yaver-sync.enc');
const env = JSON.parse(g.files['yaver-sync.enc']);
check(env.alg === 'AES-GCM-256/PBKDF2-SHA256' && env.iter >= 310000 && env.salt && env.iv, 'Payload is an AES-GCM envelope with PBKDF2 ≥ 310k', `iter ${env.iter}`);
const raw = uploads.join('\n');
check(!/Plov|Taxi|python-w01|sk-ant|AIza|SECRET|private chat|correct horse|TESTTOKEN/.test(raw), 'Uploads contain no readable data, keys, token, passphrase or chats');
check(!(await run(phone, async () => localStorage.length)), 'Nothing in localStorage');

// Payload content (decrypted with the passphrase): no keys or chats inside either
const inner = await run(phone, async ([text, p]) => { const c = await import('./js/crypto.js'); return c.decryptJSON(text, p); }, [g.files['yaver-sync.enc'], PASS]);
const kvIds = inner.data.kv.map(r => r.id);
check(!inner.data.chats && !kvIds.some(id => /^(apiKey|geminiKey|provider|sync|deviceId$|deviceName$|autoBackups)/.test(id)), 'Decrypted payload has no API keys, sync settings, device settings or chats', `${kvIds.length} kv rows`);

// MacBook with a wrong passphrase: clear error, nothing changed on either side
const before = g.updated_at;
await run(mac, async () => { const D = await import('./js/data.js'); await D.addExpense({ amount: 300, category: 'Coffee', note: 'Mac coffee', date: '2026-10-20' }); });
r = await setup(mac, 'wrong passphrase here');
check(/passphrase/i.test(r?.error || '') && g.updated_at === before, 'Wrong passphrase: clear error, gist untouched', r?.error);
const macAfterWrong = await run(mac, async () => (await import('./js/db.js')).all('expenses').map(e => e.note));
check(macAfterWrong.join() === 'Mac coffee', 'Wrong passphrase: the Mac\'s own data is unchanged');

// MacBook with the right passphrase: finds the gist by description and merges
await run(mac, async () => { const s = await import('./js/sync.js'); await s.turnOff({ forget: true }); });
r = await setup(mac, PASS);
check(r?.ok && gists.size === 1, 'MacBook finds the existing gist (no second gist)', JSON.stringify(r));
let macData = await run(mac, async () => { const db = await import('./js/db.js'); const D = await import('./js/data.js'); return { notes: db.all('expenses').map(e => e.note).sort(), done: db.get('courseProgress', 'python-w01-1')?.status, chats: db.get('chats', 'main')?.api?.[0]?.content, key: db.setting('apiKey'), backups: db.setting('autoBackups', []).length }; });
check(macData.notes.join() === 'Mac coffee,Plov,Taxi to delete' && macData.done === 'done', 'MacBook has the union of both devices', macData.notes.join());
check(macData.key === 'sk-ant-SECRET-KEY' && macData.chats === 'private chat', 'MacBook keeps its own key and chats');
check(macData.backups === 1, 'A local backup was taken before the first merge');

// Concurrent edits: same record edited on both, newest wins; delete propagates; counters add up
await run(mac, async () => { const D = await import('./js/data.js'); await D.addPractice('problems', 2); await D.addWater(1); });
await run(phone, async () => {
  const db = await import('./js/db.js');
  const p = db.all('expenses').find(e => e.note === 'Plov');
  await db.put('expenses', { ...p, amount: 1600 });
});
await new Promise(r => setTimeout(r, 30));
await run(mac, async () => {
  const db = await import('./js/db.js');
  const p = db.all('expenses').find(e => e.note === 'Plov');
  await db.put('expenses', { ...p, amount: 1700, note: 'Plov (Mac edit, newer)' });
  const t = db.all('expenses').find(e => e.note === 'Taxi to delete');
  await db.remove('expenses', t.id);
});
await syncNow(phone);
await syncNow(mac);
await syncNow(phone);
const both = await Promise.all([phone, mac].map(d => run(d, async () => {
  const db = await import('./js/db.js'); const D = await import('./js/data.js');
  return { notes: db.all('expenses').map(e => `${e.note}:${e.amount}`).sort().join(), water: db.all('kv').filter(r => r.id.startsWith('water:')).reduce((a, r) => a + r.value, 0), probs: db.all('kv').filter(r => r.id.startsWith('practice:problems:')).reduce((a, r) => a + r.value, 0) };
})));
console.log('     iPhone:', JSON.stringify(both[0]), '\n     MacBook:', JSON.stringify(both[1]));
check(both[0].notes === both[1].notes && both[0].notes === 'Mac coffee:300,Plov (Mac edit, newer):1700', 'Newest edit wins and the deletion reached the iPhone');
check(both[0].probs === 5 && both[1].probs === 5 && both[0].water === 3 && both[1].water === 3, 'Per-device counters add up on both (3+2 problems, 2+1 water)');

// Empty device never overwrites a non-empty gist without asking
const empty = await device('Empty', { viewport: { width: 1200, height: 800 } });
const uploadsBefore = uploads.length;
await run(empty, async () => { const db = await import('./js/db.js'); await db.wipe(); });
r = await setup(empty, PASS);
const emptyData = await run(empty, async () => (await import('./js/db.js')).all('expenses').length);
check(uploads.length >= uploadsBefore && emptyData === 2, 'A new empty device pulls the data instead of pushing emptiness', `${emptyData} expenses`);

for (const d of [phone, mac, empty]) check(d.errors.length === 0, `No page errors on ${d.name}`, d.errors.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
