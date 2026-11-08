// J8 / PRD §10.5 at the DATABASE level: erase_patient() (drizzle/0006) enforces its own preconditions and deletes a
// patient's originals and derived data in one transaction, leaving a tombstone, the consents and the audit trail.
// Runs as oncosetu_app in the Ganga org; the owner only moves eligible_after (what the retention period would do) and reads.
//   npm run test:integration   (needs .env.local)
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres, { type TransactionSql } from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, withOrg } from '../../src/db'
import { verifyAuditChain, writeAudit } from '../../src/server/audit'
import { ORG_GANGA_ID as ORG, ORG_NARMADA_ID } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')

const app = postgres(process.env.DATABASE_URL_APP!, { max: 1, prepare: false, onnotice: () => {} })
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
afterAll(async () => { await app.end(); await owner.end(); await closeDb() })

class Rollback extends Error {}
const setOrg = (tx: TransactionSql, org: string) => tx`select set_config('app.org_id', ${org}, true)`
/** Committed, as the app role with RLS on the org. */
const asApp = <T>(org: string, fn: (tx: TransactionSql) => Promise<T>) => app.begin(async (tx) => { await setOrg(tx, org); return fn(tx) }) as Promise<T>
/** Rolled back, as the app role; returns the error the DB raised (or null). */
const refusal = (org: string | null, fn: (tx: TransactionSql) => Promise<unknown>) =>
  app.begin(async (tx) => {
    if (org) await setOrg(tx, org)
    try { await fn(tx) } catch (e) { const pg = e as { code: string; message: string }; throw Object.assign(new Rollback(), { pg: { code: pg.code, message: pg.message } }) }
    throw Object.assign(new Rollback(), { pg: null })
  }).catch((e) => { if (e instanceof Rollback) return (e as Rollback & { pg: { code: string; message: string } | null }).pg; throw e })
const erase = (tx: TransactionSql, requestId: string) => tx`select erase_patient(${requestId}) as counts`

const PATIENT_TABLES = ['documents', 'document_files', 'document_pages', 'events', 'evidence', 'verifications', 'verification_qa_reviews',
  'patient_statements', 'missing_records', 'record_requests', 'snapshots', 'share_links', 'share_views', 'caregivers', 'patient_aliases',
  'encounters', 'sessions', 'ai_runs', 'outbox', 'break_glass', 'voice_clips']
const rand = () => randomUUID().replace(/-/g, '')

