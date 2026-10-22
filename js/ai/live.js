// Live voice: a real-time conversation with Gemini's Live API over a WebSocket.
// The microphone streams straight to the model and its own voice streams back,
// with no speech-to-text and text-to-speech steps in between, so it answers in
// about a second and you can talk over it. Yaver's tools still work: the model
// asks for a tool call, the phone runs it and sends the result back.
import * as db from '../db.js';
import { runTool, WRITE_TOOLS, describeAction } from './tools.js';
import { STATIC_SYSTEM, dynamicContext } from './claude.js';
import { functionDeclarations } from './gemini.js';
import { audioCtx } from './voice.js';

const workletReady = new WeakSet();

const WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const API = 'https://generativelanguage.googleapis.com/v1beta';
const key = () => db.setting('geminiKey', '').trim();
export const liveAvailable = () => !!key() && 'WebSocket' in window && !!navigator.mediaDevices?.getUserMedia && 'AudioWorkletNode' in window;

// Models this key can use for live sessions, stable before preview.
let liveModels;
async function pickLiveModel() {
  if (db.setting('liveModel', '')) return db.setting('liveModel');
  if (!liveModels) {
    const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key() } }).catch(() => null);
    const list = res?.ok ? (await res.json()).models || [] : [];
    const ver = n => parseFloat((n.match(/gemini-([\d.]+)/) || [0, 0])[1]);
    liveModels = list.filter(m => (m.supportedGenerationMethods || []).includes('bidiGenerateContent')).map(m => m.name.replace('models/', ''))
      .sort((a, b) => /preview|exp/.test(a) - /preview|exp/.test(b) || /native-audio/.test(b) - /native-audio/.test(a) || ver(b) - ver(a));
  }
  return liveModels[0] || 'gemini-3.8-live';
}

// Captures the mic at the device rate and hands out 16 kHz 16-bit PCM in ~40 ms chunks.
const WORKLET = `
class Down extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.ratio = sampleRate / 16000; this.pos = 0; }
  process(inputs) {
    const ch = inputs[0][0];
    if (!ch) return true;
    for (; this.pos < ch.length; this.pos += this.ratio) this.buf.push(ch[Math.floor(this.pos)]);
    this.pos -= ch.length;
    if (this.buf.length >= 640) {
      const out = new Int16Array(this.buf.length);
      for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, this.buf[i])) * 0x7fff;
      this.port.postMessage(out.buffer, [out.buffer]);
      this.buf = [];
    }
    return true;
  }
}
registerProcessor('yaver-down', Down);`;

const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

function systemText() {
  const jarvis = db.setting('jarvis', true);
  return `${STATIC_SYSTEM}

This is a live voice conversation: you are heard, not read. Answer in a few short spoken sentences; no lists, markdown or code unless asked. Act on clear requests with your tools straight away and confirm in a few words.${jarvis ? ' Speak like JARVIS: calm, precise and understated, with a British accent and British English, a touch of dry wit; now and then address the user as "sir". No American filler.' : ''}
Web search is not available here.

${dynamicContext()}`;
}

