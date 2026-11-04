// Apple Calendar through the Mac bridge. Starts its own bridge with a fake
// calendar helper (no Mac needed), then checks that Yaver shows the events in
// Meet, counts them for free slots, opens them read only and keeps them out of
// sync. Run from the repo root with the site served on port 8765.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, chmodSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'yaver-cal-'));
const day = new Date(); day.setHours(0, 0, 0, 0);
const at = (h, m = 0) => new Date(day.getTime() + (h * 60 + m) * 60000).toISOString();
const fake = join(dir, 'fake-cal.mjs');
writeFileSync(fake, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(process.argv[2], JSON.stringify({ ok: true, calendars: ['Work', 'Home'], events: [
  { uid: 'a1@1', title: 'Team standup', start: '${at(10)}', end: '${at(10, 30)}', calendar: 'Work', color: '#3b82f6', location: 'Zoom' },
  { uid: 'a2@1', title: 'Dentist', start: '${at(14)}', end: '${at(15)}', calendar: 'Home', notes: 'bring card' },
  { uid: 'a3@1', title: 'Holiday', start: '${at(0)}', end: '${at(24)}', allDay: true, calendar: 'Home' },
] }));
`);
chmodSync(fake, 0o755);

const PORT = 8788;
const bridge = spawn(process.execPath, [join(root, 'bridge/yaver-bridge.mjs')], { env: { ...process.env, YAVER_PORT: String(PORT), YAVER_TUNNEL: '0', YAVER_CAL_BIN: fake }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => bridge.stdout.on('data', d => String(d).includes('running') && r()));
const token = readFileSync(join(homedir(), '.yaver-bridge-token'), 'utf8').trim();
const fail = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' · ' + extra : ''}`); if (!ok) fail.push(name); };

// The endpoint on its own.
const direct = await (await fetch(`http://127.0.0.1:${PORT}/calendar`, { headers: { Authorization: `Bearer ${token}` } })).json();
check('bridge /calendar returns events', direct.events?.length === 3);
check('bridge /calendar needs the token', (await fetch(`http://127.0.0.1:${PORT}/calendar`)).status === 401);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:8765/');
await page.waitForSelector('.sheet');
await page.evaluate(async ({ t, port }) => {
  const db = await import('./js/db.js');
  await db.setSetting('onboarded', true);
  await db.setSetting('macUrl', `http://localhost:${port}`);
  await db.setSetting('macToken', t);
  const D = await import('./js/data.js');
  await D.addEvent({ title: 'Yaver meeting', start: new Date(new Date().setHours(18, 0, 0, 0)).toISOString() });
}, { t: token, port: PORT });
await page.goto('http://localhost:8765/#calendar');
await page.reload();
await page.waitForSelector('.cal-sync');
await page.click('[data-calsync]');
await page.waitForFunction(() => document.querySelectorAll('.event.apple').length === 3, null, { timeout: 15000 });
await page.waitForTimeout(800);
await page.screenshot({ path: join(dir, 'meet.png') });
console.log('screenshot', join(dir, 'meet.png'));
const view = await page.evaluate(() => ({
  apple: [...document.querySelectorAll('.event.apple b')].map(b => b.textContent),
  first: document.querySelector('.event .ev-time')?.textContent,
  line: document.querySelector('.cal-sync')?.textContent.trim(),
  slots: [...document.querySelectorAll('[data-slot]')].map(b => b.textContent),
}));
check('Meet shows the Apple events', view.apple.length === 3, view.apple.join(', '));
check('all-day event comes first', /all/.test(view.first || ''), view.first);
check('sync line says how many', /3 events/.test(view.line) && !/Syncing/.test(view.line), view.line.replace(/\s+/g, ' '));
check('free slots skip Apple busy times', !view.slots.some(s => s.startsWith('10:00') || s.startsWith('14:00')), view.slots.join(' '));
await page.click('.event.apple >> text=Dentist');
await page.waitForSelector('.apple-ev');
const sheetText = await page.textContent('.sheet');
check('Apple event opens read only', /Read only here/.test(sheetText) && !(await page.$('.sheet [data-danger]')));
await page.click('.sheet [data-cancel]');
const state = await page.evaluate(async () => {
  const db = await import('./js/db.js');
  const { runTool } = await import('./js/ai/tools.js');
  const del = await runTool('delete_meeting', { id: 'apple:a2@1' });
  const list = await runTool('list_meetings', {});
  return { synced: 'applecal' in db.syncPayload(), del, list: JSON.stringify(list) };
});
check('Apple events stay out of device sync', !state.synced);
check('assistant cannot delete Apple events', !!state.del?.error, String(state.del?.error || '').slice(0, 60));
check('assistant sees Apple events', /Apple Calendar/.test(state.list));
check('no page errors', !errors.length, errors.join(' | '));
await browser.close();
bridge.kill();
console.log(fail.length ? `\n${fail.length} failed` : '\nall checks passed');
process.exit(fail.length ? 1 : 0);