/** A patient with something in every table erasure touches. Returns the ids the assertions need. */
async function seedPatient(tx: TransactionSql, staff: { records: string; admin: string }) {
  const id = randomUUID()
  await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, dob_enc, phone_enc, phone_hmac, abha_number_enc, abha_hmac, identity_hmac, mrn, sex)
    values (${id}, ${ORG}, ${'t-' + rand()}, 'v1.name', 'v1.dob', 'v1.phone', ${'ph-' + rand()}, 'v1.abha', ${'ab-' + rand()}, ${'id-' + rand()}, ${'MRN-' + rand().slice(0, 10)}, 'female')`
  await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language)
    values (${ORG}, ${id}, 'grant', ${tx.json({ store: true, ai: true, share: true, abdm: false, metrics: true })}, 'staff', 'test', 'en')`
  const [enc] = await tx`insert into encounters (org_id, patient_id, type, started_by) values (${ORG}, ${id}, 'onboarding', ${staff.records}) returning id`
  const [doc] = await tx`insert into documents (org_id, patient_id, encounter_id, sha256, mime, size_bytes, intake_route, uploaded_by_kind, filename_enc)
    values (${ORG}, ${id}, ${enc.id}, ${rand()}, 'application/pdf', 10, 'desk', 'staff', 'v1.file') returning id`
  await tx`insert into document_files (org_id, patient_id, document_id, kind, mime, bytes_enc, dek_wrapped, size, sha256)
    values (${ORG}, ${id}, ${doc.id}, 'original', 'application/pdf', ${Buffer.from('x')}, 'v1.dek', 1, ${rand()})`
  await tx`insert into document_pages (org_id, patient_id, document_id, page_no, text) values (${ORG}, ${id}, ${doc.id}, 1, 'page text')`
  const [ev1] = await tx`insert into events (org_id, patient_id, encounter_id, document_id, event_type, source_type, extraction_method)
    values (${ORG}, ${id}, ${enc.id}, ${doc.id}, 'lab_report_documented', 'external_document', 'manual') returning id`
  const [ev2] = await tx`insert into events (org_id, patient_id, document_id, event_type, source_type, extraction_method, version, supersedes_id)
    values (${ORG}, ${id}, ${doc.id}, 'lab_report_documented', 'external_document', 'manual', 2, ${ev1.id}) returning id`
  const [st] = await tx`insert into patient_statements (org_id, patient_id, encounter_id, question_id, created_by_kind, transcript)
    values (${ORG}, ${id}, ${enc.id}, 'q1', 'patient', 'spoken words') returning id`
  await tx`insert into evidence (org_id, patient_id, event_id, document_id, page_no, quote) values (${ORG}, ${id}, ${ev2.id}, ${doc.id}, 1, 'a quote')`
  await tx`insert into evidence (org_id, patient_id, event_id, statement_id) values (${ORG}, ${id}, ${ev2.id}, ${st.id})`
  await tx`insert into voice_clips (org_id, patient_id, statement_id, mime, size, bytes_enc, dek_wrapped, asr_provider, asr_model, created_by_kind, created_by_id)
    values (${ORG}, ${id}, ${st.id}, 'audio/webm', 1, ${Buffer.from('x')}, 'v1.dek', 'sarvam', 'saaras:v4', 'patient', ${id})`
  // a desk audio note on the visit (0020): its encounter link must not block deleting the encounter
  await tx`insert into voice_clips (org_id, patient_id, encounter_id, mime, size, bytes_enc, dek_wrapped, asr_provider, asr_model, created_by_kind, created_by_id)
    values (${ORG}, ${id}, ${enc.id}, 'audio/webm', 1, ${Buffer.from('x')}, 'v1.dek', 'none', 'none', 'staff', ${staff.records})`
  const [ver] = await tx`insert into verifications (org_id, patient_id, event_id, action, to_status, actor_id, role, reason)
    values (${ORG}, ${id}, ${ev2.id}, 'verify', 'verified_matches_source', ${staff.records}, 'records', 'free text') returning id`
  await tx`insert into verification_qa_reviews (org_id, patient_id, verification_id, event_id, reviewer_id, outcome)
    values (${ORG}, ${id}, ${ver.id}, ${ev2.id}, ${staff.admin}, 'agree')`
  const [mr] = await tx`insert into missing_records (org_id, patient_id, rule_id, rule_version, trigger_event_id, expected_types, dedupe_key)
    values (${ORG}, ${id}, 'R1', '1', ${ev2.id}, ${tx.json([])}, ${'erasure-test-' + rand()}) returning id`
  await tx`insert into record_requests (org_id, patient_id, missing_record_id, institution, created_by_kind, fulfilled_document_id)
    values (${ORG}, ${id}, ${mr.id}, 'Somewhere', 'staff', ${doc.id})`
  const [snap] = await tx`insert into snapshots (org_id, patient_id, encounter_id, seq, canonical_json, sha256)
    values (${ORG}, ${id}, ${enc.id}, 1, '{}', ${rand()}) returning id`
  const [share] = await tx`insert into share_links (org_id, patient_id, snapshot_id, ciphertext, iv, expires_at, created_by_kind)
    values (${ORG}, ${id}, ${snap.id}, 'c', 'iv', now() + interval '7 days', 'staff') returning id`
  await tx`insert into share_views (org_id, patient_id, share_link_id) values (${ORG}, ${id}, ${share.id})`
  const [cg] = await tx`insert into caregivers (org_id, patient_id, name_enc, relation, phone_enc, phone_hmac)
    values (${ORG}, ${id}, 'v1.cg', 'son', 'v1.cgphone', ${'cg-' + rand()}) returning id`
  await tx`insert into patient_aliases (org_id, patient_id, name_enc) values (${ORG}, ${id}, 'v1.alias')`
  await tx`insert into ai_runs (org_id, patient_id, document_id, kind, provider, outcome) values (${ORG}, ${id}, ${doc.id}, 'extract', 'test', 'ok')`
  await tx`insert into ai_runs (org_id, document_id, kind, provider, outcome) values (${ORG}, ${doc.id}, 'classify', 'test', 'ok')` // linked by document only
  await tx`insert into outbox (org_id, patient_id, channel, to_masked, to_hmac, template_key, body) values (${ORG}, ${id}, 'sms', '+91 ••••', ${rand()}, 'test', 'hello')`
  await tx`insert into break_glass (org_id, patient_id, staff_id, reason, expires_at) values (${ORG}, ${id}, ${staff.admin}, 'emergency reason text', now())`
  await tx`insert into sessions (token_hash, kind, patient_id, caregiver_id, org_id, expires_at, idle_timeout_s)
    values (${rand()}, 'caregiver', ${id}, ${cg.id}, ${ORG}, now() + interval '1 hour', 1800)`
  const [form] = await tx`insert into measurement_forms (org_id, encounter_id, clinician_id, consultation_date, phase, missing_record_present)
    values (${ORG}, ${enc.id}, ${staff.admin}, current_date, 'baseline', false) returning id`
  return { id, docId: doc.id as string, formId: form.id as string }
}

