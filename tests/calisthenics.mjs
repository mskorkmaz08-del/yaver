// CaliCoach link (v67): Yaver reads the camera coach's workouts. First from
// CaliCoach's own database in the same browser (seeded here the way CaliCoach
// saves them), then from a Supabase-shaped server after an email-code sign-in.
// Checks the Body card, the muscle map's sets, the week's trained days,
// Insights and the get_calisthenics tool.
// Run from the repo root with the site on :8765 and the mock server on :8766
// (python3 tests/mock-supabase.py, or any server with the same routes).
import { chromium, devices } from 'playwright';

const MOCK = process.env.MOCK_SUPABASE || 'http://localhost:8766';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const fail = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' · ' + extra : ''}`); if (!ok) fail.push(name); };

// Six push-up workouts with sagging hips, two pull-up workouts, squats: in CaliCoach's session format.
function sessions() {
  const out = [], day = 86400e3, now = Date.now();
  const set = (exercise, reps, clean, score, faults, bottom) => ({
    exercise, kind: 'reps', reps, clean, score, tempo: 2.1, faults,
    repList: Array.from({ length: reps }, (_, i) => ({ n: i + 1, score, clean: i < clean, bottom, top: 165, ecc: 1.1, con: 0.9, faults: i < (faults.hip_sag || 0) ? [{ key: 'hip_sag' }] : [] })),
  });
  for (let k = 0; k < 6; k++) {
    const start = now - (12 - k * 2) * day;
    out.push({ id: `w${k}`, start, end: start + 1800e3, source: 'camera', sets: [
      set('push_up', 12 + k, 10 + k, 80, { hip_sag: 6 }, 88),
      set('push_up', 10 + k, 9 + k, 82, { hip_sag: 5 }, 90),
      ...(k >= 4 ? [set('pull_up', 6, 5, 90, {}, 60), set('pull_up', 5, 5, 92, {}, 62)] : []),
      set('squat', 20, 20, 95, {}, 85),
    ] });
  }
  return out;
}

await page.goto('http://localhost:8765/');
await page.waitForSelector('.sheet');
await page.evaluate(async () => { const db = await import('./js/db.js'); await db.setSetting('onboarded', true); await db.setSetting('bodyHeight', 178); });
await page.reload();
await page.waitForSelector('.cetdial');
await page.evaluate(async () => { const B = await import('./js/body.js'); await B.logWeight({ kg: 78 }); });

const seeded = sessions();
// ---- 2. Same browser: seed CaliCoach's own database, as CaliCoach would
await page.evaluate(async rows => {
  await new Promise((res, rej) => {
    const r = indexedDB.open('calicoach', 2);
    r.onupgradeneeded = () => { for (const s of ['sessions', 'examples', 'clips', 'captures', 'references']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, s === 'references' ? { keyPath: 'exercise' } : s === 'examples' || s === 'clips' ? { keyPath: 'id', autoIncrement: true } : { keyPath: 'id' }); };
    r.onsuccess = () => { const tx = r.result.transaction('sessions', 'readwrite'); for (const x of rows) tx.objectStore('sessions').put(x); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error); };
    r.onerror = () => rej(r.error);
  });
}, seeded.slice(0, 4));
const local = await page.evaluate(async () => { const CA = await import('./js/calisthenics.js'); const ok = await CA.refresh({ force: true }); return { ok, n: CA.workouts().length, st: CA.status() }; });
check('reads CaliCoach in the same browser', local.ok && local.n === 4, JSON.stringify(local.st));

// ---- 3. The server: sign in with the emailed code, then read every workout
await fetch(`${MOCK}/__reset`, { method: 'POST' });
await fetch(`${MOCK}/__seed`, { method: 'POST', body: JSON.stringify(seeded.map(x => ({ id: x.id, started_at: new Date(x.start).toISOString(), ended_at: new Date(x.end).toISOString(), source: 'camera', data: x }))) });
const server = await page.evaluate(async mock => {
  const db = await import('./js/db.js'); const CA = await import('./js/calisthenics.js');
  await db.setSetting('caliUrl', mock); await db.setSetting('caliKey', 'anon-key'); await db.setSetting('caliEmail', 'me@test.dev');
  await CA.sendCode('me@test.dev');
  let wrong = null;
  try { await CA.verifyCode('me@test.dev', '000000'); } catch (e) { wrong = e.message; }
  await CA.verifyCode('me@test.dev', '123456');
  const ok = await CA.refresh({ force: true });
  return { wrong, ok, signed: CA.signedIn(), n: CA.workouts().length, st: CA.status(), synced: 'calisthenics' in db.syncPayload() || db.syncPayload().kv.some(r => r.id.startsWith('cali')), local: db.isLocalKey('caliAuth') };
}, MOCK);
check('wrong code is refused', !!server.wrong, server.wrong);
check('reads all workouts from the server', server.ok && server.signed && server.n === 6, JSON.stringify(server.st));
check('sign-in token stays on the device', server.local === true);
check('workouts and server login are not in the encrypted sync', server.synced === false);

// ---- 4. Analysis
const an = await page.evaluate(async () => {
  const CA = await import('./js/calisthenics.js'); const T = await import('./js/training.js'); const IN = await import('./js/insights.js');
  const push = CA.exercise('push_up');
  return { push, sets: T.setsThisWeek(), weekDone: T.week().filter(d => d.done).length, insights: IN.all().map(i => i.id), balance: CA.balance(14) };
});
check('push-up history and best set', an.push.sessions === 6 && an.push.lastBestSet === 15, `best ${an.push.lastBestSet}, form ${an.push.lastScore}`);
check('hip sag is the top fault', an.push.faults[0]?.key === 'hip_sag', `${an.push.faults[0]?.share}%`);
check('next step: fix form first', an.push.next.kind === 'form', an.push.next.text);
check('muscle map counts calisthenics sets', (an.sets.chest || 0) >= 4 && (an.sets['upper-back'] || 0) >= 2, `chest ${an.sets.chest}, upper back ${an.sets['upper-back']}`);
check('CaliCoach days count as trained', an.weekDone >= 1, `${an.weekDone} days this week`);
check('insight: recurring fault', an.insights.some(i => i.startsWith('cali-fault-push_up')), an.insights.join(', '));
check('insight: push/pull balance', an.insights.includes('cali-balance'), JSON.stringify(an.balance));

// ---- 5. The Body card
const opened = await page.evaluate(async () => {
  const v = await import('./js/views/body.js');
  const root = document.createElement('div'); root.id = 'calitest'; document.body.appendChild(root);
  v.render(root, () => {});
  return root.querySelector('.cali')?.innerText || '';
});
check('Body card shows the exercises', /Push-ups/.test(opened) && /Pull-ups/.test(opened) && /best clean set/i.test(opened), opened.replace(/\s+/g, ' ').slice(0, 160));
check('Body card has the next step and plan button', /Fix hips sagging/i.test(opened) && /Plan my next sessions/.test(opened));

// ---- 6. The assistant's tool
const tool = await page.evaluate(async () => { const t = await import('./js/ai/tools.js'); return t.runTool('get_calisthenics', {}); });
check('get_calisthenics gives the assistant everything', tool.workouts === 6 && tool.exercises?.length === 3 && tool.repsByPattern14Days?.push > 0, `${tool.workouts} workouts, ${tool.exercises?.length} exercises`);

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
if (fail.length) { console.log(`\n${fail.length} failed`); process.exit(1); }
console.log('\nall calisthenics checks passed');
