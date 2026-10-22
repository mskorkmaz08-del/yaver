// Natural voice: reads Yaver's replies with Gemini's text-to-speech (free tier,
// same key as the chat). Falls back to the iPhone's built-in voice when there
// is no Gemini key, the free limit is used up, or the request fails.
// Replies are voiced a sentence or two at a time, so speech starts while the
// rest is still being written and voiced.
import * as db from '../db.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const VOICES = [['Charon', 'Charon · male, calm'], ['Orus', 'Orus · male, firm'], ['Iapetus', 'Iapetus · male, clear'], ['Puck', 'Puck · male, upbeat'], ['Fenrir', 'Fenrir · male, lively'], ['Kore', 'Kore · female, firm'], ['Sulafat', 'Sulafat · female, warm'], ['Aoede', 'Aoede · female, light']];
const key = () => db.setting('geminiKey', '').trim();
let ctx, playing, models, pausedUntil = 0;

export const jarvisOn = () => db.setting('jarvis', true);
export const naturalOn = () => db.setting('voiceStyle', 'device') === 'natural' && !!key() && Date.now() > pausedUntil;

// ---------- iPhone voices (default: instant, offline, no artefacts) ----------
// Jarvis-like first: British male voices, Premium/Enhanced downloads before the basic ones.
const BRITISH_MALE = ['arthur', 'daniel', 'oliver', 'malcolm', 'jamie', 'george', 'ryan', 'thomas'];
const quality = v => (/premium/i.test(v.name) ? 0 : /enhanced|neural|natural/i.test(v.name) ? 1 : 2);
export const deviceVoices = () => ('speechSynthesis' in window ? speechSynthesis.getVoices() : [])
  .filter(v => /^(en|tr)/i.test(v.lang))
  .sort((a, b) => a.lang.localeCompare(b.lang) || quality(a) - quality(b) || a.name.localeCompare(b.name));

export function pickDeviceVoice(lang = 'en-GB') {
  const all = 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
  const two = lang.slice(0, 2).toLowerCase();
  if (two === 'en') {
    const chosen = all.find(v => v.voiceURI === db.setting('deviceVoice', ''));
    if (chosen) return chosen;
    const male = (v) => BRITISH_MALE.findIndex(n => v.name.toLowerCase().includes(n));
    const gb = all.filter(v => /^en[-_]gb/i.test(v.lang) && male(v) >= 0).sort((a, b) => quality(a) - quality(b) || male(a) - male(b));
    if (gb[0]) return gb[0];
  }
  const same = all.filter(v => v.lang.replace('_', '-').toLowerCase().startsWith(two)).sort((a, b) => quality(a) - quality(b));
  return same.find(v => /^en[-_]gb/i.test(v.lang)) || same[0] || null;
}

// iOS lets audio start only inside a tap; call this from one, then later replies can play.
// One shared audio output for the whole app: once a tap has unlocked it, later
// replies and live sessions can play without another tap.
export const audioCtx = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());

export function unlockAudio() {
  audioCtx();
  if (ctx.state === 'suspended') ctx.resume();
  const b = ctx.createBuffer(1, 1, 24000), s = ctx.createBufferSource();
  s.buffer = b; s.connect(ctx.destination); s.start();
}

// Before the microphone turns on: a running audio output plus the mic switching
// on can make iOS click. Suspend it; it resumes for the next reply.
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
  const rank = n => (/preview|exp/.test(n) ? 2 : 0) + (/pro/.test(n) ? 1 : 0) + (/lite/.test(n) ? -0.5 : 0);
  names.sort((a, b) => rank(a) - rank(b) || ver(b) - ver(a) || a.length - b.length);
  return (models = names.length ? names : ['gemini-2.5-flash-preview-tts']);
}

// Text → trimmed AudioBuffer. Throws if Gemini can't voice it.
export async function synth(text) {
  const list = await ttsModels();
  let lastErr;
  for (const model of list.slice(0, 3)) {
    const res = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Only the words: Gemini reads any style instruction out loud.
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: db.setting('ttsVoice', 'Charon') } } } },
      }),
      signal: AbortSignal.timeout(30000),
    }).catch(() => ({ ok: false, status: 0 }));
    if (!res.ok) {
      lastErr = new Error(`Gemini voice ${res.status}`);
      // Used up or not allowed for this key: try the next model.
      if ([400, 403, 404, 429].includes(res.status)) { models = models.filter(m => m !== model).concat(res.status === 429 ? [model] : []); continue; }
      throw lastErr;
    }
    const data = await res.json();
    const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (!part) { lastErr = new Error('Gemini sent no audio'); continue; }
    const rate = Number((part.inlineData.mimeType.match(/rate=(\d+)/) || [0, 24000])[1]);
    return toBuffer(part.inlineData.data, rate);
  }
  pausedUntil = Date.now() + 10 * 60000; // all failed: phone voice for 10 minutes
  throw lastErr || new Error('Gemini voice unavailable');
}

