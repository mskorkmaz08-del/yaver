// Service worker: keeps a copy of the app on the phone so Yaver opens
// instantly and works offline. Bump VERSION whenever app files change.
const VERSION = 'yaver-v4';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/util.js', 'js/data.js', 'js/ui.js', 'js/forms.js', 'js/ics.js',
  'js/ai/claude.js', 'js/ai/tools.js', 'js/ai/assistant.js', 'js/ai/gemini.js', 'js/ai/provider.js',
  'js/icons.js', 'js/reminders.js', 'js/places.js', 'js/views/map.js', 'js/views/home.js', 'js/views/money.js', 'js/views/calendar.js', 'js/views/study.js', 'js/views/diet.js', 'js/views/settings.js',
  'vendor/anthropic-sdk.js', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'data/ml-roadmap.json', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Only our own files. Calls to api.anthropic.com always go straight to the network.
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
