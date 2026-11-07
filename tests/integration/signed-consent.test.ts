// Signed consent forms against a live database: the signed record, the stored PDF document, the guardian rule for a minor,
// and what the erasure trigger blanks. Synthetic data only.
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORG_GANGA_ID, ORG_NARMADA_ID } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const adult = randomUUID(), minor = randomUUID()
const imp = async () => ({ db: await import('../../src/db'), sign: await import('../../src/server/privacy/sign'), crypto: await import('../../src/server/crypto') })
const ALL = { store: true, ai: false, share: true, abdm: false, metrics: false, team: true }
const NONE = { store: false, ai: false, share: false, abdm: false, metrics: false, team: false }

beforeAll(async () => {
  const c = await imp()
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG_NARMADA_ID}, true)`
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, minor) values (${adult}, ${ORG_NARMADA_ID}, ${'t-' + adult}, ${c.crypto.encryptField('Meena Test')}, false)`
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, minor) values (${minor}, ${ORG_NARMADA_ID}, ${'t-' + minor}, ${c.crypto.encryptField('Aarav Test')}, true)`
  })
})
afterAll(async () => {
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG_NARMADA_ID}, true)`
    for (const id of [adult, minor]) for (const t of ['signed_consents', 'document_files', 'documents', 'consents']) await tx.unsafe(`delete from ${t} where patient_id = '${id}'`).catch(() => {})
  }).catch(() => {})
  await owner.end()
})

const run = async <T>(fn: (tx: import('../../src/db').Tx) => Promise<T>) => (await imp()).db.withOrg(ORG_NARMADA_ID, fn)
const input = (patientId: string, over: object = {}) => ({
  orgId: ORG_NARMADA_ID, patientId, relation: 'self' as const, signerName: 'Meena Test', method: 'typed' as const, withdraw: false, purposes: ALL, lang: 'en' as const,
  actor: { kind: 'patient' as const, id: patientId }, recordChoices: true, ...over,
})

describe('signed consent', () => {
  it('records the consent, keeps a signed PDF with the documents and lists it', async () => {
    const { sign } = await imp()
    const r = await run((tx) => sign.createSignedConsent(tx, input(adult)))
    expect(Buffer.from(r.pdf.slice(0, 5)).toString()).toBe('%PDF-')
    const list = await run((tx) => sign.listSignedConsents(tx, adult))
    expect(list[0]).toMatchObject({ action: 'grant', signer: 'Meena Test', relation: 'self', method: 'typed', formVersion: 'consent-form-draft-v1' })
    const doc = (await owner`select flags, status, attach_state, mime from documents where id = ${r.documentId}`)[0]
    expect(doc).toMatchObject({ status: 'done', attach_state: 'attached', mime: 'application/pdf' })
    expect(doc.flags.file.note).toMatch(/Signed consent form/)
    const consent = (await owner`select action, purposes from consents where patient_id = ${adult} order by recorded_at desc limit 1`)[0]
    expect(consent.action).toBe('grant')
    expect(consent.purposes.team).toBe(true)
    const pdf = await run((tx) => sign.readSignedPdf(tx, adult, r.id))
    expect(pdf?.length).toBe(r.pdf.length)
  }, 60_000)

  it('a signed withdrawal records the withdrawal and its own PDF', async () => {
    const { sign } = await imp()
    const r = await run((tx) => sign.createSignedConsent(tx, input(adult, { withdraw: true, purposes: NONE })))
    const consent = (await owner`select action from consents where patient_id = ${adult} order by recorded_at desc limit 1`)[0]
    expect(consent.action).toBe('withdraw')
    const list = await run((tx) => sign.listSignedConsents(tx, adult))
    expect(list.map((x) => x.action)).toEqual(['withdraw', 'grant'])
    expect(r.documentId).toBeTruthy()
  }, 60_000)

  it('a minor must be signed for by a guardian; a witnessed desk signature keeps the witness', async () => {
    const { sign } = await imp()
    await expect(run((tx) => sign.createSignedConsent(tx, input(minor, { relation: 'self' })))).rejects.toMatchObject({ status: 422, code: 'guardian_required' })
    const [s] = await owner`select id from staff where org_id = ${ORG_NARMADA_ID} and role = 'desk' limit 1`
    await run(async (tx) => { await sign.createSignedConsent(tx, input(minor, { relation: 'guardian', signerName: 'Pooja Test', actor: { kind: 'caregiver', id: minor } })) })
    const r = await run((tx) => sign.createSignedConsent(tx, input(minor, { relation: 'guardian', signerName: 'Pooja Test', recordChoices: false, witness: { staffId: s.id, name: 'Asha Pawar' }, actor: { kind: 'caregiver', id: minor } })))
    const row = (await owner`select witness_staff_id, signer_relation from signed_consents where id = ${r.id}`)[0]
    expect(row).toMatchObject({ witness_staff_id: s.id, signer_relation: 'guardian' })
  }, 60_000)

  it('refuses a drawn signature with no drawing, and is invisible to another organisation', async () => {
    const { sign, db } = await imp()
    await expect(run((tx) => sign.createSignedConsent(tx, input(adult, { method: 'drawn', signaturePng: null })))).rejects.toMatchObject({ status: 400 })
    const other = await db.withOrg(ORG_GANGA_ID, (tx) => sign.listSignedConsents(tx, adult))
    expect(other).toEqual([])
  }, 60_000)

  it('erasing the patient blanks the signer name but keeps the record of the signing', async () => {
    await owner.begin(async (tx) => {
      await tx`select set_config('app.org_id', ${ORG_NARMADA_ID}, true)`
      await tx`update patients set status = 'erased' where id = ${adult}`
      const rows = await tx`select signer_name_enc, document_id, form_version from signed_consents where patient_id = ${adult}`
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((x) => x.signer_name_enc === null && x.document_id === null && x.form_version === 'consent-form-draft-v1')).toBe(true)
      throw new Error('rollback')
    }).catch((e) => { if (e.message !== 'rollback') throw e })
  })
})

describe('desk consent keeps the team purpose', () => {
  it('a desk update without the team purpose does not reset it; a withdrawal clears it', async () => {
    const { db } = await imp()
    const { insertConsent } = await import('../../src/server/registration/consent')
    const [s] = await owner`select id from staff where org_id = ${ORG_NARMADA_ID} and role = 'desk' limit 1`
    const row = (action: 'grant' | 'update' | 'withdraw', purposes: object) => db.withOrg(ORG_NARMADA_ID, (tx) => insertConsent(tx, { orgId: ORG_NARMADA_ID, patientId: minor, action, purposes: purposes as never, actorType: 'staff', actorId: s.id, method: 'desk_assisted', witnessedBy: s.id, noticeVersion: 'v1', language: 'en' }))
    await row('grant', { store: true, ai: false, share: false, abdm: false, metrics: false, team: true })
    await row('update', { store: true, ai: true, share: false, abdm: false, metrics: false }) // the desk form has no team switch
    const last = async () => (await owner`select purposes from consents where patient_id = ${minor} order by recorded_at desc, id desc limit 1`)[0].purposes
    expect((await last()).team).toBe(true)
    await row('withdraw', { store: false, ai: false, share: false, abdm: false, metrics: false })
    expect((await last()).team).toBe(false)
  })
})
