// Sounds: soft mechanical clicks, ratchets and chimes, synthesized with Web Audio (no files).
// Everything is quiet, low-passed and slightly varied, and repeated sounds get quieter the
// faster they come, so they stay pleasant after hearing them many times. On the iPhone the
// audio session is "ambient": music keeps playing and the silent switch mutes Yaver.
import * as db from './db.js';

let ctx = null, out = null, room = null, last = {}, recent = 0, recentAt = 0;
const enabled = () => db.setting('sounds', true) && !document.hidden;

function audio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch { /* older iOS */ }
  ctx = new AC();
  // master: gentle low-pass (nothing sharp), a soft limiter, and a little room
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200; lp.Q.value = 0.4;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -24; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.12;
  out = ctx.createGain(); out.gain.value = 2.4;
  room = ctx.createConvolver(); room.buffer = impulse(0.45);
  const wet = ctx.createGain(); wet.gain.value = 0.16;
  out.connect(lp); out.connect(room); room.connect(wet); wet.connect(lp);
  lp.connect(comp); comp.connect(ctx.destination);
  return ctx;
}

// A short, dark decaying noise tail: a small wooden room.
function impulse(sec) {
  const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) { lp = lp * 0.7 + (Math.random() * 2 - 1) * 0.3; d[i] = lp * Math.pow(1 - i / n, 3); }
  }
  return b;
}

let noiseBuf = null;
const noise = () => {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
};
const vary = (v, amt = 0.06) => v * (1 + (Math.random() * 2 - 1) * amt);

// Habituation: sounds that come in quick succession get softer.
function level(base) {
  const now = performance.now();
  recent = Math.max(0, recent - (now - recentAt) / 900);
  recentAt = now;
  recent = Math.min(6, recent + 1);
  return base / (1 + (recent - 1) * 0.35);
}
function gate(name, gap) {
  const now = performance.now();
  if (now - (last[name] || 0) < gap) return false;
  last[name] = now;
  return true;
}

// ---------- voices ----------
// A muted brass click: a filtered noise tick with a tiny pitched body.
function click(t, { freq = 2100, gain = 0.05, body = 1150, len = 0.03 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noise();
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = vary(freq); bp.Q.value = 3;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(bp); bp.connect(g); g.connect(out);
  src.start(t, Math.random() * 0.2); src.stop(t + len + 0.02);
  if (body) tone(t, vary(body, 0.04), { gain: gain * 0.35, attack: 0.001, decay: 0.05, type: 'triangle' });
}
// A soft sine tone with a smooth envelope.
function tone(t, freq, { gain = 0.03, attack = 0.01, decay = 0.5, type = 'sine', glide } = {}) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + attack + decay * 0.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + attack + decay + 0.05);
}
// A breath of air: low-passed noise swelling and fading, for the chat opening.
function air(t, { gain = 0.03, len = 0.5, from = 400, to = 1600 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noise(); src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.7;
  f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + len * 0.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + len * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t); src.stop(t + len + 0.05);
}

// ---------- the sounds Yaver makes ----------
function play(name, gap, fn) {
  if (!enabled() || !gate(name, gap)) return;
  const a = audio();
  if (!a || a.state !== 'running' && a.state !== 'suspended') return;
  fn(a.currentTime + 0.01);
}

// A button press: one soft click.
export const tap = () => play('tap', 60, t => click(t, { gain: level(0.045) }));
// A gear catching: a short ratchet of clicks, quieter each time.
export const ratchet = (n = 3) => play('ratchet', 180, t => { const g = level(0.04); for (let i = 0; i < n; i++) click(t + i * vary(0.045, 0.1), { gain: g * (1 - i * 0.18), freq: 1800 - i * 120, body: 900 }); });
// Entering a screen: two clicks, like a latch.
export const enter = () => play('enter', 250, t => { const g = level(0.04); click(t, { gain: g, freq: 1500, body: 700 }); click(t + 0.07, { gain: g * 0.7, freq: 2300, body: 0 }); });
// The engine spinning up: a ratchet and a low hum that swells.
export const spin = () => play('spin', 400, t => {
  const g = level(1);
  for (let i = 0; i < 5; i++) click(t + i * 0.05, { gain: 0.035 * g * (1 - i * 0.12), freq: 1700, body: 800 });
  tone(t, 110, { gain: 0.035 * g, attack: 0.12, decay: 0.7, glide: 165 });
  tone(t + 0.1, 880, { gain: 0.008 * g, attack: 0.15, decay: 0.8 });
});
// The chat opening: a catch, a breath of air and a soft rising tone with a crystal shimmer.
export const open = () => play('open', 300, t => {
  click(t, { gain: 0.04, freq: 1600, body: 800 });
  air(t + 0.02, { gain: 0.022, len: 0.45 });
  tone(t + 0.03, 196, { gain: 0.03, attack: 0.08, decay: 0.45, glide: 294 });
  tone(t + 0.12, 1175, { gain: 0.009, attack: 0.05, decay: 0.7 });
  tone(t + 0.2, 1568, { gain: 0.006, attack: 0.05, decay: 0.8 });
});
// The chat closing: the same, falling and shorter.
export const close = () => play('close', 300, t => {
  air(t, { gain: 0.016, len: 0.32, from: 1400, to: 380 });
  tone(t, 294, { gain: 0.025, attack: 0.03, decay: 0.32, glide: 175 });
  click(t + 0.26, { gain: 0.03, freq: 1300, body: 650 });
});
// Something saved: a latch and a small two-note chime.
export const save = () => play('save', 700, t => {
  const g = level(1);
  click(t, { gain: 0.035 * g, freq: 1400, body: 600 });
  tone(t + 0.05, 659, { gain: 0.016 * g, attack: 0.01, decay: 0.55 });
  tone(t + 0.13, 988, { gain: 0.012 * g, attack: 0.01, decay: 0.7 });
});
// A lesson finished: three rising notes, warm and short.
export const done = () => play('done', 1500, t => {
  [523, 659, 784].forEach((f, i) => tone(t + i * 0.11, f, { gain: 0.018, attack: 0.012, decay: 0.8 }));
  tone(t + 0.33, 1568, { gain: 0.005, attack: 0.02, decay: 1 });
});
// A simulator step: the faintest tick.
export const step = () => play('step', 90, t => click(t, { gain: level(0.025), freq: 2600, body: 0, len: 0.02 }));

// Browsers start audio only after a touch: wake the audio engine on the first one.
export function init() {
  const unlock = () => { if (db.setting('sounds', true)) audio(); };
  addEventListener('touchend', unlock, { passive: true });
  addEventListener('click', unlock, { passive: true });
}
