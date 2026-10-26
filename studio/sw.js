// Yaver Studio's own service worker, so the Studio can be installed as a
// separate app (its own window and Dock icon). It caches nothing: the Studio
// needs the network for its libraries anyway, and ?v= handles updates. Its
// scope (/studio/) is narrower than the main app's, so it takes over here.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
// A fetch handler (even an empty one) is what makes some browsers offer
// "Install". Requests fall through to the network as usual.
self.addEventListener("fetch", () => {});
