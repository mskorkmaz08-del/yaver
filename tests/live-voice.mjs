// Live voice: fake microphone (Chromium flags) and a fake Gemini Live WebSocket.
// Starts from the wake word (fake recognition hears "hey Yaver"). Checks the setup message, 16 kHz audio streaming, a tool call (log_cetele),
// the model's audio playing, and both turns landing in the chat.
import { chromium, devices } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block', permissions: ['microphone'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  window.__live = { sent: [], audio: 0 };
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; window.__live.url = url; setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 30); }
    emit(o) { setTimeout(() => this.onmessage?.({ data: JSON.stringify(o) }), 20); }
    send(s) {
      const m = JSON.parse(s);
      if (m.setup) { window.__live.setup = m.setup; this.emit({ setupComplete: {} }); return; }
      if (m.realtimeInput) {
        window.__live.audio++; window.__live.mime = m.realtimeInput.audio.mimeType;
        if (window.__live.audio === 5) {
          this.emit({ serverContent: { inputTranscription: { text: 'log two pages of quran' } } });
          this.emit({ toolCall: { functionCalls: [{ id: 'c1', name: 'log_cetele', args: { item: 'quran', add: 2 } }] } });
        }
        return;
      }
      if (m.toolResponse) {
        window.__live.toolResponse = m.toolResponse;
        const pcm = new Int16Array(4800); // 0.2 s at 24 kHz
        let bin = ''; new Uint8Array(pcm.buffer).forEach(b => (bin += String.fromCharCode(b)));
        this.emit({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: btoa(bin) } }] }, outputTranscription: { text: 'Two pages logged, sir.' } } });
        this.emit({ serverContent: { turnComplete: true } });
      }
    }
    close() { this.readyState = 3; }
  }
  window.WebSocket = FakeWS;
  window.__wake = 0;
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    start() { window.__wake++; if (window.__wake === 2) setTimeout(() => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'hey Yaver' }], { isFinal: false })] }), 100); else setTimeout(() => this.onend?.(), 300); }
    stop() { this.onend?.(); } abort() { this.onend?.(); }
  };
});
await page.route('https://generativelanguage.googleapis.com/**', route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-live-test', supportedGenerationMethods: ['bidiGenerateContent'] }] }) }));
await page.goto('http://localhost:8765/');
await page.waitForSelector('.sheet');
await page.evaluate(async () => { const db = await import('./js/db.js'); await db.setSetting('onboarded', true); await db.setSetting('geminiKey', 'AIzaSyTestKeyForLive000000'); });
await page.reload();
await page.waitForTimeout(500);
await page.mouse.click(5, 300); // any tap unlocks sound
await page.waitForFunction(() => document.querySelector('.chat-wrap.open.voice'), null, { timeout: 10000 });
await page.waitForFunction(() => document.querySelectorAll('.msg.bot').length >= 1, null, { timeout: 15000 });
await page.waitForTimeout(400);
const r = await page.evaluate(async () => ({
  live: { model: window.__live.setup?.model, tools: window.__live.setup?.tools?.[0]?.functionDeclarations?.length, modal: window.__live.setup?.generationConfig?.responseModalities, voice: window.__live.setup?.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName, mime: window.__live.mime, audio: window.__live.audio, keyInUrl: /key=AIza/.test(window.__live.url), tr: window.__live.toolResponse },
  msgs: [...document.querySelectorAll('.msg')].map(m => m.textContent),
  quran: (await import('./js/cetele.js')).valueOn('quran'),
  orb: document.querySelector('[data-orb]').dataset.state,
}));
console.log(JSON.stringify(r));
const checks = [
  ['wake word opened voice chat', r.msgs.length >= 2],
  ['picked a live model from the list', r.live.model === 'models/gemini-live-test'],
  ['setup has audio output, voice and tools', r.live.modal?.[0] === 'AUDIO' && r.live.voice === 'Charon' && r.live.tools > 20],
  ['streams 16 kHz mic audio', r.live.mime === 'audio/pcm;rate=16000' && r.live.audio >= 5],
  ['tool call ran (2 Quran pages)', r.quran === 2 && r.live.tr?.functionResponses?.[0]?.id === 'c1'],
  ['both turns in the chat with a receipt', r.msgs[0] === 'log two pages of quran' && /Two pages logged, sir\./.test(r.msgs[1]) && /live/.test(r.msgs[1]) && /Çetele/.test(r.msgs[1])],
  ['no page errors', !errors.length],
];
await page.click('[data-voice]');
checks.push(['ending voice chat hides the orb', await page.evaluate(() => document.querySelector('[data-orb]').hidden)]);
for (const [n, c] of checks) console.log(c ? 'ok  ' : 'FAIL', n);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(checks.every(c => c[1]) ? 0 : 1);
