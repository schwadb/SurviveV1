var CACHE_NAME = 'survivev1-v1';
var APP_SHELL = [
  '/',
  '/ai',
  '/status',
  '/files',
  '/search',
  '/static/manifest.json',
  '/static/icon-192.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; })
             .map(function(n) { return caches.delete(n); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return new Response(JSON.stringify({error: 'Offline — server unavailable'}),
          {headers: {'Content-Type': 'application/json'}});
      })
    );
    return;
  }

  if (url.pathname.startsWith('/serve/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function(cache) {
        return cache.match(event.request).then(function(cached) {
          if (cached) return cached;
          return fetch(event.request).then(function(response) {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          });
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request).then(function(response) {
      if (response.ok && event.request.method === 'GET') {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
      }
      return response;
    }).catch(function() {
      return caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return new Response(
          '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SurviveV1 — Offline</title>' +
          '<style>body{background:#0d1117;color:#e6edf3;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;margin:0}' +
          '.wrap{max-width:400px;padding:40px}h1{color:#3fb950;font-size:36px}p{color:#8b949e;line-height:1.6}</style></head><body><div class="wrap">' +
          '<h1>SurviveV1</h1><p>The server is restarting. Your saved content is still on this device. This page will reload automatically.</p>' +
          '<script>setInterval(function(){fetch("/health").then(function(r){if(r.ok)location.reload()}).catch(function(){})},5000)<\/script>' +
          '</div></body></html>',
          {headers: {'Content-Type': 'text/html'}}
        );
      });
    })
  );
});
