// Yaver entry point: opens the database, draws the current screen, and
// re-draws it whenever data changes (from a form or from Claude).
import * as db from './db.js';
import { $, sheet, toast, haptic } from './util.js';
import { initAssistant, openAssistant, routeChanged } from './ai/assistant.js';
import { exitFocus } from './focus.js';
import { saveKey, sortKeys } from './ai/provider.js';
import { useCode, pairLocal } from './ai/mac.js';
import { unlockAudio } from './ai/voice.js';
import * as home from './views/home.js';
import * as money from './views/money.js';
import * as calendar from './views/calendar.js';
import * as study from './views/study.js';
import * as diet from './views/diet.js';
import * as cetele from './views/cetele.js';
import * as CT from './cetele.js';
import * as settings from './views/settings.js';
import * as mapView from './views/map.js';
import * as courseView from './views/course.js';
import * as lessonView from './views/lesson.js';
import * as skillsView from './views/skills.js';
import * as C from './course.js';
import { initShortcuts } from './keys.js';
import { initCommand, openCommand } from './command.js';
import { initSync } from './sync.js';
import { currencyOptions } from './data.js';
import * as D from './data.js';
import { subdial } from './ui.js';
import * as sound from './sound.js';
import * as mech from './mech.js';
import { icon } from './icons.js';

const TABS = { home: ['home', 'Home', '1'], cetele: ['tally', 'Çetele', '2'], study: ['book', 'Study', '3'], calendar: ['calendar', 'Meet', '4'], money: ['wallet', 'Money', '5'], diet: ['leaf', 'Diet', '6'], map: ['map', 'Map', '7'], skills: ['trophy', 'Skills', '8'], settings: ['settings', 'Settings', ','] };

const VIEWS = { home, cetele, money, calendar, study, diet, map: mapView, settings, course: courseView, lesson: lessonView, skills: skillsView };
// Screens that belong to a tab for highlighting.
const PARENT = { course: 'study', lesson: 'study' };
let current = 'home';
let param = '';

export function go(name, arg = '') {
  if (name.includes('/')) [name, arg] = [name.slice(0, name.indexOf('/')), decodeURIComponent(name.slice(name.indexOf('/') + 1))];
  if (!VIEWS[name]) name = 'home';
  if (current !== name || param !== arg) { VIEWS[current].cleanup?.(); exitFocus(); routeChanged(); document.body.classList.remove('sim-open'); document.querySelectorAll('body > .sim-card.full').forEach(c => c.remove()); }
  current = name;
  param = arg;
  const hash = arg ? `${name}/${encodeURIComponent(arg)}` : name;
  if (location.hash.slice(1) !== hash) history.replaceState(null, '', `#${hash}`);
  document.body.dataset.view = name;
  document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === (PARENT[name] || name)));
  // screens slide in from the side of the tab they come from; deeper screens rise
  const order = Object.keys(TABS), a = order.indexOf(PARENT[current] || current), b = order.indexOf(PARENT[name] || name);
  document.body.dataset.dir = PARENT[name] && !PARENT[current] ? 'in' : b > a ? 'next' : b < a ? 'prev' : 'in';
  moveTabMark();
  if (current !== PREV_VIEW.name || param !== PREV_VIEW.arg) sound.enter();
  PREV_VIEW.name = current; PREV_VIEW.arg = param;
  entering = true;
  draw();
  $('#view').scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

let entering = false, enterTimer;
const MOUNTS = ['[data-engine]', '[data-train]', '[data-gem]'];
const PREV_VIEW = { name: null, arg: null };
function draw() {
  const root = $('#view');
  const y = window.scrollY;
  // Keep running mechanisms across redraws so their gears don't jump back to the start.
  const kept = MOUNTS.map(sel => [...root.querySelectorAll(sel)]);
  VIEWS[current].render(root, go, param);
  MOUNTS.forEach((sel, k) => root.querySelectorAll(sel).forEach((el, i) => kept[k][i] && kept[k][i].className === el.className && el.replaceWith(kept[k][i])));
  // A meshing pair of small gears sits on the rule under each screen title.
  root.querySelectorAll('.page-head').forEach(h => h.querySelector('.head-gears') || h.insertAdjacentHTML('beforeend', '<span class="head-gears" data-gear="pair" aria-hidden="true"></span>'));
  mech.scan(root);
  window.scrollTo(0, y);
  // A new screen rises in; a redraw after a data change doesn't.
  if (entering) {
    entering = false;
    mech.kick(220);
    revealLater(root);
    root.classList.remove('enter');
    void root.offsetWidth;
    root.classList.add('enter');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => root.classList.remove('enter'), 1100);
  }
  sideGauge();
}

