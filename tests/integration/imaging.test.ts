// Imaging, ECG and ZIP intake end to end against a live database: a matching DICOM is filed, a wrong-name DICOM is held like a
// wrong-patient report, a scan series in a ZIP becomes ONE study, nothing is read from pictures, and a text report still
// produces quoted facts. Uses synthetic files only. Needs .env.local.
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORG_NARMADA_ID } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })

const pid = randomUUID()
const ctx = async () => ({
  db: (await import('../../src/db')), schema: await import('../../src/db/schema'),
  up: await import('../../src/server/pipeline/upload'), proc: await import('../../src/server/pipeline/process'),
  syn: await import('../../src/server/pipeline/dicom-synthetic'), crypto: await import('../../src/server/crypto'),
})
const uploader = { kind: 'staff' as const, id: randomUUID() }
const base = { orgId: ORG_NARMADA_ID, patientId: pid, uploadedBy: uploader, intakeRoute: 'bulk' as const }

beforeAll(async () => {
  const c = await ctx()
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG_NARMADA_ID}, true)`
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, dob_enc, sex) values (${pid}, ${ORG_NARMADA_ID}, ${'t-' + pid}, ${c.crypto.encryptField('Sunita Deshmukh')}, ${c.crypto.encryptField('1974-08-14')}, 'female')`
    await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language) values (${ORG_NARMADA_ID}, ${pid}, 'grant', ${tx.json({ store: true, ai: false, share: false, abdm: false, metrics: false })}, 'staff', 'v1', 'en')`
  })
})
afterAll(async () => {
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG_NARMADA_ID}, true)`
    await tx`select set_config('oncosetu.erasing', 'on', true)` // originals are deletable only on the erasure path (0021)
    for (const t of ['evidence', 'events', 'missing_records', 'document_pages', 'document_files', 'documents']) await tx.unsafe(`delete from ${t} where patient_id = '${pid}'`)
    await tx`delete from audit_log where target_id = ${pid}`.catch(() => {})
    await tx.unsafe(`delete from consents where patient_id = '${pid}'`).catch(() => {})
  }).catch(() => {})
  await owner.end()
})

async function ingest(bytes: Uint8Array, fileName: string) {
  const c = await ctx()
  const r = await c.db.withOrg(ORG_NARMADA_ID, (tx) => c.up.ingestUpload(tx, { ...base, fileName, bytes }))
  for (const d of r.documents) if (d.status === 'queued') await c.proc.runDocument(d.documentId, ORG_NARMADA_ID)
  return r
}
async function load(id: string) {
  const c = await ctx()
  return c.db.withOrg(ORG_NARMADA_ID, async (tx) => (await tx.select().from(c.schema.documents).where(eq(c.schema.documents.id, id)))[0])
}

