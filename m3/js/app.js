// Yaver M III entry point: opens the database, draws the current screen, and
// re-draws it whenever data changes (from a form or from the AI). One navigation adapts
// to the screen: a tab bar with More on a phone, a rail on an iPad, a sidebar on a computer.
import * as db from './db.js';
import { $, sheet, toast, haptic } from './util.js';
import { initAssistant, openAssistant, routeChanged } from './ai/assistant.js';
import { exitFocus } from './focus.js';
import { saveKey, sortKeys } from './ai/provider.js';
import { useCode, pairLocal } from './ai/mac.js';
import { syncAppleCalendar } from './applecal.js';
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
import * as programView from './views/program.js';
import * as P from './program.js';
import * as lessonView from './views/lesson.js';
import * as skillsView from './views/skills.js';
import * as teamsView from './views/teams.js';
import * as bodyView from './views/body.js';
import * as C from './course.js';
import { initShortcuts } from './keys.js';
import { initCommand, openCommand } from './command.js';
import { initSync } from './sync.js';
import { currencyOptions } from './data.js';
import * as D from './data.js';
// A plain progress ring (0..1) in the accent colour.
const ring = f => { const C = 2 * Math.PI * 20, v = Math.max(0, Math.min(1, f || 0)); return `<svg class="sg-ring" viewBox="0 0 48 48" aria-hidden="true"><circle r="20" cx="24" cy="24"/><circle class="v" r="20" cx="24" cy="24" stroke-dasharray="${(C * v).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 24 24)"/></svg>`; };
import * as sound from './sound.js';
import * as mech from './mech.js';
import { icon } from './icons.js';

export const TABS = { home: ['home', 'Home', '1'], study: ['book', 'Study', '2'], calendar: ['calendar', 'Calendar', '3'], money: ['wallet', 'Money', '4'], diet: ['leaf', 'Food', '5'], cetele: ['tally', 'Habits', '6'], body: ['body', 'Body', '7'], teams: ['users', 'People', '8'], map: ['map', 'Map', '9'], skills: ['trophy', 'Skills', '0'], settings: ['settings', 'Settings', ','] };