// The gold mark under the open tab glides to the tab you pick.
function moveTabMark() {
  const mark = $('.tab-mark'), on = $('.tabbar button.active');
  if (!mark) return;
  if (!on || !on.offsetWidth || matchMedia('(min-width: 1100px)').matches) { mark.style.opacity = 0; return; }
  mark.style.opacity = 1;
  mark.style.transform = `translateX(${on.offsetLeft + on.offsetWidth / 2 - 14}px)`;
}

// Scrolling: past a screen's title a slim bar keeps the title in view; scrolling down tucks
// the tab bar into a small pill so the screen gets the room, and any scroll up brings it back.
function initScrollChrome() {
  const bar = $('#topbar');
  let lastY = scrollY, ticking = false;
  const update = () => {
    ticking = false;
    const y = scrollY, head = $('#view .page-head h1, #view .hello h1');
    const past = !!head && head.getBoundingClientRect().bottom < 8 + (parseFloat(getComputedStyle(document.body).getPropertyValue('--safe-t')) || 0);
    if (past && bar.firstChild.textContent !== head.textContent) bar.firstChild.textContent = head.textContent;
    document.body.classList.toggle('compact', past);
    const dy = y - lastY;
    if (y < 80 || dy < -6) document.body.classList.remove('tab-min');
    else if (dy > 8) document.body.classList.add('tab-min');
    if (Math.abs(dy) > 6 || y < 80) lastY = y;
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  bar.onclick = () => scrollTo({ top: 0, behavior: 'smooth' });
}

// Parts of a new screen that start below the fold latch into place as they scroll in.
let laterObs;
function revealLater(root) {
  laterObs?.disconnect();
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  laterObs = new IntersectionObserver(entries => entries.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add('in');
    laterObs.unobserve(e.target);
  }), { rootMargin: '0px 0px -40px 0px' });
  for (const el of root.children) if (el.getBoundingClientRect().top > innerHeight) { el.classList.add('later'); laterObs.observe(el); }
}

// Laptop sidebar: the week's study hours on a subdial and today's Çetele as a row of index marks.
function sideGauge() {
  const el = $('[data-gauge]');
  if (!el || !matchMedia('(min-width: 1100px)').matches) return;
  const s = D.studySummary();
  const ct = CT.day();
  const goal = Math.round(s.dailyGoalMin * 7 / 60) || 15;
  const h = s.weekMin / 60;
  const open = ct.rows.filter(r => !r.met).map(r => r.name);
  const remain = !open.length ? 'All minimums met' : open.length === 1 ? `${open[0]} remains` : `${open.slice(0, -1).join(', ')} and ${open.at(-1)} remain`;
  el.innerHTML = `
    <button class="sg-dial" data-to="study">${subdial(h, goal, { label: 'study', size: 76 })}<span><b>${h.toFixed(1)}</b><small> / ${goal} h</small><em>this week</em></span></button>
    <button class="sg-ct" data-to="cetele"><span class="eyebrow">Çetele · ${ct.done} of ${ct.total}</span><span class="sg-marks">${ct.rows.filter(r => r.per !== 'week').map(r => `<i class="${r.met ? 'on' : ''}"></i>`).join('')}</span><em>${remain}</em></button>`;
  el.querySelectorAll('[data-to]').forEach(b => (b.onclick = () => go(b.dataset.to)));
}

async function onboarding() {
  if (db.setting('onboarded', false)) return;
  const v = await sheet({
    title: 'Yaver',
    body: '<p class="muted small">Study tracking, money, meetings, diet and an AI assistant. Set the basics; everything can be changed later in Settings.</p>',
    fields: [
      { name: 'userName', label: 'What should I call you?', placeholder: 'Mustafa' },
      { name: 'currency', label: 'Currency', type: 'select', options: currencyOptions().filter(([c]) => c), value: 'TRY' },
      { name: 'apiKey', label: 'AI key: free Gemini key from aistudio.google.com/apikey (or a Claude key)', type: 'password', placeholder: 'AIza… (can add later)' },
    ],
    submit: 'Start',
  });
  if (v) {
    if (v.userName) await db.setSetting('userName', v.userName.trim());
    if (v.currency) await db.setSetting('currency', v.currency);
    if (v.apiKey) saveKey(v.apiKey).then(toast, e => toast(e.message, 4000));
  }
  await db.setSetting('onboarded', true);
}

// A link like …/yaver/#connect=yaver1.… sets up the Mac bridge in one tap.
function takeConnectLink() {
  if (!location.hash.startsWith('#connect=')) return false;
  const code = decodeURIComponent(location.hash.slice(9));
  history.replaceState(null, '', '#settings');
  useCode(code).then(() => toast('Connected to the bridge on your Mac.'), e => toast(e.message, 5000));
  return true;
}

