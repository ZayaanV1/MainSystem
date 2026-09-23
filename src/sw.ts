/// <reference lib="webworker" />

/**
 * The service worker.
 *
 * Hand-written rather than generated. It does two jobs — cache the app shell
 * for offline reading, and display push notifications — and both are short
 * enough that a Workbox dependency would be more machinery than the problem
 * deserves. Every dependency is something that can break at 2am when this app
 * is the only thing holding the week together.
 *
 * Caching strategy, chosen for what this app actually is:
 *   - App shell: cache-first. It changes only on deploy, and opening the app
 *     must never wait on a network round-trip.
 *   - Everything else, including all Supabase traffic: network-only. Stale
 *     assignment data presented as current would be worse than no data. Writes
 *     made offline are handled by the IndexedDB outbox, not by the cache.
 */

/**
 * `__WB_MANIFEST` is declared on `self` rather than as a bare global on
 * purpose: the build injects the precache list by finding the literal text
 * `self.__WB_MANIFEST` in the bundled output, and a bare global gets renamed
 * away by the bundler, leaving nowhere to inject.
 */
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};

const MANIFEST = self.__WB_MANIFEST;
const CACHE = `app-shell-${MANIFEST.map((e) => e.revision ?? e.url).join('|').length}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);

      // Deliberately NOT cache.addAll. addAll is atomic: one asset that 404s,
      // times out, or is blocked by the network and the entire install
      // rejects, the worker never activates, and navigator.serviceWorker.ready
      // never resolves — which surfaces as push being impossible to enable,
      // with nothing anywhere saying why.
      //
      // Offline reading of one stale asset is a far smaller problem than a
      // worker that refuses to exist, so failures are collected and the
      // install continues.
      const results = await Promise.allSettled(
        MANIFEST.map((entry) => cache.add(entry.url)),
      );

      const failed = results
        .map((r, i) => (r.status === 'rejected' ? MANIFEST[i].url : null))
        .filter(Boolean);

      if (failed.length) {
        console.warn('[sw] could not precache', failed.length, 'of', MANIFEST.length, failed);
      }

      // Take over immediately. A half-updated app that needs a second launch
      // to become correct is a bug you cannot explain to yourself at 7am.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never cache Supabase

  /*
   * Navigations: the network first, briefly, then the cached shell.
   *
   * This was cache-first, which made every deploy invisible until the worker
   * had updated in the background — including a fix for a crash that blanked
   * the whole app, which kept serving the broken build for another load or
   * two after the fix was live. Now an online open gets the current version,
   * and a slow or absent network falls back to the cached shell within two
   * seconds, so a cold offline launch still opens.
   *
   * The fresh page is deliberately NOT written into the cache: the cached
   * shell must stay the one that matches this worker's precached assets, or
   * an offline launch could load a page whose scripts were never stored.
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2000);
          const fresh = await fetch(request, { signal: controller.signal });
          clearTimeout(timer);
          if (fresh.ok) return fresh;
        } catch {
          // Offline or slow: the cached shell below.
        }
        const cached = await caches.match('/index.html');
        return cached ?? fetch(request);
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});

/* -------------------------------------------------------------- push ----- */

interface PushPayload {
  title?: string;
  body?: string;
  deepLink?: string;
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = {};
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {};
  } catch {
    payload = { body: event.data?.text() ?? '' };
  }

  // A push that shows no notification gets the subscription revoked by Apple,
  // so there is always a fallback title. Silence here costs the whole channel.
  const title = payload.title || 'Planner';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || 'Open the app.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Replaces rather than stacks: four unread digests on the lock screen is
      // a wall of evidence that you are behind, which is the exact feeling
      // this app exists to avoid.
      tag: 'digest',
      // `renotify` is in the Notifications spec but not yet in lib.dom, so the
      // cast is a TypeScript gap rather than a hack. Without it, a replaced
      // notification updates silently and you never learn the digest arrived.
      renotify: true,
      data: { deepLink: payload.deepLink ?? '/' },
    } as NotificationOptions & { renotify: boolean }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target = (event.notification.data as { deepLink?: string })?.deepLink ?? '/';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Focus an open window rather than opening a second copy.
      for (const client of clientList) {
        if ('focus' in client) {
          await client.focus();
          return;
        }
      }

      await self.clients.openWindow(target);
    })(),
  );
});

export {};
