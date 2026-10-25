// The command bar: one place to do anything in a couple of taps. Hold the Yaver gear on the
// phone, or press ⌘K / Ctrl+K on the laptop. It lists the quick actions first (log an
// expense, a meal, study, a meeting, a to-do; resume the next lesson; review cards), then a
// one-tap +1 for each open Çetele minimum, then every screen. Typing filters the list; anything
// that matches nothing goes to Yaver as a question. Arrow keys and Enter work on a keyboard.
import * as CT from './cetele.js';
import * as C from './course.js';
import { html, raw, toast, haptic, dragToClose } from './util.js';
import { icon } from './icons.js';
import { expenseForm, meetingForm, studyForm, mealForm, taskForm } from './forms.js';
import { openAssistant, startVoiceChat } from './ai/assistant.js';

let goTo = () => {};
export function initCommand(go) {
  goTo = go;
  addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); toggle(); }
    else if (e.key === 'Escape' && wrap) { e.stopPropagation(); close(); }
  }, true);
  addEventListener('hashchange', close);
}

function nextLesson() {
  if (!C.ready() || !C.active()) return null;
  const nb = C.nextBlock();
  const l = nb?.lesson ? C.lesson(nb.lesson.id) : null;
  if (!l) return null;
  const p = C.progress(l.id) || {};
  return { id: `lesson/${l.id}`, label: `${p.stepsDone?.length ? 'Resume' : 'Begin'} ${l.title}`, hint: `next lesson · ${l.minutes} min` };
}

function items() {
  const out = [];
  const nl = nextLesson();
  if (nl) out.push({ group: 'Do', icon: 'book', label: nl.label, hint: nl.hint, run: () => goTo(nl.id), keys: 'lesson study start' });
  out.push(
    { group: 'Do', icon: 'wallet', label: 'Log an expense', run: () => expenseForm(), keys: 'money spend spent pay buy' },
    { group: 'Do', icon: 'leaf', label: 'Log a meal', run: () => mealForm(), keys: 'food eat diet calories' },
    { group: 'Do', icon: 'clock', label: 'Log study time', run: () => studyForm(), keys: 'session hours minutes' },
    { group: 'Do', icon: 'calendar', label: 'New meeting', run: () => meetingForm(), keys: 'event calendar meet' },
    { group: 'Do', icon: 'check', label: 'Add a to-do', run: () => taskForm(), keys: 'task todo' },
  );
  if (C.ready() && C.active()) {
    const due = C.dueCount();
    out.push({ group: 'Do', icon: 'refresh', label: 'Review cards', hint: due ? `${due} due` : 'none due', run: () => goTo('lesson/review'), keys: 'flashcards spaced' });
  }
  out.push(
    { group: 'Do', icon: 'mic', label: 'Talk to Yaver', hint: 'voice chat', run: () => startVoiceChat(), keys: 'voice speak' },
    { group: 'Do', icon: 'sparkle', label: 'Brief me', hint: 'what needs attention today', run: () => openAssistant('Brief me: what needs my attention today (çetele minimums, meetings, study and roadmap, tasks, money, diet). Facts and next steps only.'), keys: 'summary today' },
  );
  for (const r of CT.day().rows.filter(r => !r.met)) {
    const check = CT.isCheck(r);
    const step = Number(r.step) || 1;
    out.push({
      group: 'Çetele', icon: 'tally', label: check ? `${r.name} done` : `${r.name} +${step}`, hint: check ? 'open' : `${r.progress}/${r.target}${r.per === 'week' ? ' this week' : ''}`, keys: 'cetele log',
      run: () => logCetele(r.id, check ? 1 : step, check),
    });
  }
  const screens = [['home', 'home', 'Home'], ['cetele', 'tally', 'Çetele'], ['study', 'book', 'Study'], ['course', 'book', 'Course'], ['calendar', 'calendar', 'Meet'], ['money', 'wallet', 'Money'], ['diet', 'leaf', 'Diet'], ['map', 'map', 'Map'], ['settings', 'settings', 'Settings']];
  for (const [to, ic, name] of screens) out.push({ group: 'Go to', icon: ic, label: name, run: () => goTo(to), keys: to });
  return out;
}

// Log a Çetele minimum from anywhere, with a way back.
export async function logCetele(id, n, check = false) {
  const before = CT.valueOn(id);
  if (check) await CT.setValue(id, 1); else await CT.add(id, n);
  const it = CT.items().find(i => i.id === id);
  const metNow = it && CT.met(it);
  haptic(metNow ? 'success' : 'tap');
  toast(metNow ? `${it.name}: minimum met` : `${it?.name || 'Çetele'} ${check ? 'done' : `+${n}`}`, { action: { label: 'Undo', run: () => CT.setValue(id, before) } });
}

let wrap = null;
function toggle() { wrap ? close() : openCommand(); }
function close() {
  if (!wrap) return;
  const w = wrap;
  wrap = null;
  w.classList.remove('open');
  setTimeout(() => w.remove(), 220);
}

export function openCommand() {
  if (wrap) return;
  const all = items();
  wrap = document.createElement('div');
  wrap.className = 'sheet-wrap cmd-wrap';
  wrap.innerHTML = html`<div class="sheet cmd" role="dialog" aria-label="Command bar">
    <div class="grabber"></div>
    <div class="cmd-list" role="listbox"></div>
    <label class="cmd-search">${raw(icon('search'))}<input type="text" placeholder="Do, find or ask…" aria-label="Do, find or ask" autocomplete="off" enterkeyhint="go"><kbd class="desk-only">esc</kbd></label>
  </div>`;
  document.body.append(wrap);
  const input = wrap.querySelector('input'), list = wrap.querySelector('.cmd-list');
  let shown = [], sel = 0;
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    shown = q ? all.filter(it => `${it.label} ${it.hint || ''} ${it.keys || ''} ${it.group}`.toLowerCase().includes(q)) : all;
    if (q) shown = [...shown, { group: 'Ask', icon: 'sparkle', label: `Ask Yaver: “${input.value.trim()}”`, run: () => openAssistant(input.value.trim()) }];
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    let g = '';
    list.innerHTML = shown.map((it, i) => {
      const head = it.group !== g ? `<p class="cmd-g">${(g = it.group)}</p>` : '';
      return head + html`<button class="cmd-item ${raw(i === sel ? 'sel' : '')}" role="option" data-i="${i}">${raw(icon(it.icon))}<span>${it.label}</span>${raw(it.hint ? html`<small>${it.hint}</small>` : '')}</button>`;
    }).join('');
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  const run = i => { const it = shown[i]; if (!it) return; close(); it.run(); };
  list.onclick = e => { const b = e.target.closest('[data-i]'); if (b) run(Number(b.dataset.i)); };
  input.oninput = () => { sel = 0; draw(); };
  wrap.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
  });
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  dragToClose(wrap, close);
  draw();
  requestAnimationFrame(() => wrap?.classList.add('open'));
  // on a keyboard, type straight away; on the phone the list comes first and the keyboard stays down
  if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => input.focus(), 30);
}
