// Service worker for Yaver M III: keeps a copy of the app so it opens instantly and works
// offline. Its scope is m3/, so it never touches Yaver M1's files or cache. Bump VERSION
// whenever M III's files change.
const VERSION = 'yaver-m3-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
  'js/ai/assistant.js',
  'js/ai/claude.js',
  'js/ai/gemini.js',
  'js/ai/live.js',
  'js/ai/mac.js',
  'js/ai/provider.js',
  'js/ai/tools.js',
  'js/ai/voice.js',
  'js/anatomy.js',
  'js/app.js',
  'js/applecal.js',
  'js/body.js',
  'js/cetele.js',
  'js/command.js',
  'js/course.js',
  'js/crypto.js',
  'js/data.js',
  'js/db.js',
  'js/dietlog.js',
  'js/focus.js',
  'js/foodgaps.js',
  'js/foodscan.js',
  'js/forms.js',
  'js/icons.js',
  'js/ics.js',
  'js/insights.js',
  'js/keys.js',
  'js/mech.js',
  'js/notebook.js',
  'js/nutrients.js',
  'js/places.js',
  'js/program.js',
  'js/reminders.js',
  'js/sims.js',
  'js/skills.js',
  'js/sound.js',
  'js/sync.js',
  'js/teams.js',
  'js/training.js',
  'js/ui.js',
  'js/util.js',
  'js/views/body.js',
  'js/views/calendar.js',
  'js/views/cetele.js',
  'js/views/course.js',
  'js/views/diet.js',
  'js/views/home.js',
  'js/views/lesson.js',
  'js/views/map.js',
  'js/views/money.js',
  'js/views/program.js',
  'js/views/settings.js',
  'js/views/skills.js',
  'js/views/study.js',
  'js/views/teams.js',
  ...['circuit', 'sort', 'search', 'graph', 'structures', 'vectors', 'calculus', 'probability', 'data', 'trace', 'memory', 'git', 'shell'].map(f => `js/sims/${f}.js`),
  // shared with M1, one folder up
  '../vendor/anthropic-sdk.js', '../vendor/leaflet/leaflet.js', '../vendor/leaflet/leaflet.css',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  // only M III's own old caches: M1's ('yaver-v…') belong to the other app
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('yaver-m3-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Only our own files. API calls (Anthropic, Gemini, GitHub sync) always go straight to the network.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first, so updates show up on the next open; the saved copy is the offline
  // fallback (and is used if the network takes longer than 3 seconds).
  e.respondWith(caches.open(VERSION).then(async cache => {
    const fromNet = fetch(e.request).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; });
    const timeout = new Promise(r => setTimeout(r, 3000));
    try {
      const res = await Promise.race([fromNet, timeout]);
      if (res) return res;
    } catch {}
    return (await cache.match(e.request, { ignoreSearch: true })) || fromNet;
  }));
});
