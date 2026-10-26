// Background music. Interface sounds were removed in v40 (Mustafa found every set too much);
// Yaver is quiet except for the music. "Academy" is a hopeful A-minor piece for a clockwork
// academy: piano ostinato, escapement ticks, cello and bass, horn swells, a violin melody,
// flute and harp, and a hextech shimmer (sounds/academy.mp3, rendered from recorded samples);
// it loops seamlessly. On the iPhone the audio session is "ambient": music from other apps
// keeps playing and the silent switch mutes Yaver.
import * as db from './db.js';

let ctx = null, musicBus = null, buffers = {}, loading = {};
const musicOn = () => db.setting('music', true);

function audio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch { /* older iOS */ }
  ctx = new AC();
  musicBus = ctx.createGain(); musicBus.gain.value = 0;
  musicBus.connect(ctx.destination);
  return ctx;
}

async function load(name) {
  if (buffers[name]) return buffers[name];
  if (!loading[name]) loading[name] = fetch(`sounds/${name}`).then(r => r.arrayBuffer()).then(b => new Promise((ok, bad) => ctx.decodeAudioData(b, ok, bad))).then(buf => (buffers[name] = buf)).catch(() => { delete loading[name]; return null; });
  return loading[name];
}

// ---------- music ----------
// The piece is rendered to loop seamlessly, so copies only overlap by a short crossfade.
const MUSIC = 'academy.mp3', FADE = 0.3, VOL = 0.24;
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
  const unlock = () => { if (musicOn()) startMusic(); };
  addEventListener('touchend', unlock, { passive: true });
  addEventListener('click', unlock, { passive: true });
  addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopMusic(0.3); else if (ctx && musicOn()) startMusic(); });
  db.onChange((store, id) => {
    if (store !== 'kv') return;
    if (id === 'music') { if (musicOn()) startMusic(); else stopMusic(); }
  });
}
