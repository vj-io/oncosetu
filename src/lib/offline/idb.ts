// Thin promise wrapper over IndexedDB (no dependency). Client-only.
//   meta      key-value: wrapped device key, encrypted patient list
//   captures  queued captures (plaintext CaptureMeta fields + sealed patient info)
//   pages     one sealed JPEG per page, indexed by capture
export const DB_NAME = 'oncosetu-capture'
const STORES = [
  { name: 'meta', keyPath: 'k' },
  { name: 'captures', keyPath: 'id' },
  { name: 'pages', keyPath: 'clientFileId', index: { name: 'byCapture', keyPath: 'captureId' } },
] as const

let opening: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1)
    r.onupgradeneeded = () => {
      for (const s of STORES) {
        const os = r.result.createObjectStore(s.name, { keyPath: s.keyPath })
        if ('index' in s) os.createIndex(s.index.name, s.index.keyPath)
      }
    }
    r.onsuccess = () => {
      r.result.onversionchange = () => { // another tab or the service worker (logout) is deleting the database
        r.result.close()
        opening = null
      }
      resolve(r.result)
    }
    r.onerror = () => { opening = null; reject(r.error) }
  })
  return opening
}

export const wrap = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })

/** Run `fn` in one transaction; resolves after commit. `fn` may only await IDB requests (via wrap). */
export async function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (os: (name: string) => IDBObjectStore) => Promise<T>): Promise<T> {
  const t = (await openDb()).transaction(stores, mode)
  const committed = new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error ?? new Error('transaction aborted'))
  })
  committed.catch(() => {}) // surfaced through the await below
  try {
    const out = await fn((n) => t.objectStore(n))
    await committed
    return out
  } catch (e) {
    try { t.abort() } catch { /* already finished */ }
    throw e
  }
}

export const getOne = <T>(store: string, key: IDBValidKey) => tx([store], 'readonly', (os) => wrap<T | undefined>(os(store).get(key)))
export const putOne = (store: string, value: unknown) => tx([store], 'readwrite', async (os) => { await wrap(os(store).put(value)) })
export const delOne = (store: string, key: IDBValidKey) => tx([store], 'readwrite', async (os) => { await wrap(os(store).delete(key)) })
export const getAll = <T>(store: string) => tx([store], 'readonly', (os) => wrap<T[]>(os(store).getAll()))

/** Delete the whole database (logout, revoked device, PIN reset). */
export async function deleteDatabase(): Promise<void> {
  if (opening) (await opening.catch(() => null))?.close()
  opening = null
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase(DB_NAME) // onblocked: other connections close on versionchange, then it completes
    r.onsuccess = () => resolve()
    r.onerror = () => reject(r.error)
  })
}
