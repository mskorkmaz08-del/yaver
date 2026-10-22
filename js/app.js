// Yaver entry point: opens the database, draws the current screen, and
// re-draws it whenever data changes (from a form or from Claude).
import * as db from './db.js';
import { $, sheet, toast } from './util.js';
import { initAssistant, openAssistant } from './ai/assistant.js';
import { saveKey, sortKeys } from './ai/provider.js';
import { useCode } from './ai/mac.js';
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
import * as C from './course.js';
import { initShortcuts } from './keys.js';
import { initSync } from './sync.js';
import { currencyOptions } from './data.js';
import { icon } from './icons.js';

const TABS = { home: ['home', 'home'], cetele: ['moon', 'çetele'], study: ['book', 'study'], calendar: ['calendar', 'meet'], money: ['wallet', 'money'], diet: ['leaf', 'diet'], map: ['map', 'map'], settings: ['settings', 'settings'] };

const VIEWS = { home, cetele, money, calendar, study, diet, map: mapView, settings, course: courseView, lesson: lessonView };
// Screens that belong to a tab for highlighting.
const PARENT = { course: 'study', lesson: 'study' };
let current = 'home';
let param = '';

export function go(name, arg = '') {
  if (name.includes('/')) [name, arg] = [name.slice(0, name.indexOf('/')), decodeURIComponent(name.slice(name.indexOf('/') + 1))];
  if (!VIEWS[name]) name = 'home';
  if (current !== name || param !== arg) VIEWS[current].cleanup?.();
  current = name;
  param = arg;
  const hash = arg ? `${name}/${encodeURIComponent(arg)}` : name;
  if (location.hash.slice(1) !== hash) history.replaceState(null, '', `#${hash}`);
  document.body.dataset.view = name;
  document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === (PARENT[name] || name)));
  draw();
  $('#view').scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

function draw() {
  const root = $('#view');
  const y = window.scrollY;
  VIEWS[current].render(root, go, param);
  window.scrollTo(0, y);
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
  initAssistant();

  document.querySelectorAll('.tabbar [data-tab]').forEach(b => {
    const [ic, label] = TABS[b.dataset.tab];
    b.innerHTML = `${icon(ic)}<span>${label}</span>`;
    b.onclick = () => go(b.dataset.tab);
  });
  $('#fab').onclick = () => openAssistant();
  // On a laptop the assistant button lives in the sidebar.
  const ask = $('.tabbar [data-ask]');
  ask.innerHTML = `${icon('sparkle')}<span>ask yaver</span><kbd>/</kbd>`;
  ask.onclick = () => openAssistant();
  // Course content loads in the background; screens that need it redraw when it arrives.
  C.init().catch(() => {});
  window.addEventListener('course-ready', () => { if (current !== 'map') draw(); });
  initShortcuts(go);
  // Chrome/Edge on a computer: keep the install prompt for the button in Settings.
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.yaverInstall = e; });
  initSync();
  courseView.initSlotAlerts();

  // Redraw after any change, batched so a burst of writes draws once.
  let pending;
  // (The map keeps its own state, so data changes don't redraw it.)
  db.onChange((store, id) => { if (current === 'map' || (store === 'kv' && /^sync/.test(String(id)))) return; clearTimeout(pending); pending = setTimeout(draw, 30); });
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