// Faster turn-taking: end the user's turn after a short pause instead of the default.
const VAD = { automaticActivityDetection: { endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH', silenceDurationMs: 500, prefixPaddingMs: 100 } };

// Starts a session. Callbacks: onState('connecting'|'listening'|'speaking'|'ended'),
// onUser(text) and onModel(text) with each finished turn's transcript, onAction(label),
// onError(message, fatal), onIdle() after 90 s of quiet. Returns { stop, interrupt }.
// For speed, the microphone, the model choice and the connection all start at once,
// and what you say before the connection is ready is buffered and sent when it is.
export async function startLive(cb = {}, { tuned = true } = {}) {
  const { onState, onUser, onModel, onAction, onError, onIdle } = cb;
  onState?.('connecting');
  // Reuse the audio output Yaver unlocked on an earlier tap; resume it inside this tap.
  const ctx = audioCtx();
  const resumed = ctx.resume().catch(() => {});
  const modelP = pickLiveModel();
  const micP = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  const model = await modelP;
  const ws = new WebSocket(`${WS}?key=${encodeURIComponent(key())}`);
  let mic;
  try { mic = await micP; }
  catch { try { ws.close(); } catch {} throw new Error('Yaver needs the microphone for live voice. Allow it in iPhone Settings → Safari → Microphone.'); }
  await resumed;
  if (!workletReady.has(ctx)) { await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))); workletReady.add(ctx); }
  const src = ctx.createMediaStreamSource(mic);
  const down = new AudioWorkletNode(ctx, 'yaver-down');
  const sink = ctx.createGain(); sink.gain.value = 0; // keeps the worklet running without echoing the mic
  src.connect(down); down.connect(sink); sink.connect(ctx.destination);

  let ready = false, closed = false, nextAt = 0, userText = '', modelText = '', speakingTimer, idleTimer;
  const early = []; // mic audio from before the session was ready (kept to ~3 s)
  const playing = new Set();

  const send = obj => ws.readyState === 1 && ws.send(JSON.stringify(obj));
  const stopPlayback = () => { for (const s of playing) { try { s.stop(); } catch {} } playing.clear(); nextAt = 0; };
  const audioMsg = buf => ({ realtimeInput: { audio: { data: b64(buf), mimeType: 'audio/pcm;rate=16000' } } });
  const active = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (!closed && !playing.size) { stop(); onIdle?.(); } }, 90000); };

  const setup = () => send({
    setup: {
      model: `models/${model}`,
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: db.setting('ttsVoice', 'Charon') } } } },
      systemInstruction: { parts: [{ text: systemText() }] },
      tools: [{ functionDeclarations: functionDeclarations() }],
      ...(tuned ? { realtimeInputConfig: VAD } : {}),
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  });
  if (ws.readyState === 1) setup(); else ws.onopen = setup;

  down.port.onmessage = e => {
    if (ready) return send(audioMsg(e.data));
    early.push(e.data);
    if (early.length > 75) early.shift();
  };

  // Model audio: 24 kHz 16-bit PCM pieces, scheduled back to back.
  const play = data => {
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
    const buf = ctx.createBuffer(1, pcm.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const s = ctx.createBufferSource();
    s.buffer = buf; s.connect(ctx.destination);
    nextAt = Math.max(nextAt, ctx.currentTime + 0.03);
    s.start(nextAt);
    nextAt += buf.duration;
    playing.add(s);
    s.onended = () => playing.delete(s);
    onState?.('speaking');
    clearTimeout(speakingTimer);
    speakingTimer = setTimeout(() => !closed && onState?.('listening'), (nextAt - ctx.currentTime) * 1000 + 150);
  };

  ws.onmessage = async e => {
    const text = typeof e.data === 'string' ? e.data : await e.data.text();
    let m; try { m = JSON.parse(text); } catch { return; }
    if (m.setupComplete) {
      ready = true;
      db.setSetting('liveModel', model); // skip the model lookup next time
      for (const buf of early.splice(0)) send(audioMsg(buf));
      onState?.('listening'); active();
      return;
    }
    if (m.toolCall) {
      const functionResponses = [];
      for (const fc of m.toolCall.functionCalls || []) {
        const out = await runTool(fc.name, fc.args || {});
        if (WRITE_TOOLS.has(fc.name) && !out?.error) { const label = describeAction(fc.name, fc.args || {}); if (label) onAction?.(label); }
        functionResponses.push({ id: fc.id, name: fc.name, response: out?.error ? { error: out.error } : { result: out ?? { ok: true } } });
      }
      send({ toolResponse: { functionResponses } });
      return;
    }
    const sc = m.serverContent;
    if (!sc) { if (m.goAway) onError?.('The live session is about to end; tap the wave to start a new one.'); return; }
    if (sc.interrupted) { stopPlayback(); onState?.('listening'); }
    if (sc.inputTranscription?.text) { userText += sc.inputTranscription.text; active(); }
    if (sc.outputTranscription?.text) modelText += sc.outputTranscription.text;
    for (const p of sc.modelTurn?.parts || []) if (p.inlineData?.data) play(p.inlineData.data);
    if (sc.turnComplete || sc.interrupted) {
      if (userText.trim()) onUser?.(userText.trim());
      if (modelText.trim()) onModel?.(modelText.trim());
      userText = ''; modelText = '';
    }
  };

  const stop = () => {
    if (closed) return;
    closed = true;
    clearTimeout(speakingTimer); clearTimeout(idleTimer);
    stopPlayback();
    try { ws.close(); } catch {}
    mic.getTracks().forEach(t => t.stop());
    try { src.disconnect(); down.disconnect(); sink.disconnect(); } catch {}
    onState?.('ended');
  };
  ws.onerror = () => {};
  ws.onclose = ev => {
    if (closed) return;
    if (!ready) {
      closed = true;
      clearTimeout(idleTimer);
      mic.getTracks().forEach(t => t.stop());
      try { src.disconnect(); down.disconnect(); sink.disconnect(); } catch {}
      // Retry once without the turn-taking tweak, and with a fresh model lookup.
      if (tuned || db.setting('liveModel', '')) {
        db.setSetting('liveModel', ''); liveModels = null;
        return startLive(cb, { tuned: false }).then(r => { session.stop = r.stop; session.interrupt = r.interrupt; }, e => onError?.(e.message, true));
      }
      onState?.('ended');
      return onError?.(`Live voice could not start${ev.reason ? `: ${ev.reason}` : ''}.`, true);
    }
    if (ev.code !== 1000) onError?.(`Live voice ended${ev.reason ? `: ${ev.reason}` : ''}.`);
    stop();
  };
  const session = { stop, interrupt: () => { stopPlayback(); onState?.('listening'); } };
  return session;
}
