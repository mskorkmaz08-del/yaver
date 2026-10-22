// Voice chat: fake speech recognition and speech synthesis, mocked Gemini.
// Checks speak → reply read aloud → listens again, and the voice prompt hint.
import { chromium, devices } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  window.__said = []; window.__spoken = []; window.__listens = 0;
  const queue = ['log 20 minutes of python', ''];
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    start() {
      window.__listens++;
      const t = queue.shift() ?? '';
      setTimeout(() => {
        if (t) this.onresult?.({ results: [Object.assign([{ transcript: t }], { isFinal: true })] });
        this.onend?.();
      }, 150);
    }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
  };
  const synth = { speaking: false, pending: false, getVoices: () => [], cancel() {},
    speak(u) { if (u.text.trim()) window.__spoken.push({ text: u.text, lang: u.lang }); setTimeout(() => { u.onstart?.(); setTimeout(() => u.onend?.(), 100); }, 20); } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
});
let lastBody = '';
await page.route('https://generativelanguage.googleapis.com/**', async route => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (route.request().url().includes('/models?')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
  lastBody = route.request().postData() || '';
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Done, **twenty minutes** of Python logged.' }] }, finishReason: 'STOP' }] })}\r\n\r\n` });
});
await page.goto('http://localhost:8765/');
await page.waitForSelector('.sheet');
await page.evaluate(async () => { const db = await import('./js/db.js'); await db.setSetting('onboarded', true); await db.setSetting('geminiKey', 'AIzaSyTestKeyForVoice00000'); await db.setSetting('voiceLang', 'en-US'); });
await page.reload();
await page.waitForTimeout(500);
await page.click('#fab');
await page.click('[data-voice]');
await page.waitForFunction(() => window.__listens >= 2 && document.querySelector('[data-orb]').dataset.state === '', null, { timeout: 15000 });
const r = await page.evaluate(() => ({ listens: window.__listens, spoken: window.__spoken, user: document.querySelector('.msg.user')?.textContent, orbVisible: !document.querySelector('[data-orb]').hidden, label: document.querySelector('[data-orb-label]').textContent }));
console.log(JSON.stringify(r));
const checks = [
  ['heard the request', r.user === 'log 20 minutes of python'],
  ['voice hint sent to the AI', lastBody.includes('Voice chat')],
  ['reply read aloud without markdown', r.spoken[0]?.text === 'Done, twenty minutes of Python logged.'],
  ['listened again after speaking', r.listens === 2],
  ['orb back to tap to talk after silence', r.label === 'tap to talk' && r.orbVisible],
  ['no page errors', !errors.length],
];
await page.evaluate(() => { const o = document.querySelector('[data-orb]'); o.dataset.state = 'listening'; o.querySelector('[data-orb-label]').textContent = 'listening…'; });
await page.screenshot({ path: 'shots/voice.png' }).catch(() => {});
await page.click('[data-voice]');
checks.push(['voice off hides the orb', await page.evaluate(() => document.querySelector('[data-orb]').hidden)]);
for (const [n, ok] of checks) console.log(ok ? 'ok  ' : 'FAIL', n);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(checks.every(c => c[1]) ? 0 : 1);
