/* P0.5 is online-first. Cached shell is a fallback, not an offline guarantee.
   Loaded workers keep their current game; a refresh starts the new version. */
const SCOPE_ID = new URL(self.registration.scope).pathname;
const CACHE_NAME = 'xuezhan-pwa-p1a-preview-v15:' + SCOPE_ID;

const APP_SHELL = [
  './app.html', './style.css', './game.js', './transport_pyodide.js',
  './worker.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png',
  // Python sources the worker fetches into its virtual filesystem
  '../dfncy/block_dfncy.py', '../hytreekong.py', '../strategy_defense.py',
  '../strategy_huev.py', '../strategy_initial21_7attr.py', '../strategyz0614.py',
  '../utils/constants.py', '../utils/daque.py', '../utils/hutype.py',
  '../utils/hysolx.py', '../utils/pusolx.py', '../utils/xzcard.py',
  '../utils/xzscore.py', '../utils/xzutils.py',
  '../xzdealer.py', '../xzjudger.py', '../xzplayer.py', '../xzround.py',
  './game_core.py', './pwa_bridge.py',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME &&
        n.startsWith('xuezhan-pwa-') && n.endsWith(':' + SCOPE_ID)).map(n => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  event.respondWith(
    (async()=>{
      const cache = await caches.open(CACHE_NAME);
      try{
        const resp = await fetch(event.request);
        if(resp.ok){try{await cache.put(event.request, resp.clone());}catch(_){/* quota must not block online play */}}
        return resp;
      }catch(err){
        const cached = await cache.match(event.request);
        if(cached) return cached;
        throw err;
      }
    })()
  );
});
