/* P0.5 is online-first. Cached shell is a fallback, not an offline guarantee.
   Loaded workers keep their current game; a refresh starts the new version. */
// Build-time injection. An unpackaged development source must not share a release cache.
const BUILD_CACHE = {"algorithm":"sw-cache-inputs-v1","application_id":"chengdu-mahjong-ai-tutor","source_sha256":"cbaf1ea97e45a093497cd51ca9dc04c421a3258df75c5604cdd1014c2ee715f4","storage_channel":"formal_learning"};
if(!BUILD_CACHE || BUILD_CACHE.algorithm !== 'sw-cache-inputs-v1' ||
   !['development_preview','device_acceptance','formal_learning'].includes(BUILD_CACHE.storage_channel) ||
   typeof BUILD_CACHE.application_id !== 'string' || !BUILD_CACHE.application_id ||
   !/^[a-f0-9]{64}$/.test(BUILD_CACHE.source_sha256)) throw Error('SW build cache identity missing or invalid');
const CACHE_PREFIX = 'mahjong-sw-cache-v1:' +
  [BUILD_CACHE.application_id, BUILD_CACHE.storage_channel, new URL(self.registration.scope).href]
    .map(encodeURIComponent).join(':') + ':';
const CACHE_NAME = CACHE_PREFIX + BUILD_CACHE.source_sha256;

const APP_SHELL = [
  './app.html', './style.css', './game.js', './transport_pyodide.js',
  './worker.js', './manifest.webmanifest', '../release.json',
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
      // Do not replace a controller during a recorded game. New workers activate after old pages close.
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME &&
        n.startsWith(CACHE_PREFIX) && /^[a-f0-9]{64}$/.test(n.slice(CACHE_PREFIX.length))).map(n => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  const work = (async()=>{
    let cache;
    try{cache = await caches.open(CACHE_NAME);}
    catch(err){console.warn('SW cache-open-failed', err);}
    try{
      const response = await fetch(event.request);
      const write = response.ok && cache ? Promise.resolve()
        .then(()=>cache.put(event.request, response.clone()))
        .catch(err=>{console.warn('SW cache-write-failed', err);}) : Promise.resolve();
      return {response, write};
    }catch(err){
      const cached = cache && await cache.match(event.request);
      if(cached) return {response:cached, write:Promise.resolve()};
      throw err;
    }
  })();
  // Register synchronously while the event is active; returning the response does not end the write lifetime.
  event.waitUntil(work.then(result=>result.write, ()=>undefined));
  event.respondWith(work.then(result=>result.response));
});