const VIEWS = { home, cetele, money, calendar, study, diet, map: mapView, settings, course: courseView, lesson: lessonView, skills: skillsView, teams: teamsView, body: bodyView, program: programView };
// Screens that belong to a tab for highlighting.
const PARENT = { course: 'study', lesson: 'study', program: 'study' };
// On a phone these live under More.
const MORE = ['money', 'diet', 'cetele', 'body', 'teams', 'map', 'skills', 'settings'];
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
  document.querySelectorAll('.tabbar [data-tab]').forEach(b => { const on = b.dataset.tab === (PARENT[name] || name); b.classList.toggle('active', on); on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
  document.querySelector('.tabbar [data-more]')?.classList.toggle('active', MORE.includes(PARENT[name] || name));
  // screens slide in from the side of the tab they come from; deeper screens rise
  const order = Object.keys(TABS), a = order.indexOf(PARENT[current] || current), b = order.indexOf(PARENT[name] || name);
  document.body.dataset.dir = PARENT[name] && !PARENT[current] ? 'in' : b > a ? 'next' : b < a ? 'prev' : 'in';
  moveTabMark();
  entering = true;
  draw();
  $('#view').scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

let entering = false, enterTimer;
const MOUNTS = ['[data-engine]', '[data-train]', '[data-gem]'];
function draw() {
  const root = $('#view');
  const y = window.scrollY;
  // Keep running mechanisms across redraws so their gears don't jump back to the start.
  const kept = MOUNTS.map(sel => [...root.querySelectorAll(sel)]);
  VIEWS[current].render(root, go, param);
  MOUNTS.forEach((sel, k) => root.querySelectorAll(sel).forEach((el, i) => kept[k][i] && kept[k][i].className === el.className && el.replaceWith(kept[k][i])));
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

// The accent pill under the open tab glides to the tab you pick (phone tab bar only).
function moveTabMark() {
  const mark = $('.tab-mark'), on = $('.tabbar button.active');
  if (!mark) return;
  const target = on?.offsetWidth ? on : $('.tabbar [data-more].active');
  if (!target || matchMedia('(min-width: 768px)').matches) { mark.style.opacity = 0; return; }
  mark.style.opacity = 1;
  mark.style.transform = `translateX(${target.offsetLeft + target.offsetWidth / 2 - 14}px)`;
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

// Laptop sidebar: the week's study hours on a progress ring and today's habits as a row of marks.
function sideGauge() {
  const el = $('[data-gauge]');
  if (!el || !matchMedia('(min-width: 1100px)').matches) return;
  const s = D.studySummary();
  const ct = CT.day();
  const goal = Math.round(s.dailyGoalMin * 7 / 60) || 15;
  const h = s.weekMin / 60;
  const open = ct.rows.filter(r => !r.met).map(r => r.name);
  const remain = !ct.rows.length ? 'No habits yet' : !open.length ? 'All done today' : open.length === 1 ? `${open[0]} remains` : `${open.slice(0, -1).join(', ')} and ${open.at(-1)} remain`;
  el.innerHTML = `
    <button class="sg-dial" data-to="study" aria-label="Study: ${h.toFixed(1)} of ${goal} hours this week">${ring(h / goal)}<span><b>${h.toFixed(1)}<small> / ${goal} h</small></b><em>studied this week</em></span></button>
    <button class="sg-ct" data-to="cetele"><span class="eyebrow">Habits · ${ct.done} of ${ct.total}</span><span class="sg-marks">${ct.rows.filter(r => r.per !== 'week').map(r => `<i class="${r.met ? 'on' : ''}"></i>`).join('')}</span><em>${remain}</em></button>`;
  el.querySelectorAll('[data-to]').forEach(b => (b.onclick = () => go(b.dataset.to)));
}

async function onboarding() {
  if (db.setting('onboarded', false)) return;
  const v = await sheet({
    title: 'Welcome to Yaver',
    body: '<p class="muted small">Your study program, money, meetings, food and habits, with an AI assistant that can do things for you. Set the basics; everything can be changed later in Settings.</p>',
    fields: [
      { name: 'userName', label: 'What should I call you?', placeholder: 'Your name' },
      { name: 'currency', label: 'Currency', type: 'select', options: currencyOptions().filter(([c]) => c), value: guessCurrency() },
      { name: 'apiKey', label: 'AI key (optional): a free Gemini key from aistudio.google.com/apikey, or a Claude key', type: 'password', placeholder: 'AIza… (can add later)' },
    ],
    submit: 'Continue',
  });
  if (v) {
    if (v.userName) await db.setSetting('userName', v.userName.trim());
    if (v.currency) await db.setSetting('currency', v.currency);
    if (v.apiKey) saveKey(v.apiKey).then(toast, e => toast(e.message, 4000));
  }
  await db.setSetting('onboarded', true);
  // the study program is the heart of M III: build it straight away
  if (v && !P.exists()) go('program/new');
}

function guessCurrency() {
  const loc = navigator.language || 'en-US';
  const region = (loc.split('-')[1] || '').toUpperCase();
  const map = { TR: 'TRY', US: 'USD', GB: 'GBP', KZ: 'KZT', DE: 'EUR', FR: 'EUR', NL: 'EUR', ES: 'EUR', IT: 'EUR', JP: 'JPY', IN: 'INR', CA: 'CAD', AU: 'AUD' };
  const c = map[region] || 'USD';
  return currencyOptions().some(([x]) => x === c) ? c : 'USD';
}

// Appearance: light, dark or the device's, and an accent colour. Kept in the database (synced)
// and mirrored to localStorage so the next launch paints the right theme before anything loads.
export function applyTheme() {
  const t = db.setting('theme', 'auto'), a = db.setting('accent', 'blue');
  const el = document.documentElement;
  if (t === 'light' || t === 'dark') el.dataset.theme = t; else delete el.dataset.theme;
  el.dataset.accent = a;
  try { localStorage.setItem('yaverTheme', t); localStorage.setItem('yaverAccent', a); } catch { /* private mode */ }
  const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { if (t !== 'auto' && bg) m.setAttribute('content', bg); });
}

// Phone: everything that isn't in the tab bar, as a grid in a sheet.
function openMore() {
  document.querySelector('.more-wrap')?.remove();
  const w = document.createElement('div');
  w.className = 'sheet-wrap more-wrap';
  w.innerHTML = `<div class="sheet more-sheet" role="dialog" aria-label="All sections"><div class="grabber"></div><h2>All sections</h2>
    <div class="more-grid">${MORE.map(t => `<button data-go="${t}" class="${(PARENT[current] || current) === t ? 'on' : ''}">${icon(TABS[t][0])}<span>${TABS[t][1]}</span></button>`).join('')}</div>
    <button class="more-cmd" data-cmd2>${icon('search')}<span>Do or find anything</span></button></div>`;
  document.body.append(w);
  const close = () => { w.classList.remove('open'); setTimeout(() => w.remove(), 300); };
  requestAnimationFrame(() => w.classList.add('open'));
  w.addEventListener('click', e => { if (e.target === w) close(); });
  w.querySelectorAll('[data-go]').forEach(b => (b.onclick = () => { haptic(); close(); go(b.dataset.go); }));
  w.querySelector('[data-cmd2]').onclick = () => { close(); openCommand(); };
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
  applyTheme();
  // v16: the iPhone voice became the default (the Gemini voice was slow and crackled).
  if (!db.setting('voiceV16', false)) { await db.setSetting('voiceStyle', 'device'); await db.setSetting('voiceV16', true); }
  initAssistant();

  document.querySelectorAll('.tabbar [data-tab]').forEach(b => {
    const [ic, label, key] = TABS[b.dataset.tab];
    b.innerHTML = `${icon(ic)}<span>${label}</span><kbd class="side-only">${key}</kbd>`;
    b.setAttribute('aria-label', label);
    b.onclick = () => { haptic(); go(b.dataset.tab); };
  });
  const more = $('.tabbar [data-more]');
  if (more) { more.innerHTML = `${icon('grid')}<span>More</span>`; more.setAttribute('aria-label', 'More sections'); more.onclick = () => { haptic(); openMore(); }; }
  sound.init();
  mech.initDrive();
  mech.scan(document);
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
  C.init().then(() => C.dropStaleTimer()).catch(() => {});
  window.addEventListener('course-ready', () => { if (current !== 'map' && current !== 'program') draw(); });
  matchMedia('(min-width: 1100px)').addEventListener?.('change', sideGauge);
  matchMedia('(min-width: 768px)').addEventListener?.('change', moveTabMark);
  initShortcuts(go);
  // Chrome/Edge on a computer: keep the install prompt for the button in Settings.
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.yaverInstall = e; });
  initSync();
  // Yaver on the Mac: connect to Claude through the bridge running on this Mac, if there is one.
  pairLocal();
  // Apple Calendar through the Mac bridge: a fresh copy on start and when coming back.
  setTimeout(() => syncAppleCalendar().catch(() => {}), 1500);
  // The first tap anywhere unlocks sound, so voice chat can speak straight away.
  document.addEventListener('pointerdown', () => { try { unlockAudio(); } catch {} }, { once: true, capture: true });
  courseView.initSlotAlerts();

  // Redraw after any change, batched so a burst of writes draws once.
  let pending;
  // (The map keeps its own state, so data changes don't redraw it.)
  db.onChange((store, id) => { if (store === 'kv' && (id === 'theme' || id === 'accent')) applyTheme(); if (current === 'map' || current === 'program' || (store === 'kv' && (/^sync/.test(String(id)) || current === 'settings'))) return; if (store !== 'kv') mech.kick(90); clearTimeout(pending); pending = setTimeout(draw, 30); });
  // Midnight rollover, coming back to the app, etc.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && current !== 'map' && current !== 'program') draw(); if (!document.hidden) syncAppleCalendar().catch(() => {}); });
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
          if (w.state === 'installed' && navigator.serviceWorker.controller) toast('A new version of Yaver is ready.', { ms: 8000, action: { label: 'Reload', run: () => location.reload() } });
        });
      });
    }).catch(() => {});
  }
}

start().catch(err => {
  console.error(err);
  document.body.innerHTML = `<p style="padding:24px;color:#fff">Yaver could not start: ${err.message}</p>`;
});