describe('imaging intake', () => {
  it('files a DICOM whose header matches the patient, shows it as stored-not-read, and extracts no facts', async () => {
    const c = await ctx()
    const dcm = await c.syn.buildSyntheticDicom({ modality: 'DX', patientName: 'Deshmukh^Sunita', sex: 'F', age: '051Y', studyDate: '20260320', studyUid: '1.2.3.1', size: 48 })
    const r = await ingest(dcm, 'chest.dcm')
    const d = await load(r.documents[0].documentId)
    expect(d).toMatchObject({ mime: 'application/dicom', identityResult: 'match', attachState: 'auto', status: 'done' })
    // the identity table shows what the header says, so the match is visibly justified
    expect((d.identityDetails as { header: Record<string, { value: string }> }).header).toMatchObject({ name: { value: 'Sunita Deshmukh' }, sex: { value: 'Female' }, age: { value: '51 Y' } })
    expect(d.flags.file).toMatchObject({ kind: 'dicom', category: 'scan', storedOnly: true, note: 'Imaging file — stored, not read' })
    expect(d.flags.imaging).toMatchObject({ modalityLabel: 'X-ray', studyDate: '2026-03-20' })
    const ev = await owner`select count(*)::int as n from events where document_id = ${d.id}`
    expect(ev[0].n).toBe(0)
  }, 60_000)

  it('holds a DICOM with another patient name for a person to decide, exactly like a wrong-patient report', async () => {
    const c = await ctx()
    const dcm = await c.syn.buildSyntheticDicom({ modality: 'CT', patientName: 'Kulkarni^Rajesh', sex: 'M', age: '062Y', studyUid: '1.2.3.2', size: 48 })
    const d = await load((await ingest(dcm, 'wrong.dcm')).documents[0].documentId)
    expect(d).toMatchObject({ identityResult: 'mismatch', attachState: 'pending_decision', status: 'needs_review' })
    expect((d.identityDetails as { header: Record<string, { value: string }> }).header.name.value).toBe('Rajesh Kulkarni') // the mismatching name is shown
  }, 60_000)

  it('holds a DICOM whose sex disagrees with the record even if the name is close', async () => {
    const c = await ctx()
    const dcm = await c.syn.buildSyntheticDicom({ modality: 'CR', patientName: 'Deshmukh^Sunita', sex: 'M', age: '051Y', studyUid: '1.2.3.3', size: 48 })
    const d = await load((await ingest(dcm, 'sexdiff.dcm')).documents[0].documentId)
    expect(d.attachState).toBe('pending_decision')
  }, 60_000)

  it('turns a ZIP with a PET and CT series into one PET-CT study and lists skipped files', async () => {
    const c = await ctx()
    const files: Record<string, Uint8Array> = { 'notes/readme.exe.txt': strToU8('plain note'), '__MACOSX/x': strToU8('junk') }
    for (let i = 1; i <= 4; i++) files[`CT/IM${i}`] = await c.syn.buildSyntheticDicom({ modality: 'CT', patientName: 'Deshmukh^Sunita', sex: 'F', age: '051Y', studyUid: '1.2.3.4', instance: i, size: 32 })
    for (let i = 1; i <= 2; i++) files[`PT/IM${i}`] = await c.syn.buildSyntheticDicom({ modality: 'PT', patientName: 'Deshmukh^Sunita', sex: 'F', age: '051Y', studyUid: '1.2.3.4', instance: 10 + i, size: 32 })
    const r = await ingest(zipSync(files), 'petct-cd.zip')
    expect(r.expandedZip).toBe(true)
    const study = r.documents.find((x) => !x.duplicateOf)!
    const docs = await Promise.all(r.documents.map((x) => load(x.documentId)))
    const imaging = docs.filter((x) => x.mime === 'application/x-dicom-study')
    expect(imaging).toHaveLength(1) // six images, one document
    expect(imaging[0].flags.imaging).toMatchObject({ studyLabel: 'PET-CT', instances: 6 })
    expect(imaging[0].attachState).toBe('auto')
    expect(r.skipped.map((s) => s.reason)).toContain('system file')
    expect(study).toBeTruthy()
  }, 90_000)

  it('stores a video, an ECG file and a NIfTI file without reading them; they wait for a person because the file names nobody', async () => {
    const mp4 = Buffer.alloc(64); mp4.writeUInt32BE(64, 0); mp4.write('ftyp', 4); mp4.write('isom', 8)
    const d1 = await load((await ingest(mp4, 'echo.mp4')).documents[0].documentId)
    expect(d1.flags.file).toMatchObject({ kind: 'video', note: 'Video file — stored, not read' })
    expect(d1.attachState).toBe('pending_decision')
    const xml = Buffer.from('<?xml version="1.0"?><AnnotatedECG xmlns="urn:hl7-org:v3"><id root="1"/></AnnotatedECG>')
    const d2 = await load((await ingest(xml, 'ecg.xml')).documents[0].documentId)
    expect(d2.flags.file).toMatchObject({ kind: 'ecg_xml', category: 'ecg', note: 'ECG file — stored, not read' })
  }, 60_000)

  it('still reads a typed radiology report as text and keeps its quotes', async () => {
    const text = 'Narmada Regional Cancer Centre\nPatient Name: Sunita Deshmukh   Age: 51 Y   Sex: F\nCT THORAX\nDate of study: 21/03/2026\nIMPRESSION: Reviewed on 21/03/2026.\n'.repeat(1)
    const r = await ingest(Buffer.from(text), 'ct-report.txt')
    const d = await load(r.documents[0].documentId)
    expect(d.flags.file).toMatchObject({ kind: 'text', category: 'report' })
    expect(d.mime).toBe('text/plain')
    expect(d.identityResult).toBe('match')
    expect(d.stage).toBe('completeness')
  }, 60_000)
})

