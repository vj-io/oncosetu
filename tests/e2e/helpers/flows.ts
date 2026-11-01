// Multi-step flows shared by several specs: sealing, share links, crafted files, CSV.
import { encryptJson } from '../../../src/components/shares/crypto'
import type { Api } from './api'
import { BASE } from './env'

/** A PDF whose catalog runs JavaScript on open (E-DOC-05). Hand-written, so the test owns the exact bytes. */
export const javascriptPdf = () => Buffer.from([
  '%PDF-1.4',
  '1 0 obj<</Type/Catalog/Pages 2 0 R/OpenAction 4 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj',
  '4 0 obj<</S/JavaScript/JS(app.alert\\(1\\))>>endobj',
  'trailer<</Root 1 0 R>>',
  '%%EOF',
].join('\n'), 'latin1')

export type Sealed = { snapshotId: string; seq: number; sha256: string; signature: string; keyId: string; counts: { verified: number; unverified: number; documents: number; missing: number } }
export async function seal(clinician: Api, patientId: string): Promise<Sealed> {
  const r = await clinician.post(`/api/patients/${patientId}/seal`)
  if (!r.ok) throw new Error(`seal failed: ${r.status} ${JSON.stringify(r.body)}`)
  return r.body
}

export type ShareMade = { id: string; key: string; url: string; passcode: string | null; payload: any }
/** What CreateShareForm does: fetch the payload of the latest sealed snapshot, encrypt it here, upload ciphertext only. */
export async function createShare(api: Api, patientId: string, o: { passcode?: string | null; days?: number; scope?: 'index' | 'index_with_quotes' } = {}): Promise<ShareMade> {
  const scope = o.scope ?? 'index'
  const p = await api.get(`/api/patients/${patientId}/share-payload?scope=${scope}`)
  if (!p.ok) throw new Error(`share payload failed: ${p.status} ${JSON.stringify(p.body)}`)
  const { key, ciphertext, iv } = await encryptJson(p.body)
  const passcode = o.passcode === undefined ? '482915' : o.passcode
  const r = await api.post('/api/shares', { patientId, snapshotId: p.body.snapshotId, ciphertext, iv, scope, expiresInDays: o.days ?? 7, passcode })
  if (!r.ok) throw new Error(`share create failed: ${r.status} ${JSON.stringify(r.body)}`)
  return { id: r.body.id, key, url: `${BASE}/s/${r.body.id}#${key}`, passcode, payload: p.body }
}

/** RFC 4180 enough for our exports: quoted fields with doubled quotes, no embedded line breaks in ids. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0])
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}
