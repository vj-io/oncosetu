// Client-only. Registers /sw.js (called from /capture only) and hands it the static assets this page loaded,
// so the whole app shell works offline after the first visit.
const PUBLIC_ASSETS = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']

export async function registerCaptureSw(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
  await navigator.serviceWorker.ready
  const loaded = performance.getEntriesByType('resource')
    .map((e) => new URL(e.name))
    .filter((u) => u.origin === location.origin && u.pathname.startsWith('/_next/static/'))
    .map((u) => u.pathname + u.search)
  ;(reg.active ?? navigator.serviceWorker.controller)?.postMessage({
    type: 'precache', urls: ['/capture', ...PUBLIC_ASSETS, ...new Set(loaded)],
  })
}

/** The service worker wipes IndexedDB itself when staff sign out (it sees the logout request); it tells open pages. */
export function onSwWipe(fn: () => void): () => void {
  const h = (e: MessageEvent) => { if (e.data?.type === 'wiped') fn() }
  navigator.serviceWorker?.addEventListener('message', h)
  return () => navigator.serviceWorker?.removeEventListener('message', h)
}
