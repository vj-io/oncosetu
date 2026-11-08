// Runs the real synthetic sample files in public/demo-docs through intake and the pipeline, for two synthetic patients.
// Proves every sample is recognised and labelled, imaging is never read, the wrong-name scan is held, text reports still
// give quoted facts, and a PET-CT report is proposed for the PET-CT checklist item (a person then confirms it).
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORG_NARMADA_ID } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const DOCS = 'public/demo-docs'
const sunita = randomUUID(), khan = randomUUID()
const imp = async () => ({ db: await import('../../src/db'), s: await import('../../src/db/schema'), up: await import('../../src/server/pipeline/upload'), proc: await import('../../src/server/pipeline/process'), crypto: await import('../../src/server/crypto'), radar: await import('../../src/server/pipeline/radar') })

beforeAll(async () => {
  const c = await imp()
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG_NARMADA_ID}, true)`
    for (const [id, name, dob, sex] of [[sunita, 'Sunita Deshmukh', '1974-08-14', 'female'], [khan, 'Mohd. Abdul Rahim Khan', '1962-01-02', 'male']] as const) {
      await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, dob_enc, sex, disclosure_status) values (${id}, ${ORG_NARMADA_ID}, ${'t-' + id}, ${c.crypto.encryptField(name)}, ${c.crypto.encryptField(dob)}, ${sex}, 'cleared')`
      await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language) values (${ORG_NARMADA_ID}, ${id}, 'grant', ${tx.json({ store: true, ai: false, share: false, abdm: false, metrics: false })}, 'staff', 'v1', 'en')`
    }
  })
})
afterAll(async () => {
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG_NARMADA_ID}, true)`
    await tx`select set_config('oncosetu.erasing', 'on', true)` // originals are deletable only on the erasure path (0021)
    for (const id of [sunita, khan]) for (const t of ['evidence', 'events', 'missing_records', 'document_pages', 'document_files', 'documents', 'consents']) await tx.unsafe(`delete from ${t} where patient_id = '${id}'`).catch(() => {})
  }).catch(() => {})
  await owner.end()
})

async function run(patientId: string, file: string) {
  const c = await imp()
  const r = await c.db.withOrg(ORG_NARMADA_ID, (tx) => c.up.ingestUpload(tx, { orgId: ORG_NARMADA_ID, patientId, uploadedBy: { kind: 'staff', id: randomUUID() }, intakeRoute: 'bulk', fileName: file, bytes: new Uint8Array(readFileSync(`${DOCS}/${file}`)) }))
  for (const d of r.documents) if (d.status === 'queued') await c.proc.runDocument(d.documentId, ORG_NARMADA_ID)
  const docs = await c.db.withOrg(ORG_NARMADA_ID, async (tx) => Promise.all(r.documents.map(async (d) => (await tx.select().from(c.s.documents).where(eq(c.s.documents.id, d.documentId)))[0])))
  return { r, docs }
}

