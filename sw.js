// Service worker: keeps a copy of the app on the phone so Yaver opens
// instantly and works offline. Bump VERSION whenever app files change.
const VERSION = 'yaver-v37';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/util.js', 'js/data.js', 'js/ui.js', 'js/forms.js', 'js/ics.js',
  'js/ai/claude.js', 'js/ai/tools.js', 'js/ai/assistant.js', 'js/ai/gemini.js', 'js/ai/provider.js', 'js/ai/mac.js', 'js/ai/voice.js', 'js/ai/live.js', 'js/cetele.js', 'js/views/cetele.js',
  'js/course.js', 'js/keys.js', 'js/command.js', 'js/sync.js', 'js/crypto.js', 'js/views/course.js', 'js/views/lesson.js', 'js/views/skills.js', 'js/skills.js', 'js/sims.js', 'js/sound.js', 'js/focus.js', 'js/mech.js', 'js/notebook.js',
  // interface sounds are tiny; the 1.3 MB music is cached the first time it plays
  ...['tap', 'on', 'off', 'enter', 'spin', 'open', 'close', 'save', 'done', 'step', 'swipe', 'stop', 'bell'].map(f => `sounds/${f}.mp3`),
  ...['circuit', 'sort', 'search', 'graph', 'structures', 'vectors', 'calculus', 'probability', 'data', 'trace', 'memory', 'git', 'shell'].map(f => `js/sims/${f}.js`),
  'data/course/course.json', 'data/course/urls.json', // Weeks 6 and 11 are consolidation weeks and have no lesson file.
  ...[0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 15].map(i => `data/course/weeks/week-${String(i).padStart(2, '0')}.json`),
  'js/icons.js', 'js/reminders.js', 'js/places.js', 'js/views/map.js', 'js/views/home.js', 'js/views/money.js', 'js/views/calendar.js', 'js/views/study.js', 'js/views/diet.js', 'js/views/settings.js',
  'vendor/anthropic-sdk.js', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'data/ml-roadmap.json', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
  ...['archivo-latin-wdth-normal', 'archivo-latin-ext-wdth-normal', ...[400, 500, 600].flatMap(w => [`ibm-plex-mono-latin-${w}-normal`, `ibm-plex-mono-latin-ext-${w}-normal`]),
    ...['cinzel-600-normal', 'cinzel-700-normal', 'spectral-400-normal', 'spectral-400-italic', 'spectral-600-normal', 'caveat-600-normal'].flatMap(f => { const [fam, ...rest] = f.split('-'); return [`${fam}-latin-${rest.join('-')}`, `${fam}-latin-ext-${rest.join('-')}`]; })].map(f => `fonts/${f}.woff2`),
  'fonts/edu-hand-latin-wght-normal.woff2', 'fonts/edu-hand-latin-ext-wght-normal.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Only our own files. Calls to api.anthropic.com and api.github.com (sync) always go straight to the network.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first, so updates show up on the next open; the saved copy is the
  // offline fallback (and is used if the network takes longer than 3 seconds).
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
