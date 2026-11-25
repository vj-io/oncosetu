// Opening a scan or a paper writes one `document.view` row per viewer, per document, per 30 minutes, not one per image.
// Calls the real file and preview route handlers against the live database; only the sign-in is stubbed. Synthetic data only.
// Needs .env.local.
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ORG_NARMADA_ID } from '../../src/server/demo'
import type { Session } from '../../src/server/session'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })

let viewer: Session | null = null
vi.mock('@/server/session', async (orig) => ({ ...(await orig<typeof import('../../src/server/session')>()), getSession: async () => viewer }))

const ORG = ORG_NARMADA_ID
const pid = randomUUID()
const FRAMES = 8
const PAGES = 3
let scanId = '', otherId = ''

const staff = (role: 'records' | 'clinician' = 'clinician'): Session => ({
  kind: 'staff', sessionId: randomUUID(), staffId: randomUUID(), role, orgId: ORG, orgName: 'Test', staffName: 'Test viewer', email: 'viewer@example.test',
})
const actorOf = (s: Session) => (s.kind === 'staff' ? s.staffId : s.patientId)

async function get(s: Session, path: 'preview' | 'file', query: string, id = scanId) {
  viewer = s
  const mod = path === 'preview' ? await import('../../src/app/api/documents/[id]/preview/route') : await import('../../src/app/api/documents/[id]/file/route')
  const res = await mod.GET(new NextRequest(`http://localhost/api/documents/${id}/${path}?${query}`), { params: Promise.resolve({ id }) })
  const body = new Uint8Array(await res.arrayBuffer())
  expect(res.status, `${path}?${query}`).toBe(200) // positive control: the route served the picture, so it reached the audit line
  expect(body.length).toBeGreaterThan(0)
  return res
}
const rowsBy = async (s: Session, id = scanId) =>
  (await owner`select details from audit_log where org_id = ${ORG} and action = 'document.view' and target_id = ${id} and actor_id = ${actorOf(s)} order by seq`)
    .map((r) => r.details as Record<string, unknown>)

beforeAll(async () => {
  const crypto = await import('../../src/server/crypto')
  const { withOrg } = await import('../../src/db')
  const up = await import('../../src/server/pipeline/upload')
  const proc = await import('../../src/server/pipeline/process')
  const syn = await import('../../src/server/pipeline/dicom-synthetic')
  const { storeFile } = await import('../../src/server/files')
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, dob_enc, sex) values (${pid}, ${ORG}, ${'t-' + pid}, ${crypto.encryptField('Asha Testcase')}, ${crypto.encryptField('1970-01-01')}, 'female')`
    await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language) values (${ORG}, ${pid}, 'grant', ${tx.json({ store: true, ai: false, share: false, abdm: false, metrics: false })}, 'staff', 'v1', 'en')`
  })
  const dcm = await syn.buildSyntheticDicom({ modality: 'CT', patientName: 'Testcase^Asha', sex: 'F', age: '056Y', studyUid: `1.2.826.0.1.${Date.now()}`, size: 32, frames: FRAMES })
  const r = await withOrg(ORG, (tx) => up.ingestUpload(tx, { orgId: ORG, patientId: pid, uploadedBy: { kind: 'staff', id: randomUUID() }, intakeRoute: 'bulk', fileName: 'ct.dcm', bytes: dcm }))
  scanId = r.documents[0].documentId
  if (r.documents[0].status === 'queued') await proc.runDocument(scanId, ORG)
  const one = await syn.buildSyntheticDicom({ modality: 'DX', patientName: 'Testcase^Asha', sex: 'F', age: '056Y', studyUid: `1.2.826.0.2.${Date.now()}`, size: 32 })
  const r2 = await withOrg(ORG, (tx) => up.ingestUpload(tx, { orgId: ORG, patientId: pid, uploadedBy: { kind: 'staff', id: randomUUID() }, intakeRoute: 'bulk', fileName: 'dx.dcm', bytes: one }))
  otherId = r2.documents[0].documentId
  if (r2.documents[0].status === 'queued') await proc.runDocument(otherId, ORG)
  // Page pictures on the same document, as a photographed paper has them; the file route serves any document's pages.
  const png = Buffer.from(await syn.syntheticPicture('CT', 32))
  await withOrg(ORG, async (tx) => {
    for (let n = 1; n <= PAGES; n++) await storeFile(tx, { orgId: ORG, patientId: pid, documentId: scanId, kind: 'page_image', pageNo: n, mime: 'image/png', bytes: png })
  })
}, 120_000)

afterEach(() => { vi.useRealTimers() })

