// Keyboard shortcuts for using Yaver on a computer. Ignored while typing.
// Screen-specific keys (lesson, review cards) are handled by those screens.
import { html, raw } from './util.js';
import { openAssistant } from './ai/assistant.js';

const LIST = [
  ['Anywhere', [['1 … 7', 'Home, Çetele, Study, Meet, Money, Diet, Map'], [',', 'Settings'], ['g then t', 'Today (Study)'], ['g then c', 'Course'], ['/', 'Ask Yaver'], ['⌘K or Ctrl K', 'Command bar: do, find or ask'], ['?', 'This list']]],
  ['Lesson', [['s', 'Start, pause or resume the timer'], ['n', 'Finish this step, go to the next'], ['h', 'Next hint'], ['t', 'Tutor me'], ['Esc', 'Back']]],
  ['Review cards', [['Space', 'Show answer'], ['1', 'Again'], ['2', 'Hard'], ['3', 'Good'], ['4', 'Easy']]],
];

const typing = t => /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;

export function initShortcuts(go) {
  let pendingG = 0;
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    if (e.key === 'Escape') { const k = document.querySelector('.keys-wrap'); if (k) { k.remove(); e.stopImmediatePropagation(); } return; }
    if (document.querySelector('.sheet-wrap') || document.body.classList.contains('chat-open') && !document.body.classList.contains('lesson-docked')) return;
    if (e.key === '?') { e.preventDefault(); showKeys(); return; }
    if (e.key === '/') { e.preventDefault(); openAssistant(); return; }
    if (e.key === 'g') { pendingG = Date.now(); return; }
    // Number keys open the sections in sidebar order; screens with their own number keys (review cards) take them first.
    const tab = { 1: 'home', 2: 'cetele', 3: 'study', 4: 'calendar', 5: 'money', 6: 'diet', 7: 'map', ',': 'settings' }[e.key];
    if (tab && !(e.key >= '1' && e.key <= '4' && document.body.dataset.view === 'lesson')) { e.preventDefault(); go(tab); return; }
    if (Date.now() - pendingG < 1200) {
      if (e.key === 't') { e.preventDefault(); e.stopImmediatePropagation(); go('study'); }
      else if (e.key === 'c') { e.preventDefault(); e.stopImmediatePropagation(); go('course'); }
      pendingG = 0;
    }
  });
}

export function showKeys() {
  document.querySelector('.keys-wrap')?.remove();
  const w = document.createElement('div');
  w.className = 'keys-wrap sheet-wrap open';
  w.innerHTML = html`<div class="sheet keys" role="dialog" aria-label="Keyboard shortcuts"><h2>Keyboard shortcuts</h2>
    ${raw(LIST.map(([title, keys]) => html`<p class="label">${title}</p>${raw(keys.map(([k, d]) => html`<div class="key-row"><kbd>${k}</kbd><span>${d}</span></div>`).join(''))}`).join(''))}
    <button class="btn ghost" data-x>Close</button></div>`;
  document.body.append(w);
  w.onclick = e => { if (e.target === w || e.target.closest('[data-x]')) w.remove(); };
}
