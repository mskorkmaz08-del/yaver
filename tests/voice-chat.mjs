// Voice chat: fake speech recognition and speech synthesis, mocked Gemini.
// Checks speak → reply read aloud → listens again, the voice prompt hint, and the
// natural Gemini voice (mocked PCM audio) with fallback to the phone voice.
import { chromium, devices } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  window.__said = []; window.__spoken = []; window.__listens = 0;
  const queue = ['log 20 minutes of python', '', 'what is a list', '', 'status report', ''];
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
let lastBody = '', ttsCalls = 0;
await page.route('https://generativelanguage.googleapis.com/**', async route => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (route.request().url().includes('/models?')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] }] }) });
  if (route.request().url().includes('-tts:generateContent')) {
    ttsCalls++;
    const pcm = Buffer.alloc(2400 * 2); // 0.1 s of silence at 24 kHz
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] }) });
  }
  lastBody = route.request().postData() || '';
  if (lastBody.includes('status report')) {
    const ev = t => `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: t }] } }] })}\r\n\r\n`;
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: ev('Good evening, sir. ') + ev('All systems are running normally and your streak is intact. ') + ev('Nothing needs your attention.') });
  }
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Done, **twenty minutes** of Python logged.' }] }, finishReason: 'STOP' }] })}\r\n\r\n` });
});
await page.goto('http://localhost:8765/');
await page.waitForSelector('.sheet');
await page.evaluate(async () => { const db = await import('./js/db.js'); await db.setSetting('onboarded', true); await db.setSetting('geminiKey', 'AIzaSyTestKeyForVoice00000'); await db.setSetting('voiceLang', 'en-US'); await db.setSetting('voiceStyle', 'device'); await db.setSetting('voiceV16', true); });
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
// Natural voice: Gemini TTS audio plays instead of the phone voice, then it listens again.
await page.evaluate(async () => { const db = await import('./js/db.js'); await db.setSetting('voiceStyle', 'natural'); });
await page.click('[data-voice]');
await page.waitForFunction(() => window.__listens >= 4 && !document.querySelector('[data-mic]').classList.contains('listening'), null, { timeout: 15000 });
const n = await page.evaluate(() => ({ spoken: window.__spoken.length, listens: window.__listens }));
checks.push(['natural voice used (Gemini TTS called)', ttsCalls === 1]);
checks.push(['phone voice not used when natural works', n.spoken === 1]);
checks.push(['listened again after natural voice', n.listens === 4]);
// Noise trimming and sentence pieces (pure functions).
const audio = await page.evaluate(async () => {
  const V = await import('./js/ai/voice.js');
  const rate = 24000, sine = (s, f) => Array.from({ length: s * rate }, (_, i) => Math.round(8000 * Math.sin(2 * Math.PI * f * i / rate)));
  const quiet = s => new Array(Math.round(s * rate)).fill(0);
  const noise = s => Array.from({ length: s * rate }, () => Math.round((Math.random() * 2 - 1) * 6000));
  const voiced = [...sine(1, 180)];
  const withNoise = Int16Array.from([...quiet(0.4), ...voiced, ...quiet(0.3), ...noise(0.4)]);
  const withSir = Int16Array.from([...voiced, ...quiet(0.25), ...sine(0.3, 150)]);
  const [s1, e1] = V.speechBounds(withNoise, rate), [, e2] = V.speechBounds(withSir, rate);
  return { start: s1 / rate, noiseCut: e1 / rate, sirKept: e2 / rate, pieces: V.chunks('Good evening, sir. The build passed. Two warnings remain in the parser. Shall I list them?') };
});
checks.push(['leading silence trimmed', audio.start > 0.3 && audio.start < 0.4]);
checks.push(['static burst after the last word cut', audio.noiseCut < 1.55]);
checks.push(['a short final word is kept', audio.sirKept > 1.5]);
checks.push(['first sentence voiced on its own', audio.pieces[0] === 'Good evening, sir.' && audio.pieces.length === 2]);
// Streamed reply: first sentence voiced separately, rest as one more piece; thinking off in voice mode.
const before = ttsCalls;
await page.click('[data-orb]');
await page.waitForFunction(() => window.__listens >= 6, null, { timeout: 15000 });
checks.push(['streamed reply voiced in two pieces', ttsCalls - before === 2]);
checks.push(['voice chat turns thinking off', /thinkingBudget":0/.test(lastBody)]);
const picked = await page.evaluate(async () => {
  const V = await import('./js/ai/voice.js');
  const v = (name, lang) => ({ name, lang, voiceURI: name });
  speechSynthesis.getVoices = () => [v('Samantha', 'en-US'), v('Kate', 'en-GB'), v('Daniel', 'en-GB'), v('Arthur (Premium)', 'en-GB'), v('Yelda', 'tr-TR')];
  return [V.pickDeviceVoice('en-GB')?.name, V.pickDeviceVoice('tr-TR')?.name];
});
checks.push(['picks a British male Premium voice, Turkish voice for Turkish', picked[0] === 'Arthur (Premium)' && picked[1] === 'Yelda']);
checks.push(['still no page errors', !errors.length]);
for (const [n, ok] of checks) console.log(ok ? 'ok  ' : 'FAIL', n);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(checks.every(c => c[1]) ? 0 : 1);
