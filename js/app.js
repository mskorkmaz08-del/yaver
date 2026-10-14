// Yaver entry point: opens the database, draws the current screen, and
// re-draws it whenever data changes (from a form or from Claude).
import * as db from './db.js';
import { $, sheet, toast } from './util.js';
import { initAssistant, openAssistant } from './ai/assistant.js';
import * as home from './views/home.js';
import * as money from './views/money.js';
import * as calendar from './views/calendar.js';
import * as study from './views/study.js';
import * as diet from './views/diet.js';
import * as settings from './views/settings.js';

const VIEWS = { home, money, calendar, study, diet, settings };
let current = 'home';

function go(name) {
  if (!VIEWS[name]) name = 'home';
  if (current === 'study' && name !== 'study') study.cleanup();
  current = name;
  if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
  document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  draw();
  $('#view').scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

function draw() {
  const root = $('#view');
  const y = window.scrollY;
  VIEWS[current].render(root, go);
  window.scrollTo(0, y);
}

async function onboarding() {
  if (db.setting('onboarded', false)) return;
  const v = await sheet({
    title: 'Merhaba! I\'m Yaver 👋',
    body: '<p class="muted">Your pocket assistant for money, meetings, studies and diet. Two quick things and we\'re set. You can change them later in Settings.</p>',
    fields: [
      { name: 'userName', label: 'What should I call you?', placeholder: 'Mustafa' },
      { name: 'currency', label: 'Currency', type: 'select', options: ['TRY', 'USD', 'EUR', 'GBP'], value: 'TRY' },
      { name: 'apiKey', label: 'Anthropic API key (for the AI, optional now)', type: 'password', placeholder: 'sk-ant-…' },
    ],
    submit: "Let's go",
  });
  if (v) {
    if (v.userName) await db.setSetting('userName', v.userName.trim());
    if (v.currency) await db.setSetting('currency', v.currency);
    if (v.apiKey) await db.setSetting('apiKey', v.apiKey.trim());
  }
  await db.setSetting('onboarded', true);
}

async function start() {
  await db.openDB();
  initAssistant();

  document.querySelectorAll('.tabbar [data-tab]').forEach(b => (b.onclick = () => go(b.dataset.tab)));
  $('#fab').onclick = () => openAssistant();

  // Redraw after any change, batched so a burst of writes draws once.
  let pending;
  db.onChange(() => { clearTimeout(pending); pending = setTimeout(draw, 30); });
  // Midnight rollover, coming back to the app, etc.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
  window.addEventListener('hashchange', () => go(location.hash.slice(1)));

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
