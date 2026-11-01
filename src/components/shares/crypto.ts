// SMART-Health-Link-style envelope (FR-PAS-02): AES-256-GCM with a random 256-bit key generated in the browser.
// The key goes only into the URL fragment (`#…`), which browsers never send to a server. WebCrypto only.

export function toB64url(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Encrypts JSON with a fresh key. Returns the key (base64url, for the fragment) and what the server may store. */
export async function encryptJson(value: unknown): Promise<{ key: string; ciphertext: string; iv: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt'])
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value))))
  return { key: toB64url(raw), ciphertext: toB64url(ct), iv: toB64url(iv) }
}

/** Throws if the key is wrong or the ciphertext was altered (GCM tag). */
export async function decryptJson<T>(keyB64: string, ciphertext: string, iv: string): Promise<T> {
  const raw = fromB64url(keyB64)
  if (raw.length !== 32) throw new Error('bad key')
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt'])
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, key, fromB64url(ciphertext))
  return JSON.parse(new TextDecoder().decode(pt)) as T
}
