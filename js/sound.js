// Sounds and music. Interface sounds are small mechanisms made for Yaver by modal synthesis
// (a detent snapping into its notch, a pawl on a ratchet, a latch, a stamp, a small clock bell;
// see sounds/CREDITS.md), played at a slightly different pitch each time and softer when they
// come quickly, so they don't wear on you. The background music is a slow D-minor piece for
// violin, cello, double bass and harp (sounds/strings.mp3), rendered from recorded samples; it
// loops seamlessly. On the iPhone the audio session is "ambient": music from other apps keeps
// playing and the silent switch mutes Yaver.
import * as db from './db.js';

const LEVEL = { tap: 0.34, on: 0.38, off: 0.36, enter: 0.3, spin: 0.42, open: 0.42, close: 0.4, save: 0.4, done: 0.45, step: 0.28, swipe: 0.34, stop: 0.38, bell: 0.4 };

let ctx = null, sfx = null, musicBus = null, buffers = {}, loading = {}, last = {}, recent = 0, recentAt = 0;
const fxOn = () => db.setting('sounds', true);
const musicOn = () => db.setting('music', true);

function audio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch { /* older iOS */ }
  ctx = new AC();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 10000; lp.Q.value = 0.5;
  sfx = ctx.createGain(); sfx.gain.value = 1;
  sfx.connect(lp); lp.connect(ctx.destination);
  musicBus = ctx.createGain(); musicBus.gain.value = 0;
  musicBus.connect(ctx.destination);
  return ctx;
}

async function load(name) {
  if (buffers[name]) return buffers[name];
  if (!loading[name]) loading[name] = fetch(`sounds/${name}`).then(r => r.arrayBuffer()).then(b => new Promise((ok, bad) => ctx.decodeAudioData(b, ok, bad))).then(buf => (buffers[name] = buf)).catch(() => { delete loading[name]; return null; });
  return loading[name];
}

// Quick repeats get softer, so a run of taps never gets loud.
function level(base) {
  const now = performance.now();
  recent = Math.max(0, recent - (now - recentAt) / 700);
  recentAt = now;
  recent = Math.min(5, recent + 1);
  return base / (1 + (recent - 1) * 0.3);
}

async function play(kind, { gap = 70, rate = 1, when = 0, gain = 1 } = {}) {
  if (!fxOn() || document.hidden) return;
  const now = performance.now();
  if (now - (last[kind] || 0) < gap) return;
  last[kind] = now;
  const a = audio();
  if (!a) return;
  const buf = await load(`${kind}.mp3`);
  if (!buf) return;
  const src = a.createBufferSource(); src.buffer = buf;
  src.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
  const g = a.createGain(); g.gain.value = level(LEVEL[kind]) * gain;
  src.connect(g); g.connect(sfx);
  src.start(a.currentTime + when);
}

// ---------- the sounds ----------
export const tap = () => play('tap');
export const toggle = on => play(on ? 'on' : 'off');
export const enter = () => play('enter', { gap: 250 });
// Winding a crown: a pawl clicking over the ratchet, then the spring takes it.
export const spin = () => play('spin', { gap: 500 });
export const open = () => { play('open', { gap: 300 }); duck(true); };
export const close = () => { play('close', { gap: 300 }); duck(false); };
export const save = () => play('save', { gap: 700 });
export const done = () => play('done', { gap: 1500 });
export const step = () => play('step', { gap: 90 });
export const swipe = () => play('swipe', { gap: 300 });
export const stop = () => play('stop', { gap: 300 });
export const bell = () => play('bell', { gap: 1500 });

// ---------- music ----------
// The piece is rendered to loop seamlessly, so copies only overlap by a short crossfade.
const MUSIC = 'strings.mp3', FADE = 0.3, VOL = 0.24;
let playing = false, nextAt = 0, timer = 0, ducked = false, sources = [];

function schedule() {
  const buf = buffers[MUSIC];
  if (!playing || !buf) return;
  const a = ctx;
  // keep two copies queued, each overlapping the next by FADE seconds
  while (nextAt < a.currentTime + 8) {
    const t = Math.max(nextAt, a.currentTime + 0.05);
    const src = a.createBufferSource(); src.buffer = buf;
    const g = a.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + FADE);
    g.gain.setValueAtTime(1, t + buf.duration - FADE); g.gain.linearRampToValueAtTime(0, t + buf.duration);
    src.connect(g); g.connect(musicBus);
    src.start(t); src.stop(t + buf.duration + 0.1);
    src.onended = () => { sources = sources.filter(s => s !== src); };
    sources.push(src);
    nextAt = t + buf.duration - FADE;
  }
  clearTimeout(timer);
  timer = setTimeout(schedule, 4000);
}
function target() { return !playing ? 0 : ducked ? VOL * 0.35 : VOL; }
function ramp(sec = 2) { if (!ctx) return; const g = musicBus.gain; g.cancelScheduledValues(ctx.currentTime); g.setValueAtTime(g.value, ctx.currentTime); g.linearRampToValueAtTime(target(), ctx.currentTime + sec); }

export async function startMusic() {
  if (!musicOn() || playing || document.hidden) return;
  const a = audio();
  if (!a) return;
  playing = true;
  if (!(await load(MUSIC))) { playing = false; return; }
  if (!playing) return;
  nextAt = a.currentTime + 0.05;
  schedule(); ramp(3);
}
export function stopMusic(sec = 1.5) {
  if (!playing) return;
  playing = false; ramp(sec); clearTimeout(timer);
  const end = ctx.currentTime + sec + 0.1;
  sources.forEach(s => { try { s.stop(end); } catch { /* already stopped */ } });
  sources = [];
}
// The chat (and voice) lowers the music; closing it brings it back.
export function duck(on) { ducked = on; ramp(0.8); }
export const musicPlaying = () => playing;

// Browsers start audio only after a touch: wake the audio and the music on the first one.
export function init() {
  const unlock = () => { if (fxOn() || musicOn()) audio(); if (musicOn()) startMusic(); };
  addEventListener('touchend', unlock, { passive: true });
  addEventListener('click', unlock, { passive: true });
  addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopMusic(0.3); else if (ctx && musicOn()) startMusic(); });
  db.onChange((store, id) => {
    if (store !== 'kv') return;
    if (id === 'music') { if (musicOn()) startMusic(); else stopMusic(); }
  });
}
