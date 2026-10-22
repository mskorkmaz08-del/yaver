// Natural voice: reads Yaver's replies with Gemini's text-to-speech (free tier,
// same key as the chat). Falls back to the iPhone's built-in voice when there
// is no Gemini key, the free limit is used up, or the request fails.
import * as db from '../db.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const VOICES = [['Kore', 'Kore · firm, clear'], ['Sulafat', 'Sulafat · warm'], ['Charon', 'Charon · calm, deep'], ['Puck', 'Puck · upbeat'], ['Aoede', 'Aoede · light'], ['Zephyr', 'Zephyr · bright']];
const key = () => db.setting('geminiKey', '').trim();
let ctx, playing, models, pausedUntil = 0;

export const naturalOn = () => db.setting('voiceStyle', 'natural') === 'natural' && !!key() && Date.now() > pausedUntil;

// iOS lets audio start only inside a tap; call this from one, then later replies can play.
export function unlockAudio() {
  ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  const b = ctx.createBuffer(1, 1, 24000), s = ctx.createBufferSource();
  s.buffer = b; s.connect(ctx.destination); s.start();
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
        contents: [{ role: 'user', parts: [{ text: `Read this aloud in a natural, friendly, conversational way:\n\n${text}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: db.setting('voiceName', 'Kore') } } } },
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
  const buf = ctx.createBuffer(1, pcm.length, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
  stopAudio();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  playing = src;
  return new Promise(resolve => {
    src.onended = () => { if (playing === src) playing = null; resolve(); };
    onStart?.();
    src.start();
  });
}
