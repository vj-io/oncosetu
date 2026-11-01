// OncoSetu capture service worker. Hand-written (no Workbox).
// Offline shell for /capture: the page itself and /_next/static assets. Never caches /api/** or anything with patient data.
// Registered only from /capture (scope "/"). All other requests pass through untouched.
const VERSION = 'v1'
const CACHE = `oncosetu-shell-${VERSION}`
const PAGE = '/capture'
const DB_NAME = 'oncosetu-capture' // keep in sync with src/lib/offline/idb.ts
const NET_TIMEOUT_MS = 4000
const ALLOWED = (p) => p === PAGE || p === '/manifest.webmanifest' || p.startsWith('/_next/static/') || p.startsWith('/icons/')

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
const firstParty = (res) => res.ok && res.type === 'basic' && !res.redirected // never cache a login redirect as /capture

async function put(cache, key, url) {
  // redirect: 'manual' so a signed-out session (redirect to /login) is not stored as the page
  const res = await fetch(url, { redirect: 'manual', credentials: 'same-origin' })
  if (firstParty(res)) await cache.put(key, res)
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    // best effort: icons are public; /capture only caches when the registering session is signed in
    await Promise.allSettled(['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'].map((u) => put(cache, u, u)))
    await put(cache, PAGE, PAGE).catch(() => {})
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('oncosetu-shell-') && k !== CACHE) await caches.delete(k)
    await self.clients.claim()
  })())
})

// The page sends the /_next/static URLs it loaded (names are hashed per build, so they cannot be listed up front).
self.addEventListener('message', (event) => {
  const d = event.data
  if (d?.type !== 'precache' || !Array.isArray(d.urls)) return
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await Promise.allSettled(d.urls.map(async (u) => {
      const url = new URL(u, self.location.origin)
      if (url.origin !== self.location.origin || !ALLOWED(url.pathname)) return
      const key = url.pathname === PAGE ? PAGE : url.pathname + url.search
      if (key !== PAGE && (await cache.match(key))) return // hashed assets never change
      await put(cache, key, key)
    }))
  })())
})

async function navigate(request) {
  const cache = await caches.open(CACHE)
  try {
    const res = await Promise.race([fetch(request), timeout(NET_TIMEOUT_MS)])
    if (firstParty(res)) await cache.put(PAGE, res.clone())
    return res
  } catch {
    return (await cache.match(PAGE, { ignoreVary: true })) ?? Response.error()
  }
}

async function asset(request) {
  const cache = await caches.open(CACHE)
  try {
    const res = await Promise.race([fetch(request), timeout(NET_TIMEOUT_MS)])
    if (res.ok) await cache.put(request, res.clone())
    return res
  } catch {
    return (await cache.match(request)) ?? Response.error()
  }
}

// Staff sign out: wipe the offline queue and the cached page (it carries the signed-in name). FR-OFF-03.
async function wipeOnLogout() {
  await new Promise((resolve) => {
    const r = indexedDB.deleteDatabase(DB_NAME) // open pages close their connection on versionchange
    r.onsuccess = r.onerror = () => resolve()
  })
  await (await caches.open(CACHE)).delete(PAGE)
  for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'wiped' })
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    event.waitUntil(wipeOnLogout()) // the request itself goes to the network untouched
    return
  }
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) return
  if (req.mode === 'navigate' && url.pathname === PAGE) event.respondWith(navigate(req))
  else if (ALLOWED(url.pathname) && url.pathname !== PAGE) event.respondWith(asset(req))
})
