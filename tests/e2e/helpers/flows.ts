// Multi-step flows shared by several specs: sealing, share links, crafted files, CSV.
import { PDFDocument, PDFName } from 'pdf-lib'
import { encryptJson } from '../../../src/components/shares/crypto'
import type { Api } from './api'
import { setClockDays } from './db'
import { BASE } from './env'

/** JavaScript in a hand-written file no PDF parser can rebuild (no catalog): it cannot be sanitised, so it is quarantined (E-DOC-05, FR-ING-08). */
export const unparseableJavascriptPdf = () => Buffer.from('%PDF-1.4\n1 0 obj<</S/JavaScript/JS(app.alert\\(1\\))>>endobj\n%%EOF', 'latin1')

/** A real report with JavaScript on open, a document-level script and an embedded file added (FR-ING-08). */
export async function withActiveContent(pdf: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf)
  doc.addJavaScript('boot', 'app.alert(1)')
  await doc.attach(Buffer.from('MZ synthetic payload'), 'payload.exe', { mimeType: 'application/octet-stream' })
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 'JavaScript', JS: 'app.alert(2)' }))
  return Buffer.from(await doc.save({ useObjectStreams: false }))
}

export type Sealed = { snapshotId: string; seq: number; sha256: string; signature: string; keyId: string; counts: { verified: number; unverified: number; documents: number; missing: number } }
export async function seal(clinician: Api, patientId: string): Promise<Sealed> {
  const r = await clinician.post(`/api/patients/${patientId}/seal`)
  if (!r.ok) throw new Error(`seal failed: ${r.status} ${JSON.stringify(r.body)}`)
  return r.body
}

export type ShareMade = { id: string; key: string; url: string; passcode: string | null; payload: any; expiresAt: string }
/** What CreateShareForm does: fetch the payload of the latest sealed snapshot, encrypt it here, upload ciphertext only. */
export async function createShare(api: Api, patientId: string, o: { passcode?: string | null; days?: number; scope?: 'index' | 'index_with_quotes'; actor?: 'staff' | 'patient' } = {}): Promise<ShareMade> {
  const scope = o.scope ?? 'index'
  const patient = o.actor === 'patient' // a patient or caregiver session: their own record, no patientId in the request
  const p = await api.get(patient ? `/api/p/share-payload?scope=${scope}` : `/api/patients/${patientId}/share-payload?scope=${scope}`)
  if (!p.ok) throw new Error(`share payload failed: ${p.status} ${JSON.stringify(p.body)}`)
  const { key, ciphertext, iv } = await encryptJson(p.body)
  const passcode = o.passcode === undefined ? '482915' : o.passcode
  const r = await api.post('/api/shares', { ...(patient ? {} : { patientId }), snapshotId: p.body.snapshotId, ciphertext, iv, scope, expiresInDays: o.days ?? 7, passcode })
  if (!r.ok) throw new Error(`share create failed: ${r.status} ${JSON.stringify(r.body)}`)
  return { id: r.body.id, key, url: `${BASE}/s/${r.body.id}#${key}`, passcode, payload: p.body, expiresAt: r.body.expiresAt }
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

/** Runs `fn` with the org clock moved by `days` and always puts it back (callers run in the serial `clock` project). */
export async function withClock<T>(days: number, fn: () => Promise<T>): Promise<T> {
  await setClockDays(days)
  try { return await fn() } finally { await setClockDays(0) }
}