describe('erase_patient()', () => {
  it('refuses until due and while consent is active, refuses other orgs, then erases everything but the tombstone', async () => {
    const staffRows = await app`select id, email from staff where email in ('records@ganga.test', 'admin@ganga.test')`
    const staff = { records: staffRows.find((s) => s.email === 'records@ganga.test')!.id, admin: staffRows.find((s) => s.email === 'admin@ganga.test')!.id }

    // A patient, a merged duplicate of the same person (its own consent and snapshot stay on it, as approveMerge leaves them)
    const { p, dup } = await asApp(ORG, async (tx) => {
      const p = await seedPatient(tx, staff)
      const dup = await seedPatient(tx, staff)
      await tx`update patients set status = 'merged' where id = ${dup.id}`
      await tx`insert into patient_merges (org_id, survivor_id, duplicate_id, requested_by, approved_by, state, executed_at)
        values (${ORG}, ${p.id}, ${dup.id}, ${staff.records}, ${staff.admin}, 'executed', now())`
      return { p, dup }
    })
    // J8: consent withdrawn (its own transaction: recorded_at is the transaction time, and the latest row wins), then the
    // request is queued with the retention period still to run.
    const requestId = await asApp(ORG, async (tx) => {
      await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, actor_id, notice_version, language)
        values (${ORG}, ${p.id}, 'withdraw', ${tx.json({ store: false, ai: false, share: false, abdm: false, metrics: false })}, 'patient', ${p.id}, 'test', 'en')`
      const [r] = await tx`insert into erasure_requests (org_id, patient_id, requested_by_kind, requested_by_id, eligible_after)
        values (${ORG}, ${p.id}, 'patient', ${p.id}, now() + interval '3 years') returning id`
      return r.id as string
    })
    await withOrg(ORG, async (tx) => {
      await writeAudit(tx, { orgId: ORG, actorId: p.id, actorRole: 'patient', action: 'consent.withdraw', targetType: 'patient', targetId: p.id })
      await writeAudit(tx, { orgId: ORG, actorId: p.id, actorRole: 'patient', action: 'erasure.request', targetType: 'erasure_request', targetId: requestId, details: { patientId: p.id } })
    })

    // (a) before eligible_after: refused by the DB function itself
    expect(await refusal(ORG, (tx) => erase(tx, requestId))).toEqual({ code: '55000', message: 'erasure_not_eligible' })

    // The retention period runs out (the owner stands in for time passing).
    await owner`update erasure_requests set eligible_after = now() - interval '1 day' where id = ${requestId}`

    // (b) consent active again (latest row grants store): refused, nothing deleted
    expect(await refusal(ORG, async (tx) => {
      await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language)
        values (${ORG}, ${p.id}, 'grant', ${tx.json({ store: true, ai: false, share: false, abdm: false, metrics: false })}, 'staff', 'test', 'en')`
      await erase(tx, requestId)
    })).toEqual({ code: '55000', message: 'erasure_consent_active' })

    // (d) another org, or no org at all: indistinguishable from a missing request
    expect(await refusal(ORG_NARMADA_ID, (tx) => erase(tx, requestId))).toEqual({ code: 'P0002', message: 'erasure_not_found' })
    expect(await refusal(null, (tx) => erase(tx, requestId))).toEqual({ code: 'P0002', message: 'erasure_not_found' })
    const [{ n: docsLeft }] = await owner`select count(*)::int as n from documents where patient_id = ${p.id}`
    expect(docsLeft).toBe(1) // every refusal left the data alone

    // (c) due, consent withdrawn, own org: erased in one call
    const [{ counts }] = await asApp(ORG, (tx) => erase(tx, requestId))
    expect(counts).toMatchObject({
      documents: 2, document_files: 2, document_pages: 2, events: 4, evidence: 4, verifications: 2, verification_qa_reviews: 2,
      snapshots: 2, share_links: 2, share_views: 2, caregivers: 2, encounters: 2, sessions: 2, ai_runs: 4, outbox: 2, break_glass: 2,
      measurement_forms_unlinked: 2, patients_tombstoned: 2,
    })

    for (const t of PATIENT_TABLES) {
      const [{ n }] = await owner`select count(*)::int as n from ${owner(t)} where patient_id in (${p.id}, ${dup.id})`
      expect([t, n]).toEqual([t, 0])
    }
    const [{ n: aiByDoc }] = await owner`select count(*)::int as n from ai_runs where document_id in (${p.docId}, ${dup.docId})`
    expect(aiByDoc).toBe(0)
    const forms = await owner`select encounter_id from measurement_forms where id in (${p.formId}, ${dup.formId})`
    expect(forms).toEqual([{ encounter_id: null }, { encounter_id: null }]) // study rows kept, link to the erased visits cut

    for (const id of [p.id, dup.id]) {
      const [row] = await owner`select * from patients where id = ${id}`
      expect(row).toMatchObject({
        status: 'erased', name_enc: '', dob_enc: null, phone_enc: null, phone_hmac: null, abha_number_enc: null, abha_hmac: null,
        identity_hmac: null, mrn: null, sex: 'unknown', oncosetu_token_hash: `erased:${id}`,
      })
      expect(row.token_revoked_at).not.toBeNull()
    }
    const [{ n: consentRows }] = await owner`select count(*)::int as n from consents where patient_id = ${p.id}`
    expect(consentRows).toBe(2) // grant + withdrawal: the legal record stays
    const [req] = await owner`select state, completed_at from erasure_requests where id = ${requestId}`
    expect(req.state).toBe('completed')
    expect(req.completed_at).not.toBeNull()
    const [{ n: auditRows }] = await owner`select count(*)::int as n from audit_log where org_id = ${ORG} and (target_id = ${p.id} or details->>'patientId' = ${p.id})`
    expect(auditRows).toBe(2)
    expect((await verifyAuditChain(ORG)).ok).toBe(true)

    // Done once: a second call is refused.
    expect(await refusal(ORG, (tx) => erase(tx, requestId))).toEqual({ code: '55000', message: 'erasure_not_open' })
  }, 120_000) // ~70 round trips to the hosted database

  it('snapshots stay append-only outside erase_patient(), for the owner and for the app role with the flag set', async () => {
    const seedSnapshot = async (tx: TransactionSql) => {
      const id = randomUUID()
      await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc) values (${id}, ${ORG}, ${'t-' + rand()}, 'v1.x')`
      const [s] = await tx`insert into snapshots (org_id, patient_id, seq, canonical_json, sha256) values (${ORG}, ${id}, 1, '{}', 'x') returning id`
      return s.id as string
    }
    let ownerCode: string | undefined
    await owner.begin(async (tx) => {
      await tx`select set_config('app.org_id', ${ORG}, true)`
      const id = await seedSnapshot(tx)
      ownerCode = (await tx`delete from snapshots where id = ${id}`.catch((e) => e)).code
      throw new Rollback()
    }).catch((e) => { if (!(e instanceof Rollback)) throw e })
    expect(ownerCode).toBe('42501') // the trigger: no flag
    expect(await refusal(ORG, async (tx) => {
      const id = await seedSnapshot(tx)
      await tx`select set_config('oncosetu.erasing', 'on', true)`
      await tx`delete from snapshots where id = ${id}`
    })).toMatchObject({ code: '42501' }) // the grant: the flag alone opens nothing
  }, 60_000)
})
