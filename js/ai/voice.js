// Natural voice: reads Yaver's replies with Gemini's text-to-speech (free tier,
// same key as the chat). Falls back to the iPhone's built-in voice when there
// is no Gemini key, the free limit is used up, or the request fails.
import * as db from '../db.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const VOICES = [['Charon', 'Charon · male, calm'], ['Orus', 'Orus · male, firm'], ['Iapetus', 'Iapetus · male, clear'], ['Puck', 'Puck · male, upbeat'], ['Fenrir', 'Fenrir · male, lively'], ['Kore', 'Kore · female, firm'], ['Sulafat', 'Sulafat · female, warm'], ['Aoede', 'Aoede · female, light']];
const key = () => db.setting('geminiKey', '').trim();
let ctx, playing, models, pausedUntil = 0;

export const jarvisOn = () => db.setting('jarvis', true);
export const naturalOn = () => db.setting('voiceStyle', 'natural') === 'natural' && !!key() && Date.now() > pausedUntil;

// iOS lets audio start only inside a tap; call this from one, then later replies can play.
export function unlockAudio() {
  ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  const b = ctx.createBuffer(1, 1, 24000), s = ctx.createBufferSource();
  s.buffer = b; s.connect(ctx.destination); s.start();
}

// Before the microphone turns on: a running audio output plus the mic switching
// on is what makes iOS click. Suspend it; unlockAudio resumes it for the next reply.
export function suspendAudio() {
  if (ctx && ctx.state === 'running' && !playing) ctx.suspend().catch(() => {});
}

export function stopAudio() {
  try { playing?.stop(); } catch {}
  playing = null;
}
export const audioPlaying = () => !!playing;

// TTS models this key can use, newest stable first; previews after.
async function ttsModels() {
  if (models) return models;
  const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key() } });
  const names = res.ok ? ((await res.json()).models || []).map(m => m.name.replace('models/', '')).filter(n => /tts/.test(n)) : [];
  const ver = n => parseFloat((n.match(/gemini-([\d.]+)/) || [0, 0])[1]);
  const rank = n => (/preview|exp/.test(n) ? 2 : 0) + (/pro/.test(n) ? 1 : 0);
  names.sort((a, b) => rank(a) - rank(b) || ver(b) - ver(a) || a.length - b.length);
  return (models = names.length ? names : ['gemini-2.5-flash-preview-tts']);
}

// Returns when playback ends. Throws if Gemini can't voice it (caller falls back).
export async function speakNatural(text, { onStart, cancelled = () => false } = {}) {
  const list = await ttsModels();
  let lastErr;
  for (const model of list.slice(0, 3)) {
    const res = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Gemini's documented style form is "Say <how>: <words>"; anything else gets read out.
        contents: [{ role: 'user', parts: [{ text: jarvisOn() ? `Say in a calm, precise British accent, like a refined AI assistant: ${text}` : text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: db.setting('ttsVoice', 'Charon') } } } },
      }),
      signal: AbortSignal.timeout(30000),
    }).catch(e => ({ ok: false, status: 0, e }));
    if (!res.ok) {
      lastErr = new Error(`Gemini voice ${res.status}`);
      // Used up or not allowed for this key: try the next model; all fail → back off for 10 minutes.
      if ([400, 403, 404, 429].includes(res.status)) { models = models.filter(m => m !== model).concat(res.status === 429 ? [model] : []); continue; }
      throw lastErr;
    }
    const data = await res.json();
    const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (!part) { lastErr = new Error('Gemini sent no audio'); continue; }
    const rate = Number((part.inlineData.mimeType.match(/rate=(\d+)/) || [0, 24000])[1]);
    if (cancelled()) return;
    // If iOS won't resume the audio output after the mic was on, let the caller use the phone voice.
    if (ctx?.state === 'suspended') { await ctx.resume().catch(() => {}); if (ctx.state !== 'running') throw new Error('audio output suspended'); }
    return play(part.inlineData.data, rate, onStart);
  }
  pausedUntil = Date.now() + 10 * 60000;
  throw lastErr || new Error('Gemini voice unavailable');
}

// Gemini sends raw 16-bit little-endian mono PCM.
function play(b64, rate, onStart) {
  unlockAudio();
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  // Cut the clip after the last spoken sound (+150 ms): Gemini sometimes ends with
  // a burst of noise. Then fade the edges so playback starts and stops without a click.
  let end = pcm.length;
  for (let i = pcm.length - 1; i >= 0; i--) if (Math.abs(pcm[i]) > 1500) { end = Math.min(pcm.length, i + Math.round(rate * 0.08)); break; }
  const buf = ctx.createBuffer(1, Math.max(end, 1), rate);
  const ch = buf.getChannelData(0);
  const fadeIn = Math.round(rate * 0.01), fadeOut = Math.round(rate * 0.12);
  for (let i = 0; i < end; i++) ch[i] = (pcm[i] / 32768) * Math.min(1, i / fadeIn, (end - i) / fadeOut);
  stopAudio();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(jarvisOn() ? jarvisChain() : ctx.destination);
  playing = src;
  return new Promise(resolve => {
    src.onended = () => { if (playing === src) playing = null; resolve(); };
    onStart?.();
    src.start();
  });
}

// A light "AI assistant" colour: trim the low rumble, add presence, and blend in a
// very short metallic echo. Subtle on purpose: it should still sound like a person.
let chain;
function jarvisChain() {
  if (chain) return chain;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140;
  const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3200; pres.gain.value = 3; pres.Q.value = 0.9;
  const dry = ctx.createGain(); dry.gain.value = 0.9;
  const echo = ctx.createDelay(0.05); echo.delayTime.value = 0.012;
  const fb = ctx.createGain(); fb.gain.value = 0.25;
  const wet = ctx.createGain(); wet.gain.value = 0.22;
  hp.connect(pres); pres.connect(dry); dry.connect(ctx.destination);
  pres.connect(echo); echo.connect(fb); fb.connect(echo); echo.connect(wet); wet.connect(ctx.destination);
  return (chain = hp);
}
