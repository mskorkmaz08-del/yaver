// Service worker: keeps a copy of the app on the phone so Yaver opens
// instantly and works offline. Bump VERSION whenever app files change.
const VERSION = 'yaver-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/util.js', 'js/data.js', 'js/ui.js', 'js/forms.js', 'js/ics.js',
  'js/ai/claude.js', 'js/ai/tools.js', 'js/ai/assistant.js',
  'js/views/home.js', 'js/views/money.js', 'js/views/calendar.js', 'js/views/study.js', 'js/views/diet.js', 'js/views/settings.js',
  'vendor/anthropic-sdk.js', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
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
  // Cache first (instant + offline), then refresh the cache in the background.
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => hit);
    return hit || fresh;
  }));
});
