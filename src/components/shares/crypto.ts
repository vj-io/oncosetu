// SMART-Health-Link-style envelope (FR-PAS-02): AES-256-GCM with a random 256-bit key generated in the browser.
// The key goes only into the URL fragment (`#…`), which browsers never send to a server. WebCrypto only.
import { canonicalJson } from '@/core/canonical'

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

// ── payload signature (S2c) ──────────────────────────────────────────────────
// The server signs SHARE_SIG_CONTEXT + sha256hex(canonicalJson(payload without `sig`)) with the sealing key. A creator can
// put anything in the ciphertext, so only a valid signature makes the viewer trust labels, dates or verification chips.

/** Domain separation: a share signature can never pass as a snapshot seal (those sign canonical JSON starting with `{`). */
export const SHARE_SIG_CONTEXT = 'oncosetu.share-payload.v1:'
export type ShareSig = { signature: string; keyId: string }

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('')

/** SHA-256 (hex) of the canonical JSON of everything except `sig`. */
export async function payloadDigest(p: Record<string, unknown>): Promise<string> {
  const body = { ...p }
  delete body.sig
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(body))))
}

/**
 * true only for a valid OncoSetu signature. WebCrypto Ed25519 against GET /api/keys; where the browser lacks Ed25519,
 * the public verify endpoint is asked — with the digest only, so the decrypted record never leaves the browser.
 */
export async function verifySharePayload(p: Record<string, unknown>): Promise<boolean> {
  const sig = p.sig as Partial<ShareSig> | undefined
  if (typeof sig?.signature !== 'string' || typeof sig.keyId !== 'string') return false
  try {
    const digest = await payloadDigest(p)
    let key: CryptoKey | null = null
    try {
      const { keys } = (await (await fetch('/api/keys', { cache: 'no-store' })).json()) as { keys: { keyId: string; publicKeyRaw: string }[] }
      const k = keys.find((x) => x.keyId === sig.keyId)
      if (!k) return false
      key = await crypto.subtle.importKey('raw', fromB64url(k.publicKeyRaw), { name: 'Ed25519' }, false, ['verify'])
    } catch { /* no WebCrypto Ed25519 (or keys unreachable): server check below */ }
    if (key) return await crypto.subtle.verify({ name: 'Ed25519' }, key, fromB64url(sig.signature), new TextEncoder().encode(SHARE_SIG_CONTEXT + digest))
    const r = await fetch('/api/shares/verify-payload', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ digest, signature: sig.signature, keyId: sig.keyId }), cache: 'no-store',
    })
    return r.ok && (await r.json()).valid === true
  } catch {
    return false
  }
}
