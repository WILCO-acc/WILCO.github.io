/* WILCO offline worker.
   - The app itself: fetched fresh when the network answers within 3 s (so updates arrive
     whenever the iPad is online), otherwise served from the cache. Opens with Wi-Fi off.
   - Google Fonts: cached on first online launch, then served from the cache forever.
   Flight logs never pass through here: they live in the app's own storage on the device. */
const VERSION = '20260929122451';
const SHELL = 'wilco-shell-' + VERSION;
const FONTS = 'wilco-fonts';
const MARK = "window.WILCO_MODE = 'tablet'";   // present only in a real WILCO tablet build
const ASSETS = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('wilco-shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const withTimeout = (p, ms) => new Promise((ok, fail) => { const t = setTimeout(() => fail(new Error('timeout')), ms); p.then(v => { clearTimeout(t); ok(v); }, err => { clearTimeout(t); fail(err); }); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); c.put(req, res.clone()); return res; }
      catch { return Response.error(); }
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate'){
    // Only a genuine copy of the app replaces the saved one. A 404 (site taken down), a redirect
    // (e.g. a login page) or no network all fall back to the copy saved on the iPad.
    e.respondWith(withTimeout(fetch(req), 3000)
      .then(async res => {
        if (!res.ok || res.redirected || res.type !== 'basic') throw new Error('not the app');
        const html = await res.text();
        if (!html.includes(MARK)) throw new Error('not the app');   // any other page at this address is ignored
        const fresh = () => new Response(html, {headers: {'Content-Type': 'text/html; charset=utf-8'}});
        caches.open(SHELL).then(c => c.put('./', fresh()));
        return fresh();
      })
      .catch(async () => (await caches.match('./')) || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, {ignoreSearch: true}).then(hit => hit || fetch(req)));
});
