// J6 / FR-ING-ABDM-01/02 against the live DB in the Ganga org, through the server flow (src/server/abdm/flow.ts) with the
// in-process gateway: consent refusals, approve → events/evidence/Radar, a tampered push writes nothing, revoke and
// erase-at erase everything ABDM brought in, and abdm_erase() (drizzle/0009) enforces its own preconditions.
//   npm run test:integration   (needs .env.local)
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import postgres, { type TransactionSql } from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, withOrg } from '../../src/db'
import { abdmConsentRequests, abdmTransfers, auditLog, documentFiles, documents, events, evidence, missingRecords } from '../../src/db/schema'
import { ephemeral } from '../../src/server/abdm/crypto'
import { createConsentRequest, decideConsentRequest, eraseDue, receiveDataPush, revokeConsentRequest, storedArtefact, type FlowCtx } from '../../src/server/abdm/flow'
import { abdmTransport, InProcessGateway } from '../../src/server/abdm/transport'
import { writeAudit } from '../../src/server/audit'
import { encryptField } from '../../src/server/crypto'
import { ORG_GANGA_ID as ORG, ORG_NARMADA_ID } from '../../src/server/demo'
import { abhaHmac } from '../../src/server/registration/duplicates'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')

const app = postgres(process.env.DATABASE_URL_APP!, { max: 1, prepare: false, onnotice: () => {} })
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
afterAll(async () => { await app.end(); await owner.end(); await closeDb() })

const HERO_ABHA = '00111122220001'
const RANGE = { from: '2025-01-01', to: '2026-10-31' }
const ALL = ['DiagnosticReport', 'DischargeSummary', 'OPConsultation', 'Prescription'] as const

async function seedPatient(purposes: { abdm: boolean }, abha: string | null = HERO_ABHA): Promise<string> {
  const id = randomUUID()
  const r = randomUUID().replace(/-/g, '')
  await app.begin(async (tx: TransactionSql) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, abha_number_enc, abha_hmac, sex)
      values (${id}, ${ORG}, ${'t-' + r}, ${encryptField('Sunita Deshmukh')}, ${abha ? encryptField(abha) : null}, ${abha ? abhaHmac(abha) : null}, 'female')`
    await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language)
      values (${ORG}, ${id}, 'grant', ${tx.json({ store: true, ai: false, share: false, abdm: purposes.abdm, metrics: false })}, 'staff', 'test', 'en')`
  })
  return id
}
const staffId = async () => (await app`select id from staff where email = 'records@ganga.test'`)[0].id as string
const flow = <T>(actor: { id: string; role: string }, fn: (c: FlowCtx) => Promise<T>) => withOrg(ORG, (db) => fn({
  db, orgId: ORG, audit: async (action, targetType, targetId, details) => { await writeAudit(db, { orgId: ORG, actorId: actor.id, actorRole: actor.role, action, targetType, targetId, details }) },
}))
const rowsOf = (patientId: string) => withOrg(ORG, async (db) => ({
  docs: await db.select().from(documents).where(eq(documents.patientId, patientId)),
  events: await db.select().from(events).where(eq(events.patientId, patientId)),
  evidence: await db.select().from(evidence).where(eq(evidence.patientId, patientId)),
  files: await db.select({ id: documentFiles.id }).from(documentFiles).where(eq(documentFiles.patientId, patientId)),
  missing: await db.select().from(missingRecords).where(eq(missingRecords.patientId, patientId)),
  requests: await db.select().from(abdmConsentRequests).where(eq(abdmConsentRequests.patientId, patientId)),
  transfers: await db.select().from(abdmTransfers).where(eq(abdmTransfers.patientId, patientId)),
}))
const request = async (patientId: string, hiTypes: readonly string[] = ALL) => {
  const sid = await staffId()
  return flow({ id: sid, role: 'records' }, (c) => createConsentRequest({ ...c, staffId: sid, origin: null }, patientId, { hiTypes: [...hiTypes] as never, ...RANGE }))
}
const asPatient = (patientId: string) => ({ id: patientId, role: 'patient' })