describe('demo sample files', () => {
  it('Sunita: chest X-ray matches and is stored not read; the wrong-name X-ray is held; the mammogram (RLE) previews', async () => {
    const ok = (await run(sunita, 'hero__12-chest-xray.dcm')).docs[0]
    expect(ok).toMatchObject({ identityResult: 'match', attachState: 'auto', status: 'done' })
    expect(ok.flags.file).toMatchObject({ note: 'Imaging file — stored, not read', category: 'scan' })
    const held = (await run(sunita, 'hero__13-xray-wrong-patient.dcm')).docs[0]
    expect(held).toMatchObject({ identityResult: 'mismatch', attachState: 'pending_decision', status: 'needs_review' })
    const mg = (await run(sunita, 'hero__14-mammogram.dcm')).docs[0]
    expect(mg.attachState).toBe('auto')
    const { renderDicomFrame } = await import('../../src/server/pipeline/dicom')
    expect(await renderDicomFrame(new Uint8Array(readFileSync(`${DOCS}/hero__14-mammogram.dcm`)))).toMatchObject({ ok: true })
  }, 120_000)

  it('Sunita: film photo, HEIC photo, two-page TIFF and Word report are all accepted and labelled', async () => {
    const photo = (await run(sunita, 'hero__15-xray-film-photo.jpg')).docs[0]
    expect(photo.flags.file).toMatchObject({ category: 'photo' })
    const heic = (await run(sunita, 'hero__16-report-photo.heic')).docs[0]
    expect(heic.flags.file).toMatchObject({ kind: 'heic' })
    expect(heic).toMatchObject({ identityResult: 'match', attachState: 'auto' }) // age and date of birth are readable, so it is filed, not held
    expect((await owner`select count(*)::int as n from events where document_id = ${heic.id}`)[0].n).toBeGreaterThan(0)
    const tiff = (await run(sunita, 'hero__17-scan-2-pages.tiff')).docs[0]
    expect(tiff.mime).toBe('image/tiff')
    expect(tiff.pages).toBe(2) // both pages are read
    expect(tiff).toMatchObject({ identityResult: 'match', attachState: 'auto' })
    expect((await owner`select count(*)::int as n from document_pages where document_id = ${tiff.id} and length(text) > 40`)[0].n).toBe(2)
    expect((await owner`select count(*)::int as n from events where document_id = ${tiff.id}`)[0].n).toBeGreaterThan(0)
    const dx = (await run(sunita, 'hero__18-chest-xray-report.docx')).docs[0]
    expect(dx.flags.file).toMatchObject({ kind: 'docx', category: 'report' })
    expect(dx.identityResult).toBe('match')
    const facts = await owner`select count(*)::int as n from events where document_id = ${dx.id}`
    expect(facts[0].n).toBeGreaterThan(0) // a typed report still gives facts, each with a quote
    const ev = await owner`select count(*)::int as n from evidence where document_id = ${dx.id} and quote is not null`
    expect(ev[0].n).toBeGreaterThan(0)
  }, 240_000)

  it('Khan: CT series and PET-CT ZIPs each become ONE study; MRI, ultrasound, bone scan, ECG, aECG and the clip are stored not read', async () => {
    const ct = await run(khan, 'returning__08-ct-chest-series.zip')
    expect(ct.docs.filter((d) => d.mime === 'application/x-dicom-study')).toHaveLength(1)
    expect(ct.docs[0].flags.imaging).toMatchObject({ instances: 12, studyLabel: 'CT scan' })
    expect(ct.r.skipped.some((s) => /DICOMDIR/.test(s.reason))).toBe(true)
    const pet = await run(khan, 'returning__09-petct-study.zip')
    expect(pet.docs).toHaveLength(1)
    expect(pet.docs[0].flags.imaging).toMatchObject({ instances: 16, studyLabel: 'PET-CT' })
    expect(pet.docs[0].attachState).toBe('auto')
    const label = async (f: string) => (await run(khan, f)).docs[0].flags.imaging as { modalityLabel: string; frames: number }
    expect(await label('returning__10-mri-brain.dcm')).toMatchObject({ modalityLabel: 'MRI', frames: 9 })
    expect(await label('returning__11-ultrasound-cine.dcm')).toMatchObject({ modalityLabel: 'Ultrasound', frames: 16 })
    expect((await label('returning__12-bone-scan.dcm')).modalityLabel).toMatch(/Bone scan/)
    const ecg = (await run(khan, 'returning__13-ecg-waveform.dcm')).docs[0]
    expect(ecg.flags.file).toMatchObject({ category: 'ecg', note: 'ECG file — stored, not read' })
    const { renderDicomFrame } = await import('../../src/server/pipeline/dicom')
    expect(await renderDicomFrame(new Uint8Array(readFileSync(`${DOCS}/returning__13-ecg-waveform.dcm`)))).toMatchObject({ ok: true }) // a trace, drawn
    expect((await run(khan, 'returning__14-ecg-aecg.xml')).docs[0].flags.file).toMatchObject({ kind: 'ecg_xml' })
    if (existsSync(`${DOCS}/returning__16-ultrasound-clip.mp4`)) expect((await run(khan, 'returning__16-ultrasound-clip.mp4')).docs[0].flags.file).toMatchObject({ kind: 'video', note: 'Video file — stored, not read' })
  }, 240_000)

  it('Khan: the PET-CT report is read as an imaging report and proposed for the PET-CT checklist item, which a person then closes', async () => {
    const c = await imp()
    await c.db.withOrg(ORG_NARMADA_ID, async (tx) => {
      await tx.insert(c.s.events).values({
        orgId: ORG_NARMADA_ID, patientId: khan, eventType: 'patient_statement', fields: { scan_name: 'PET-CT', institution_name: 'City Care Hospital' }, eventDate: '2026-04-28', datePrecision: 'month',
        receivedAt: new Date(), sourceType: 'patient_reported', createdByKind: 'patient', extractionMethod: 'structured_map',
      } as never)
      await c.radar.recomputeRadar(tx, ORG_NARMADA_ID, khan)
    })
    const before = await owner`select state from missing_records where patient_id = ${khan} and rule_id = 'RAD-IMG-PT-01'`
    expect(before.length).toBe(1)
    const rep = (await run(khan, 'returning__15-petct-report.pdf')).docs[0]
    expect(rep.docType).toBe('imaging_report')
    expect(rep.identityResult).toBe('match')
    await c.db.withOrg(ORG_NARMADA_ID, (tx) => c.radar.recomputeRadar(tx, ORG_NARMADA_ID, khan))
    const row = (await owner`select state, proposed_document_id from missing_records where patient_id = ${khan} and rule_id = 'RAD-IMG-PT-01'`)[0]
    expect(row.state).toBe('received') // proposed, not auto-closed
    expect(row.proposed_document_id).toBe(rep.id)
  }, 240_000)
})