// Gemini sends raw 16-bit little-endian mono PCM.
function toBuffer(b64, rate) {
  unlockAudio();
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const [start, end] = speechBounds(pcm, rate);
  const len = Math.max(end - start, 1);
  const buf = ctx.createBuffer(1, len, rate);
  const ch = buf.getChannelData(0);
  const fadeIn = Math.round(rate * 0.01), fadeOut = Math.round(rate * 0.08);
  for (let i = 0; i < len; i++) ch[i] = (pcm[start + i] / 32768) * Math.min(1, i / fadeIn, (len - i) / fadeOut);
  return buf;
}

// Where the speech is. Drops leading silence (starts sooner) and the burst of
// static Gemini sometimes adds after the last word: a short noisy segment
// (broadband, so it crosses zero far more often than a voice) after a pause.
export function speechBounds(pcm, rate) {
  const win = Math.round(rate * 0.02), n = Math.floor(pcm.length / win);
  const loud = [], zcr = [];
  for (let w = 0; w < n; w++) {
    let e = 0, z = 0;
    for (let i = w * win; i < (w + 1) * win; i++) { e += pcm[i] * pcm[i]; if (i && (pcm[i] >= 0) !== (pcm[i - 1] >= 0)) z++; }
    loud.push(Math.sqrt(e / win) > 500);
    zcr.push(z / win);
  }
  let first = loud.indexOf(true), end = loud.lastIndexOf(true) + 1;
  if (first < 0) return [0, pcm.length];
  for (let k = 0; k < 3; k++) {
    let s = end - 1;
    while (s > first && loud[s - 1]) s--;
    let gap = 0, p = s - 1;
    while (p >= first && !loud[p]) { gap++; p--; }
    const segZcr = zcr.slice(s, end).reduce((a, b) => a + b, 0) / Math.max(1, end - s);
    if (p >= first && gap >= 6 && end - s <= 60 && segZcr > 0.28) end = p + 1;
    else break;
  }
  return [Math.max(0, first * win - Math.round(rate * 0.03)), Math.min(pcm.length, end * win + Math.round(rate * 0.06))];
}

function playBuffer(buf) {
  stopAudio();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(jarvisOn() ? jarvisChain() : ctx.destination);
  playing = src;
  return new Promise(resolve => {
    src.onended = () => { if (playing === src) playing = null; resolve(); };
    src.start();
  });
}

// "Hear this voice" in Settings.
export async function speakNatural(text) {
  const buf = await synth(text);
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  return playBuffer(buf);
}

// Split text into speakable pieces: the first sentence alone (so speech starts
// fast, unless it's tiny), then up to ~260 characters per piece.
export function chunks(text, firstAlone = true) {
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+|$)\s*/g) || [text];
  const out = [];
  for (const s of sentences.map(x => x.trim()).filter(Boolean)) {
    if ((out.length > 1 || (out.length && !firstAlone)) && (out.at(-1) + ' ' + s).length <= 260) out[out.length - 1] += ' ' + s;
    else if (out.length === 1 && out[0].length < 12) out[0] += ' ' + s;
    else out.push(s);
  }
  return out;
}

// A queue that voices pieces as they arrive and plays them in order. Each piece
// is requested from Gemini the moment it's pushed, so the next one is usually
// ready when the current one ends. `device(text)` plays a piece with the phone voice.
export function speaker({ onStart, onDone, device }) {
  const queue = [];
  let closed = false, stopped = false, started = false, running = false;
  const pump = async () => {
    if (running) return;
    running = true;
    while (queue.length && !stopped) {
      const item = await queue.shift();
      if (stopped) break;
      if (!started) { started = true; onStart?.(); }
      if (item.buf) {
        if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
        if (ctx.state === 'running') { await playBuffer(item.buf); continue; }
      }
      await device(item.text);
    }
    running = false;
    if (closed && !queue.length && !stopped) onDone?.();
  };
  return {
    push(text) {
      if (stopped || !text.trim()) return;
      queue.push(naturalOn() ? synth(text).then(buf => ({ buf, text }), () => ({ text })) : Promise.resolve({ text }));
      pump();
    },
    finish() { closed = true; if (!running && !queue.length && !stopped) onDone?.(); },
    stop() { stopped = true; queue.length = 0; stopAudio(); },
  };
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