describe('ABDM HIU flow (in-process gateway)', { timeout: 120_000 }, () => {
  it('refuses a request without the abdm consent purpose, or without an ABHA number', async () => {
    const noPurpose = await seedPatient({ abdm: false })
    await expect(request(noPurpose)).rejects.toMatchObject({ status: 403, code: 'consent_required' })
    const noAbha = await seedPatient({ abdm: true }, null)
    await expect(request(noAbha)).rejects.toMatchObject({ status: 409, code: 'abha_missing' })
    expect((await rowsOf(noPurpose)).requests).toEqual([])
  })

  it('approve → structured events with FHIR evidence, Radar recomputed; revoke → everything ABDM brought in is erased', async () => {
    const pid = await seedPatient({ abdm: true })
    const req = await request(pid)
    expect(req).toMatchObject({ state: 'REQUESTED', transport: 'in_process' })
    const r = await flow(asPatient(pid), (c) => decideConsentRequest(c, pid, req.id, 'approve'))
    expect(r).toMatchObject({ state: 'GRANTED', transfer: 'TRANSFERRED', documents: 5, events: 7 })

    const a = await rowsOf(pid)
    expect(a.requests[0]).toMatchObject({ state: 'GRANTED', artefact: { status: 'GRANTED', patientHmac: abhaHmac(HERO_ABHA), hiTypes: [...ALL] } })
    expect(JSON.stringify(a.requests[0].artefact)).not.toContain(HERO_ABHA) // the ABHA itself is never stored in the artefact
    expect(a.transfers[0]).toMatchObject({ state: 'TRANSFERRED', entriesCount: 5, failure: null })
    expect(a.transfers[0].hiuKeySha256).toMatch(/^[0-9a-f]{64}$/)
    expect(a.docs.map((d) => [d.intakeRoute, d.mime, d.status, d.attachState, d.docType]).sort()).toEqual([
      ['abdm', 'application/fhir+json', 'done', 'auto', 'consult_note'], ['abdm', 'application/fhir+json', 'done', 'auto', 'discharge_summary'],
      ['abdm', 'application/fhir+json', 'done', 'auto', 'imaging_report'], ['abdm', 'application/fhir+json', 'done', 'auto', 'lab_report'],
      ['abdm', 'application/fhir+json', 'done', 'auto', 'prescription_printed'],
    ])
    expect(a.files).toHaveLength(5) // the bundles, encrypted
    expect(new Set(a.events.map((e) => `${e.sourceType}/${e.extractionMethod}`))).toEqual(new Set(['external_structured/structured_map']))
    expect(a.evidence).toHaveLength(7)
    for (const x of a.evidence) {
      expect(x.fhirResourceRef).toMatch(/^(DiagnosticReport|Encounter|Procedure|Composition)\/[0-9a-f-]+(#\d+)?$/)
      expect(x.quote).toBeNull()
      expect(x.quoteSha256).toMatch(/^[0-9a-f]{64}$/)
    }
    const proc = a.events.find((e) => e.eventType === 'procedure_documented')!
    expect(proc).toMatchObject({ eventDate: '2026-03-10', fields: { procedure_text: 'Wide local excision, left breast' } })
    // Radar ran over the ABDM events: the excision (2026-03-10) expects a histopathology report that is not in file.
    expect(a.missing.find((m) => m.triggerEventId === proc.id)).toMatchObject({ ruleId: 'RAD-SURG-HPE-01', state: 'expected' })

    // The patient revokes: the artefact is REVOKED and everything it brought in is erased (documents, files, events, evidence, Radar rows).
    const rv = await flow(asPatient(pid), (c) => revokeConsentRequest(c, pid, req.id))
    expect(rv).toMatchObject({ state: 'REVOKED', erased: { documents: 5, events: 7 } })
    const b = await rowsOf(pid)
    expect([b.docs, b.events, b.evidence, b.files]).toEqual([[], [], [], []])
    expect(b.missing.filter((m) => m.ruleId === 'RAD-SURG-HPE-01')).toEqual([])
    expect(b.requests[0]).toMatchObject({ state: 'REVOKED', erasedAt: expect.any(Date) })
    expect(b.transfers[0].state).toBe('ERASED')
    const audit = await withOrg(ORG, (db) => db.select({ action: auditLog.action }).from(auditLog).where(and(eq(auditLog.targetId, req.id))))
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(['abdm.consent_requested', 'abdm.consent_granted', 'abdm.consent_revoked', 'abdm.erased']))
  })

  it('only the granted HI types arrive; a denied request brings nothing', async () => {
    const pid = await seedPatient({ abdm: true })
    const req = await request(pid, ['Prescription'])
    expect(await flow(asPatient(pid), (c) => decideConsentRequest(c, pid, req.id, 'approve'))).toMatchObject({ documents: 1, events: 1 })
    expect((await rowsOf(pid)).events.map((e) => e.eventType)).toEqual(['prescription_documented'])
    const pid2 = await seedPatient({ abdm: true })
    const req2 = await request(pid2)
    expect(await flow(asPatient(pid2), (c) => decideConsentRequest(c, pid2, req2.id, 'deny'))).toEqual({ state: 'DENIED', documents: 0 })
    await expect(flow(asPatient(pid2), (c) => decideConsentRequest(c, pid2, req2.id, 'approve'))).rejects.toMatchObject({ code: 'already_decided' })
    const z = await rowsOf(pid2)
    expect([z.docs.length, z.transfers.length, z.requests[0].state]).toEqual([0, 0, 'DENIED'])
  })

  it('a tampered ciphertext is refused at decryption and nothing is written', async () => {
    const pid = await seedPatient({ abdm: true })
    const req = await request(pid)
    // Grant at the consent manager and store the artefact, then run the push by hand so one entry can be tampered with.
    const gw = abdmTransport() as InProcessGateway
    const [row] = await withOrg(ORG, (db) => db.select().from(abdmConsentRequests).where(eq(abdmConsentRequests.id, req.id)))
    const n = gw.decide(row.consentRequestId!, {
      patientId: HERO_ABHA, hiuId: 'test', purpose: { text: 'Care Management', code: 'CAREMGT', refUri: 'x' }, requester: { name: 'x', identifier: { type: 'REGNO', value: 'x', system: 'x' } },
      hiTypes: [...ALL], dateRange: { from: `${RANGE.from}T00:00:00.000Z`, to: `${RANGE.to}T23:59:59.999Z` }, dataEraseAt: row.eraseAt.toISOString(),
    }, 'GRANTED')
    const artefact = (await gw.fetchArtefact(n.consentArtefacts[0].id))!
    const hiu = ephemeral(new Date(Date.now() + 600_000))
    const { push } = await gw.requestHealthInformation({ consentId: artefact.consentId, dateRange: artefact.permission.dateRange, dataPushUrl: 'x', keyMaterial: hiu.keyMaterial })
    const bytes = Buffer.from(push!.entries[2].content, 'base64')
    bytes[bytes.length - 20] ^= 0x01
    push!.entries[2] = { ...push!.entries[2], content: bytes.toString('base64') }

    const res = await flow(asPatient(pid), async (c) => {
      await c.db.update(abdmConsentRequests).set({ state: 'GRANTED', artefactId: artefact.consentId, artefact: storedArtefact(artefact) }).where(eq(abdmConsentRequests.id, req.id))
      const [x] = await c.db.insert(abdmTransfers).values({ orgId: ORG, patientId: pid, consentRequestId: req.id, hiuKeySha256: 'k', hiuNonceSha256: 'n' }).returning()
      return receiveDataPush(c, x.id, push!, hiu, gw)
    })
    expect(res).toMatchObject({ transfer: 'FAILED', failure: 'decrypt_failed', documents: 0 })
    const z = await rowsOf(pid)
    expect([z.docs, z.events, z.evidence, z.files]).toEqual([[], [], [], []])
    expect(z.transfers[0]).toMatchObject({ state: 'FAILED', failure: 'decrypt_failed', entriesCount: 5, documentIds: [] })
  })

  it('erase-at: the cron sweep expires and erases; abdm_erase() refuses early, other orgs, and is the only delete path', async () => {
    const pid = await seedPatient({ abdm: true })
    const req = await request(pid, ['DischargeSummary'])
    await flow(asPatient(pid), (c) => decideConsentRequest(c, pid, req.id, 'approve'))
    // Not due yet: refused by the DB function itself; another org (rolled back) cannot see it; the app role cannot delete rows.
    const refused = (org: string) => app.begin(async (tx: TransactionSql) => {
      await tx`select set_config('app.org_id', ${org}, true)`
      return tx`select abdm_erase(${req.id})`
    }).then(() => null, (e: { code: string; message: string }) => ({ code: e.code, message: e.message }))
    expect(await refused(ORG)).toEqual({ code: '55000', message: 'abdm_erase_not_due' })
    expect(await refused(ORG_NARMADA_ID)).toEqual({ code: 'P0002', message: 'abdm_request_not_found' })
    const del = await app.begin(async (tx: TransactionSql) => {
      await tx`select set_config('app.org_id', ${ORG}, true)`
      return tx`delete from abdm_consent_requests where id = ${req.id}`
    }).then(() => null, (e: { code: string }) => e.code)
    expect(del).toBe('42501')
    expect((await rowsOf(pid)).events).toHaveLength(3)

    await owner`update abdm_consent_requests set erase_at = now() - interval '1 minute' where id = ${req.id}` // time passes
    const erased = await flow({ id: randomUUID(), role: 'system' }, (c) => eraseDue(c))
    expect(erased).toContain(req.id)
    const z = await rowsOf(pid)
    expect([z.docs, z.events, z.evidence]).toEqual([[], [], []])
    expect(z.requests[0]).toMatchObject({ state: 'EXPIRED', erasedAt: expect.any(Date) })
    expect(await flow({ id: randomUUID(), role: 'system' }, (c) => eraseDue(c, pid))).toEqual([]) // nothing left to do
  })
})
