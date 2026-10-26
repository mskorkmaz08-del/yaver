// Focus mode: the screen empties so you can study. In a lesson only the lesson's paper stays;
// from the Study tab the screen is simply dark. A small stopwatch chip shows the time; tap it
// and it fades to a faint dot (tap the dot to bring it back). The screen stays awake, the
// laptop goes full screen, and a soft bell rings when the planned time is up.
import * as sound from './sound.js';

let state = null;

const fmt = sec => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

// opts: { mode: 'lesson' | 'blank', title, start: () => ms | null, planned (minutes), onExit }
export function enterFocus(opts) {
  if (state) exitFocus(false);
  const el = document.createElement('div');
  el.className = `focus-hud ${opts.mode === 'blank' ? 'blank' : ''}`;
  el.innerHTML = `
    ${opts.mode === 'blank' ? `<div class="focus-calm" aria-hidden="true"><p class="focus-title"></p></div>` : ''}
    <button class="focus-exit" aria-label="Leave focus mode">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
    <button class="focus-chip" aria-label="Hide or show the timer">
      <svg viewBox="-12 -13 24 25" aria-hidden="true"><rect x="-2" y="-13" width="4" height="3" rx=".8"/><circle r="9.5"/><path d="M0 0V-6.5" class="hand"/></svg>
      <b>00:00</b>
    </button>`;
  if (opts.title) el.querySelector('.focus-title') && (el.querySelector('.focus-title').textContent = opts.title);
  document.body.append(el);
  document.body.classList.add('focus-mode', opts.mode === 'blank' ? 'focus-blank' : 'focus-lesson');
  const chip = el.querySelector('.focus-chip');
  chip.onclick = () => { chip.classList.toggle('faint'); try { localStorage.setItem('yaverFocusChip', chip.classList.contains('faint') ? 'faint' : ''); } catch { /* private mode */ } };
  try { if (localStorage.getItem('yaverFocusChip') === 'faint') chip.classList.add('faint'); } catch { /* private mode */ }
  el.querySelector('.focus-exit').onclick = () => exitFocus();
  const key = e => { if (e.key === 'Escape') { e.stopPropagation(); exitFocus(); } };
  addEventListener('keydown', key, true);

  let rang = false;
  const tick = () => {
    const s = opts.start();
    const sec = s ? Math.max(0, Math.floor((Date.now() - s) / 1000)) : 0;
    chip.querySelector('b').textContent = fmt(sec);
    chip.querySelector('.hand').setAttribute('transform', `rotate(${(sec % 60) * 6})`);
    const over = opts.planned && sec >= opts.planned * 60;
    chip.classList.toggle('done', !!over);
    if (over && !rang) { rang = true; navigator.vibrate?.([30, 60, 30]); }
  };
  tick();
  const timer = setInterval(tick, 1000);

  // keep the screen on, and go full screen where the browser allows it
  let lock = null;
  navigator.wakeLock?.request('screen').then(l => { lock = l; }).catch(() => {});
  const relock = () => { if (!document.hidden && state) navigator.wakeLock?.request('screen').then(l => { lock = l; }).catch(() => {}); };
  document.addEventListener('visibilitychange', relock);
  if (matchMedia('(min-width: 1100px)').matches) document.documentElement.requestFullscreen?.().catch(() => {});
  sound.duck(true);
  requestAnimationFrame(() => el.classList.add('in'));
  state = { el, timer, key, relock, release: () => lock?.release?.().catch(() => {}), onExit: opts.onExit };
}

export function exitFocus(run = true) {
  if (!state) return;
  const { el, timer, key, relock, release, onExit } = state;
  state = null;
  clearInterval(timer);
  removeEventListener('keydown', key, true);
  document.removeEventListener('visibilitychange', relock);
  release();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  document.body.classList.remove('focus-mode', 'focus-blank', 'focus-lesson');
  el.classList.remove('in');
  setTimeout(() => el.remove(), 350);
  sound.duck(false);
  if (run) onExit?.();
}

export const inFocus = () => !!state;