async function start() {
  await db.openDB();
  await sortKeys();
  await CT.seed();
  // v16: the iPhone voice became the default (the Gemini voice was slow and crackled).
  if (!db.setting('voiceV16', false)) { await db.setSetting('voiceStyle', 'device'); await db.setSetting('voiceV16', true); }
  initAssistant();

  document.querySelectorAll('.tabbar [data-tab]').forEach(b => {
    const [ic, label, key] = TABS[b.dataset.tab];
    b.innerHTML = `${icon(ic)}<span>${label}</span><kbd class="side-only">${key}</kbd>`;
    b.onclick = () => go(b.dataset.tab);
  });
  sound.init();
  mech.initDrive();
  mech.onEngineTap(sound.spin);
  mech.scan(document);
  // A soft click for every button; the Yaver gear makes its own sound.
  document.addEventListener('pointerdown', e => {
    const b = e.target.closest('button, a, label, .chip, select');
    if (b && !b.closest('#fab') && !b.querySelector('input[type=checkbox]') && !e.target.matches('input[type=checkbox]')) sound.tap();
  }, { capture: true, passive: true });
  // Switches and checkboxes click on and off.
  document.addEventListener('change', e => { if (e.target.matches?.('input[type=checkbox]') && !e.target.closest('[data-haptic]')) sound.toggle(e.target.checked); }, true);
  // The Yaver gear: tap to ask, hold (or flick up) for the command bar.
  const fab = $('#fab');
  let hold, held = false, y0 = 0;
  fab.addEventListener('pointerdown', e => { held = false; y0 = e.clientY; clearTimeout(hold); hold = setTimeout(() => { held = true; haptic(); openCommand(); }, 420); });
  fab.addEventListener('pointermove', e => { if (!held && y0 - e.clientY > 28) { clearTimeout(hold); held = true; haptic(); openCommand(); } });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => fab.addEventListener(t, () => clearTimeout(hold)));
  fab.addEventListener('contextmenu', e => e.preventDefault());
  fab.onclick = () => { if (held) { held = false; return; } openAssistant(); };
  const cmd = $('.tabbar [data-cmd]');
  cmd.innerHTML = `${icon('search')}<span>Do or find</span><kbd>${/Mac|iP/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd>`;
  cmd.onclick = () => openCommand();
  initCommand(go);
  initScrollChrome();
  addEventListener('resize', moveTabMark);
  // On a laptop the assistant button lives in the sidebar.
  const ask = $('.tabbar [data-ask]');
  ask.innerHTML = `${icon('sparkle')}<span>Ask Yaver</span><kbd>/</kbd>`;
  ask.onclick = () => openAssistant();
  // Course content loads in the background; screens that need it redraw when it arrives.
  C.init().catch(() => {});
  window.addEventListener('course-ready', () => { if (current !== 'map') draw(); });
  matchMedia('(min-width: 1100px)').addEventListener?.('change', sideGauge);
  initShortcuts(go);
  // Chrome/Edge on a computer: keep the install prompt for the button in Settings.
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.yaverInstall = e; });
  initSync();
  // Yaver on the Mac: connect to Claude through the bridge running on this Mac, if there is one.
  pairLocal();
  // The first tap anywhere unlocks sound, so voice chat can speak straight away.
  document.addEventListener('pointerdown', () => { try { unlockAudio(); } catch {} }, { once: true, capture: true });
  courseView.initSlotAlerts();

  // Redraw after any change, batched so a burst of writes draws once.
  let pending;
  // (The map keeps its own state, so data changes don't redraw it.)
  db.onChange((store, id) => { if (current === 'map' || (store === 'kv' && (/^sync/.test(String(id)) || current === 'settings'))) return; if (store !== 'kv') { mech.kick(90); sound.save(); } clearTimeout(pending); pending = setTimeout(draw, 30); });
  // Midnight rollover, coming back to the app, etc.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && current !== 'map') draw(); });
  window.addEventListener('hashchange', () => { if (takeConnectLink()) return go('settings'); const h = location.hash.slice(1); if (h !== (param ? `${current}/${encodeURIComponent(param)}` : current)) go(h); });

  takeConnectLink();
  go(location.hash.slice(1) || 'home');
  document.body.classList.add('ready');

  // Home Screen shortcuts: index.html?ask=1 opens the assistant straight away.
  const params = new URLSearchParams(location.search);
  if (params.has('ask')) openAssistant();

  onboarding();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) toast('Yaver was updated. Reopen the app to get the new version.', 4000);
        });
      });
    }).catch(() => {});
  }
}

start().catch(err => {
  console.error(err);
  document.body.innerHTML = `<p style="padding:24px;color:#fff">Yaver could not start: ${err.message}</p>`;
});
