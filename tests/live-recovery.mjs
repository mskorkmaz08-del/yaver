// Live voice recovery and Claude-as-a-tool, with a fake Gemini Live WebSocket and a fake Mac bridge.
// 1. The first session hears a question and then goes silent: after the stall timeout
//    Yaver reconnects with the session's resumption handle and asks the question again.
// 2. In the new session the model calls ask_claude: the question goes to the Mac and
//    Claude's answer comes back as the tool response.
import { chromium, devices } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block', permissions: ['microphone'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  window.__live = { sockets: [] };
  const pcm = () => { const a = new Int16Array(2400); let b = ''; new Uint8Array(a.buffer).forEach(x => (b += String.fromCharCode(x))); return btoa(b); };
  class FakeWS {
    constructor(url) { this.n = window.__live.sockets.length; this.log = { audio: 0 }; window.__live.sockets.push(this.log); this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 30); }
    emit(o) { setTimeout(() => this.onmessage?.({ data: JSON.stringify(o) }), 20); }
    send(s) {
      const m = JSON.parse(s);
      if (m.setup) { this.log.setup = m.setup; this.emit({ setupComplete: {} }); if (this.n === 0) this.emit({ sessionResumptionUpdate: { newHandle: 'handle-1', resumable: true } }); return; }
      if (m.realtimeInput) {
        this.log.audio++;
        // Session 1: you ask, and then nothing comes back.
        if (this.n === 0 && this.log.audio === 5) this.emit({ serverContent: { inputTranscription: { text: 'explain recursion' } } });
        return;
      }
      if (m.clientContent) {
        this.log.resent = m.clientContent.turns[0].parts[0].text;
        this.emit({ toolCall: { functionCalls: [{ id: 'q1', name: 'ask_claude', args: { question: 'Explain recursion simply' } }] } });
        return;
      }
      if (m.toolResponse) {
        this.log.toolResponse = m.toolResponse;
        this.emit({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm() } }] }, outputTranscription: { text: 'Claude says recursion is a function calling itself.' } } });
        this.emit({ serverContent: { turnComplete: true } });
      }
    }
    close() { this.readyState = 3; }
  }
  window.WebSocket = FakeWS;
  window.SpeechRecognition = window.webkitSpeechRecognition = class { start() { setTimeout(() => this.onend?.(), 300); } stop() { this.onend?.(); } abort() { this.onend?.(); } };
});
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST' };
await page.route('https://generativelanguage.googleapis.com/**', route => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ models: [{ name: 'models/gemini-live-test', supportedGenerationMethods: ['bidiGenerateContent'] }] }) }));
const macAsked = [];
await page.route('https://test-mac.trycloudflare.com/**', route => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (req.url().endsWith('/health')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '{"ok":true}' });
  macAsked.push(req.postDataJSON().transcript[0].text);
  return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ reply: 'Recursion is a function that calls itself on a smaller problem.' }) });
});
await page.goto('http://localhost:8765/');
await page.waitForSelector('.sheet');
await page.evaluate(async () => {
  const db = await import('./js/db.js');
  await db.setSetting('onboarded', true); await db.setSetting('wakeWord', false);
  await db.setSetting('geminiKey', 'AIzaSyTestKeyForLive000000');
  await db.setSetting('macUrl', 'https://test-mac.trycloudflare.com'); await db.setSetting('macToken', 'test-token');
});
await page.reload();
await page.waitForTimeout(500);
await page.evaluate(async () => (await import('./js/ai/assistant.js')).startVoiceChat());
await page.waitForFunction(() => document.querySelectorAll('.msg.bot').length >= 1, null, { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(300);
const r = await page.evaluate(() => ({ s: window.__live.sockets.map(x => ({ audio: x.audio, handle: x.setup?.sessionResumption?.handle, resumable: !!x.setup?.sessionResumption && !!x.setup?.contextWindowCompression, resent: x.resent, tools: x.setup?.tools?.[0]?.functionDeclarations?.map(f => f.name), tr: x.toolResponse })), msgs: [...document.querySelectorAll('.msg')].map(m => m.textContent) }));
console.log(JSON.stringify({ ...r, macAsked }).slice(0, 600));
const [s1, s2] = r.s;
const checks = [
  ['setup offers ask_claude when the Mac is set up', s1?.tools?.includes('ask_claude')],
  ['setup asks for resumable, compressing sessions', s1?.resumable],
  ['a silent session reconnects with its resumption handle', r.s.length === 2 && s2.handle === 'handle-1'],
  ['the question is asked again after reconnecting', s2?.resent === 'explain recursion'],
  ['ask_claude sends the question to the Mac', macAsked.length === 1 && macAsked[0].startsWith('Explain recursion simply')],
  ["Claude's answer is the tool response", /function that calls itself/.test(s2?.tr?.functionResponses?.[0]?.response?.answer || '')],
  ['both turns land in the chat', r.msgs.includes('explain recursion') && r.msgs.some(m => /Claude says recursion/.test(m))],
  ['no page errors', !errors.length],
];
for (const [n, c] of checks) console.log(c ? 'ok  ' : 'FAIL', n);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(checks.every(c => c[1]) ? 0 : 1);