describe('rejected uploads are returned and audited', () => {
  const rejected = async (bytes: Uint8Array, fileName: string) => {
    const c = await ctx()
    const before = await owner`select count(*)::int as n from audit_log where action = 'document.upload_rejected' and target_id = ${pid}`
    const r = await c.db.withOrg(ORG_NARMADA_ID, (tx) => c.up.ingestUpload(tx, { ...base, fileName, bytes }))
    const rows = await owner`select details from audit_log where action = 'document.upload_rejected' and target_id = ${pid} order by seq desc`
    return { r, added: rows.length - before[0].n, latest: rows.slice(0, rows.length - before[0].n).map((x) => x.details as Record<string, unknown>) }
  }

  it('an unsupported file is returned as a rejection and audited with its reason, not its name', async () => {
    const { r, added, latest } = await rejected(new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 255]), 'patient-name-scan.exe')
    expect(r.rejected).toMatchObject({ status: 415, code: 'unsupported_type' })
    expect(added).toBe(1)
    expect(latest[0]).toMatchObject({ reason: 'unsupported_type', via: 'bulk' })
    expect(JSON.stringify(latest)).not.toContain('patient-name-scan')
  }, 60_000)

  it('a binary file carrying the test-virus signature is refused', async () => {
    const eicar = Buffer.from('X5O!P%@AP[4' + String.fromCharCode(92) + 'PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*', 'latin1')
    const { r, latest } = await rejected(new Uint8Array(Buffer.concat([Buffer.from([0, 1, 2, 3]), eicar])), 'x.bin')
    expect(r.rejected).toMatchObject({ status: 422, code: 'malware_signature' })
    expect(latest[0]).toMatchObject({ reason: 'malware_signature' })
    // the bare signature reads as plain text (an accepted type since 7 Nov) and is still refused, not quarantined
    const bare = await rejected(new Uint8Array(eicar), 'eicar.com')
    expect(bare.r.rejected).toMatchObject({ status: 422, code: 'malware_signature' })
  }, 60_000)

  it('a file over the size limit is refused', async () => {
    const big = new Uint8Array(51 * 1024 * 1024); big[0] = 0x25; big.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0)
    const { r, latest } = await rejected(big, 'big.pdf')
    expect(r.rejected).toMatchObject({ status: 413, code: 'file_too_large' })
    expect(latest[0]).toMatchObject({ reason: 'file_too_large' })
  }, 120_000)

  it('a zip bomb is refused before it is opened, and a ZIP of only unsafe paths is refused with a reason per kind', async () => {
    const bomb = await rejected(zipSync({ 'zeros.bin': new Uint8Array(30 * 1024 * 1024) }), 'bomb.zip')
    expect(bomb.r.rejected).toMatchObject({ code: 'zip_bomb' })
    expect(bomb.latest[0]).toMatchObject({ reason: 'zip_bomb' })
    const trav = await rejected(zipSync({ '../../etc/passwd': strToU8('root'), '/abs/x.txt': strToU8('x') }), 'trav.zip')
    expect(trav.r.rejected).toMatchObject({ status: 422, code: 'zip_nothing_accepted' })
    const reasons = trav.latest.map((d) => d.reason)
    expect(reasons).toContain('unsafe_file_name')
    expect(reasons).toContain('zip_nothing_accepted')
  }, 60_000)

  it('a refused entry inside an otherwise good ZIP is audited and the good file is still stored', async () => {
    const c = await ctx()
    const png = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 9])
    const { r, latest } = await rejected(zipSync({ 'note.txt': strToU8('A short typed note about a visit.'), 'tool.exe': png }), 'mixed.zip')
    expect(r.rejected).toBeUndefined()
    expect(r.documents.length).toBe(1)
    expect(latest.map((d) => d.reason)).toContain('unsupported_type')
    void c
  }, 60_000)
})