afterAll(async () => {
  // Audit rows stay: the log is append-only and hash-chained. Only the synthetic patient's documents go.
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`
    await tx`select set_config('oncosetu.erasing', 'on', true)`
    for (const t of ['evidence', 'events', 'missing_records', 'document_pages', 'document_files', 'documents']) await tx.unsafe(`delete from ${t} where patient_id = '${pid}'`)
    await tx.unsafe(`delete from consents where patient_id = '${pid}'`).catch(() => {})
  }).catch(() => {})
  await owner.end()
})

describe('one audit row per viewing', () => {
  it(`stepping through ${FRAMES} images of a scan writes one row`, async () => {
    const a = staff()
    for (let f = 0; f < FRAMES; f++) await get(a, 'preview', `frame=${f}`)
    await get(a, 'preview', 'frame=2&window=lung') // a window change is the same viewing
    const rows = await rowsBy(a)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'preview', frame: 0 }) // the first image opened
  })

  it(`${PAGES} page pictures loaded at once (as a paper preview does) write one row`, async () => {
    const a = staff('records')
    await Promise.all(Array.from({ length: PAGES }, (_, i) => get(a, 'file', `kind=page&page=${i + 1}`)))
    await get(a, 'preview', 'frame=1') // the same viewer, the same document, a different picture route: still the same viewing
    expect(await rowsBy(a)).toHaveLength(1)
  })

  it('a second viewer of the same scan adds exactly one row', async () => {
    const a = staff(), b = staff()
    for (let f = 0; f < 3; f++) await get(a, 'preview', `frame=${f}`)
    for (let f = 0; f < 3; f++) await get(b, 'preview', `frame=${f}`)
    expect(await rowsBy(a)).toHaveLength(1)
    expect(await rowsBy(b)).toHaveLength(1)
  })

  it('a reopen after 30 minutes is a new viewing; one inside 30 minutes is not', async () => {
    const real = Date.now()
    const before = staff(), within = staff()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(real - 31 * 60_000)
    await get(before, 'preview', 'frame=0')
    vi.setSystemTime(real - 29 * 60_000)
    await get(within, 'preview', 'frame=0')
    vi.useRealTimers()
    await get(before, 'preview', 'frame=1')
    await get(within, 'preview', 'frame=1')
    expect(await rowsBy(before)).toHaveLength(2)
    expect(await rowsBy(within)).toHaveLength(1)
  })

  it('the same viewer opening another document gets a row for that one too', async () => {
    const a = staff()
    await get(a, 'preview', 'frame=0')
    await get(a, 'preview', '', otherId)
    await get(a, 'preview', 'frame=1')
    expect(await rowsBy(a)).toHaveLength(1)
    expect(await rowsBy(a, otherId)).toHaveLength(1)
  })

  it('another action by the same person on the document does not stand in for a viewing', async () => {
    const a = staff()
    const { withOrg } = await import('../../src/db')
    const { writeAudit } = await import('../../src/server/audit')
    await withOrg(ORG, (tx) => writeAudit(tx, { orgId: ORG, actorId: actorOf(a), actorRole: 'clinician', action: 'document.tags', targetType: 'document', targetId: scanId, details: { docType: 'imaging' } }))
    await get(a, 'preview', 'frame=0')
    expect(await rowsBy(a)).toHaveLength(1)
  })

  it('opening or downloading the original is audited every time', async () => {
    const a = staff('records')
    await get(a, 'file', 'kind=page&page=1')
    for (let k = 0; k < 3; k++) await get(a, 'file', 'kind=original')
    const rows = await rowsBy(a)
    expect(rows.map((r) => r.kind)).toEqual(['page', 'original', 'original', 'original'])
  })

  it('five parallel writes of one viewing, each in its own transaction, give one row (the check runs under the lock)', async () => {
    const a = staff()
    const { withOrg } = await import('../../src/db')
    const { writeAudit, VIEWING_MS } = await import('../../src/server/audit')
    const view = { orgId: ORG, actorId: actorOf(a), actorRole: 'clinician', action: 'document.view', targetType: 'document', targetId: scanId, details: { kind: 'page', page: 1 } }
    const out = await Promise.all(Array.from({ length: 5 }, () => withOrg(ORG, (tx) => writeAudit(tx, view, { onceWithinMs: VIEWING_MS }))))
    expect(out.filter(Boolean)).toHaveLength(1)
    expect(await rowsBy(a)).toHaveLength(1)
  })

  it('the hash chain is intact after all of the above', async () => {
    const { verifyAuditChain } = await import('../../src/server/audit')
    expect(await verifyAuditChain(ORG)).toMatchObject({ ok: true })
  })
})
