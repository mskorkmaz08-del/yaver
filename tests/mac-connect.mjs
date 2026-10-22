// Mac bridge connection code and auto-reconnect. Start a fake ntfy on :8790 and
// `CLAUDE_BIN=<fake> CLOUDFLARED_BIN=<fake> YAVER_NTFY=http://localhost:8790 node bridge/yaver-bridge.mjs`,
// then `node tests/mac-connect.mjs <connection code>`. trycloudflare.com links are routed to the local bridge.
import { chromium, devices } from 'playwright';
const code = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
let dead = 'https://test-link-one.trycloudflare.com';
await page.route(/trycloudflare\.com/, async route => {
  const u = new URL(route.request().url());
  if (u.origin === dead) return route.abort('connectionrefused');
  const r = await route.fetch({ url: `http://localhost:8787${u.pathname}` });
  await route.fulfill({ response: r });
});
await page.route('https://ntfy.sh/**', async route => route.fulfill({ response: await route.fetch({ url: route.request().url().replace('https://ntfy.sh', 'http://localhost:8790') }) }));
await page.goto('http://localhost:8765/');
await page.waitForSelector('.sheet');
await page.evaluate(async () => { const db = await import('./js/db.js'); await db.setSetting('onboarded', true); });
await page.goto('http://localhost:8765/#settings');
await page.reload();
await page.waitForSelector('[data-paste-code]');
dead = '';
await page.evaluate(c => navigator.clipboard.writeText(c), code);
await page.click('[data-paste-code]');
await page.waitForFunction(() => /Connected|saved/i.test(document.querySelector('.toast')?.textContent || ''), null, { timeout: 8000 });
console.log('PASTE', await page.textContent('.toast'));
const url = () => page.evaluate(async () => (await import('./js/db.js')).setting('macUrl'));
console.log('URL', await url());
// Bridge restarted: link one is gone, the bridge posted link two.
dead = 'https://test-link-one.trycloudflare.com';
const token = JSON.parse(Buffer.from(code.split('.')[1], 'base64url')).t;
const topic = await page.evaluate(async t => { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('yaver-bridge:' + t)); return 'yaver-' + [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32); }, token);
await fetch(`http://localhost:8790/${topic}`, { method: 'POST', body: 'https://test-link-two.trycloudflare.com' });
const online = await page.evaluate(async () => (await import('./js/ai/mac.js')).macOnline(true));
console.log('REDISCOVER', online, await url());
console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
await browser.close();
if (!online || errors.length) process.exit(1);
