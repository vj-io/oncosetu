// J6 / FR-ING-ABDM-01/02: staff request → the patient decides (in-process CM; stands in for the ABHA app) → on GRANTED the
// HIU requests data, the HIP pushes encrypted entries → consent re-checked (OncoSetu purposes + the artefact) → decrypt →
// FHIR mapped → documents + events (external_structured / structured_map, evidence = fhir_resource_ref) → Radar.
// Erase (PRD §10.5): revocation or the artefact's erase-at → abdm_erase() (drizzle/0009) → Radar.
// Everything runs on the caller's transaction (route ctx.db or a cron withOrg): POOL RULE, no second connection.
// ABDM times (artefact validity, erase-at) are real time, never the demo clock.
import { and, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { Tx } from '@/db'
import { abdmConsentRequests, abdmTransfers, documents, events, evidence, patients, staff, type AbdmArtefact } from '@/db/schema'
import { canonicalJson } from '@/core/canonical'
import { brandFor, istDate, staffDocLabel } from '@/core/copy'
import { HI_TYPES, mapBundle, type HiType } from '@/core/fhir'
import type { DocType } from '@/core/types'
import { ta } from '@/i18n/abdm'
import type { AuditDetails } from '../audit'
import { decryptField, encryptField, sha256Hex } from '../crypto'
import { storeFile } from '../files'
import { HttpError } from '../http'
import { log } from '../log'
import { sendMessage } from '../outbox'
import { activeConsent, assertConsent } from '../patients'
import { recomputeRadar } from '../pipeline/radar'
import { primaryContactTarget } from '../registration/contact'
import { abhaDigits, abhaHmac } from '../registration/duplicates'
import { ephemeral, type Ephemeral } from './crypto'
import { bundleWithinArtefact, openPush } from './gate'
import { abdmTransport, AbdmTransportError, InProcessGateway, type AbdmTransport, type ConsentArtefact, type ConsentNotification, type ConsentRequestInit, type DataPush } from './transport'

// ponytail: one fixed retention for every request (the artefact's dataEraseAt); make it a request field when an org asks.
export const ABDM_RETENTION_DAYS = 30
const PURPOSE = { text: 'Care Management', code: 'CAREMGT', refUri: 'http://terminology.hl7.org/ValueSet/v3-PurposeOfUse' }
const HIU_ID = () => process.env.ABDM_HIU_ID ?? 'ONCOSETU-HIU-INPROCESS'
const DAY = 86_400_000

type Audit = (action: string, targetType: string | null, targetId: string | null, details?: AuditDetails) => Promise<void>
export type FlowCtx = { db: Tx; orgId: string; audit: Audit }
type RequestRow = typeof abdmConsentRequests.$inferSelect

function transport(): AbdmTransport {
  try { return abdmTransport() } catch (e) {
    throw e instanceof AbdmTransportError ? new HttpError(e.status, e.code, 'ABDM gateway is not configured on this server') : e
  }
}
const gatewayError = (e: unknown) =>
  e instanceof AbdmTransportError ? new HttpError(e.status === 400 ? 400 : 502, e.code, 'The ABDM gateway refused the request') : e

/** Calendar days encoded at UTC day boundaries: the CM, HIP and gate all compare calendar days. */
const rangeOf = (r: Pick<RequestRow, 'dateFrom' | 'dateTo'>) => ({ from: `${r.dateFrom}T00:00:00.000Z`, to: `${r.dateTo}T23:59:59.999Z` })

async function initFor(db: Tx, r: RequestRow, abha: string): Promise<ConsentRequestInit> {
  const [s] = await db.select({ name: staff.name }).from(staff).where(eq(staff.id, r.requestedBy))
  return {
    patientId: abha, hiuId: HIU_ID(), purpose: PURPOSE, hiTypes: r.hiTypes as HiType[], dateRange: rangeOf(r), dataEraseAt: r.eraseAt.toISOString(),
    requester: { name: s?.name ?? 'OncoSetu staff', identifier: { type: 'REGNO', value: r.requestedBy, system: 'https://oncosetu.in/staff' } },
  }
}

async function patientAbha(db: Tx, patientId: string) {
  const [p] = await db.select({ enc: patients.abhaNumberEnc, hmac: patients.abhaHmac, disclosure: patients.disclosureStatus })
    .from(patients).where(eq(patients.id, patientId))
  return { abha: p?.enc ? decryptField(p.enc) : null, hmac: p?.hmac ?? null, disclosure: p?.disclosure ?? 'unknown' }
}

// ── staff: consent request ───────────────────────────────────────────────────
export type ConsentRequestBody = { hiTypes: HiType[]; from: string; to: string }

/** Caller has run assertPatientAccess. Needs consent purpose `abdm` and a captured ABHA number. */
export async function createConsentRequest(c: FlowCtx & { staffId: string; origin: string | null }, patientId: string, body: ConsentRequestBody) {
  await assertConsent(c.db, patientId, 'abdm')
  const p = await patientAbha(c.db, patientId)
  if (!p.abha || !p.hmac) throw new HttpError(409, 'abha_missing', 'No ABHA number is recorded for this patient')
  const today = istDate(new Date().toISOString())
  if (!(body.from <= body.to)) throw new HttpError(400, 'invalid_range', 'The start date must be on or before the end date')
  if (body.to > today) throw new HttpError(400, 'invalid_range', 'The end date cannot be in the future')
  const hiTypes = HI_TYPES.filter((h) => body.hiTypes.includes(h))
  const t = transport()
  const [row] = await c.db.insert(abdmConsentRequests).values({
    orgId: c.orgId, patientId, requestedBy: c.staffId, hiTypes, dateFrom: body.from, dateTo: body.to,
    eraseAt: new Date(Date.now() + ABDM_RETENTION_DAYS * DAY),
  }).returning()
  const res = await t.initConsentRequest(await initFor(c.db, row, p.abha)).catch((e) => { throw gatewayError(e) })
  await c.db.update(abdmConsentRequests).set({ gatewayRequestId: res.requestId, consentRequestId: res.consentRequestId, updatedAt: new Date() })
    .where(eq(abdmConsentRequests.id, row.id))
  // The consent manager tells the patient (here: an SMS to the primary contact with the portal link).
  const target = await primaryContactTarget(c.db, patientId)
  if (target && c.origin) {
    await sendMessage(c.db, {
      orgId: c.orgId, patientId, toPhone: target.phone, channel: 'sms', templateKey: 'abdm.consent_request', lang: target.lang,
      body: ta(target.lang, 'sms', { brand: brandFor(p.disclosure), url: `${c.origin}/p/login?next=/p/abdm` }),
    })
  }
  await c.audit('abdm.consent_requested', 'abdm_consent_request', row.id, { patientId, hiTypes, transport: t.kind, notified: !!target })
  return { id: row.id, state: row.state, transport: t.kind }
}

// ── patient: decide, revoke ──────────────────────────────────────────────────
async function ownRequest(db: Tx, patientId: string, requestId: string): Promise<RequestRow> {
  const [r] = await db.select().from(abdmConsentRequests).where(and(eq(abdmConsentRequests.id, requestId), eq(abdmConsentRequests.patientId, patientId)))
  if (!r) throw new HttpError(404, 'not_found', 'Not found')
  return r
}
function inProcess(): InProcessGateway {
  const t = transport()
  if (!(t instanceof InProcessGateway)) throw new HttpError(409, 'decide_in_abha_app', 'Answer this request in your ABHA app')
  return t
}

/** The patient's answer (FR-CON-02: the acting patient or caregiver is the audit actor). */
export async function decideConsentRequest(c: FlowCtx, patientId: string, requestId: string, decision: 'approve' | 'deny') {
  const r = await ownRequest(c.db, patientId, requestId)
  if (r.state !== 'REQUESTED' || r.erasedAt) throw new HttpError(409, 'already_decided', 'This request was already answered')
  const gw = inProcess()
  if (decision === 'approve') await assertConsent(c.db, patientId, 'abdm')
  const p = await patientAbha(c.db, patientId)
  if (!p.abha) throw new HttpError(409, 'abha_missing', 'No ABHA number is recorded')
  const n = gw.decide(r.consentRequestId ?? r.id, await initFor(c.db, r, p.abha), decision === 'approve' ? 'GRANTED' : 'DENIED')
  return onConsentNotify(c, r, n, gw)
}

export async function revokeConsentRequest(c: FlowCtx, patientId: string, requestId: string) {
  const r = await ownRequest(c.db, patientId, requestId)
  if (r.state !== 'GRANTED' || !r.artefactId) throw new HttpError(409, 'not_granted', 'Only an approved request can be withdrawn')
  const gw = inProcess()
  return onConsentNotify(c, r, gw.revoke(r.consentRequestId ?? r.id, r.artefactId), gw)
}

/** HIU side of the consent manager's hiu/notify: record the decision; GRANTED fetches the artefact and pulls the data. */
export async function onConsentNotify(c: FlowCtx, r: RequestRow, n: ConsentNotification, t: AbdmTransport) {
  const at = new Date()
  if (n.status === 'DENIED') {
    await c.db.update(abdmConsentRequests).set({ state: 'DENIED', decidedAt: at, updatedAt: at }).where(eq(abdmConsentRequests.id, r.id))
    await c.audit('abdm.consent_denied', 'abdm_consent_request', r.id, { patientId: r.patientId })
    return { state: 'DENIED' as const, documents: 0 }
  }
  if (n.status === 'REVOKED' || n.status === 'EXPIRED') {
    await c.db.update(abdmConsentRequests).set({ state: n.status, updatedAt: at }).where(eq(abdmConsentRequests.id, r.id))
    await c.audit(n.status === 'REVOKED' ? 'abdm.consent_revoked' : 'abdm.consent_expired', 'abdm_consent_request', r.id, { patientId: r.patientId })
    const erased = await eraseRequest(c, r.id, r.patientId, n.status === 'REVOKED' ? 'revoked' : 'expired')
    return { state: n.status, documents: 0, erased }
  }
  const artefactId = n.consentArtefacts[0]?.id
  const a = artefactId ? await t.fetchArtefact(artefactId).catch((e) => { throw gatewayError(e) }) : null
  if (!a) throw new HttpError(502, 'artefact_unavailable', 'The consent artefact could not be fetched')
  const stored = storedArtefact(a)
  await c.db.update(abdmConsentRequests).set({
    state: 'GRANTED', artefactId: a.consentId, artefact: stored, eraseAt: new Date(stored.dataEraseAt), decidedAt: at, updatedAt: at,
  }).where(eq(abdmConsentRequests.id, r.id))
  await c.audit('abdm.consent_granted', 'abdm_consent_request', r.id, { patientId: r.patientId, artefactId: a.consentId })
  const [fresh] = await c.db.select().from(abdmConsentRequests).where(eq(abdmConsentRequests.id, r.id))
  const transfer = await runTransfer(c, fresh, t)
  return { state: 'GRANTED' as const, ...transfer }
}

/** The CM's artefact as stored: the ABHA identifier becomes its blind index (never kept in clear in the artefact). */
export function storedArtefact(a: ConsentArtefact): AbdmArtefact {
  return {
    consentId: a.consentId, status: a.status, patientHmac: abhaHmac(abhaDigits(a.patient.id)), hipId: a.hip?.id ?? null,
    hiTypes: a.hiTypes, dateRange: a.permission.dateRange, dataEraseAt: a.permission.dataEraseAt, grantedAt: a.createdAt,
  }
}

// ── transfer ─────────────────────────────────────────────────────────────────
async function runTransfer(c: FlowCtx, r: RequestRow, t: AbdmTransport) {
  const hiu = ephemeral(new Date(Date.now() + 15 * 60_000))
  const [x] = await c.db.insert(abdmTransfers).values({
    orgId: c.orgId, patientId: r.patientId, consentRequestId: r.id,
    hiuKeySha256: sha256Hex(hiu.keyMaterial.dhPublicKey.keyValue), hiuNonceSha256: sha256Hex(hiu.keyMaterial.nonce),
  }).returning({ id: abdmTransfers.id })
  let res: Awaited<ReturnType<AbdmTransport['requestHealthInformation']>>
  try {
    res = await t.requestHealthInformation({
      consentId: r.artefactId!, dateRange: rangeOf(r), keyMaterial: hiu.keyMaterial,
      dataPushUrl: `${process.env.PUBLIC_BASE_URL ?? 'in-process:'}/api/abdm/health-information/push`,
    })
  } catch (e) {
    const code = e instanceof AbdmTransportError ? e.code : 'gateway_error'
    await c.db.update(abdmTransfers).set({ state: 'FAILED', failure: code }).where(eq(abdmTransfers.id, x.id))
    await c.audit('abdm.transfer_failed', 'abdm_transfer', x.id, { requestId: r.id, failure: code })
    return { transferId: x.id, transfer: 'FAILED' as const, documents: 0 }
  }
  await c.db.update(abdmTransfers).set({ transactionId: res.transactionId }).where(eq(abdmTransfers.id, x.id))
  if (!res.push) return { transferId: x.id, transfer: 'REQUESTED' as const, documents: 0 } // sandbox: the push arrives on the webhook
  return receiveDataPush(c, x.id, res.push, hiu, t)
}

/**
 * The data push. Consent is checked on use — OncoSetu's own purposes (store + abdm), then the artefact (status, erase-at,
 * patient, HI types, date range) — before any entry is decrypted. One bad entry refuses the push and writes nothing but
 * the transfer's FAILED row and an audit line.
 */
export async function receiveDataPush(c: FlowCtx, transferId: string, push: DataPush, hiu: Ephemeral, t: AbdmTransport) {
  const [x] = await c.db.select().from(abdmTransfers).where(eq(abdmTransfers.id, transferId))
  if (!x) throw new HttpError(404, 'not_found', 'Not found')
  const [r] = await c.db.select().from(abdmConsentRequests).where(eq(abdmConsentRequests.id, x.consentRequestId))
  const p = await patientAbha(c.db, r.patientId)
  const consent = await activeConsent(c.db, r.patientId)
  const hipHashes = { hipKeySha256: sha256Hex(push.keyMaterial?.dhPublicKey?.keyValue ?? ''), hipNonceSha256: sha256Hex(push.keyMaterial?.nonce ?? '') }
  const now = new Date()
  const opened = consent?.purposes.store && consent.purposes.abdm
    ? openPush(r.artefact, { patientHmac: p.hmac, hiTypes: r.hiTypes, dateRange: rangeOf(r), now }, push, hiu)
    : { ok: false as const, reason: 'consent_withdrawn' as const }
  const notify = (sessionStatus: 'TRANSFERRED' | 'FAILED', ok: Set<string>) => t.notifyTransfer({
    consentId: r.artefactId ?? '', transactionId: push.transactionId, doneAt: new Date().toISOString(), hipId: r.artefact?.hipId ?? null, sessionStatus,
    statusResponses: push.entries.map((e) => ({ careContextReference: e.careContextReference, hiStatus: ok.has(e.careContextReference) ? 'OK' : 'ERRORED', description: ok.has(e.careContextReference) ? 'Delivered' : 'Not accepted' })),
  }).catch((err) => log.warn('abdm.notify_failed', { transferId, err }))

  if (!opened.ok) {
    await c.db.update(abdmTransfers).set({ state: 'FAILED', failure: opened.reason, entriesCount: push.entries.length, receivedAt: now, ...hipHashes }).where(eq(abdmTransfers.id, x.id))
    await c.audit('abdm.transfer_refused', 'abdm_transfer', x.id, { requestId: r.id, patientId: r.patientId, failure: opened.reason, entries: push.entries.length })
    await notify('FAILED', new Set())
    return { transferId: x.id, transfer: 'FAILED' as const, failure: opened.reason, documents: 0 }
  }

  const docIds: string[] = []
  const accepted = new Set<string>()
  let eventCount = 0, skipped = 0
  const shas = opened.entries.map((e) => sha256Hex(e.plaintext))
  const known = new Set(shas.length ? (await c.db.select({ sha: documents.sha256 }).from(documents)
    .where(and(eq(documents.patientId, r.patientId), inArray(documents.sha256, shas)))).map((d) => d.sha) : [])
  for (const [i, entry] of opened.entries.entries()) {
    let json: unknown
    try { json = JSON.parse(entry.plaintext.toString('utf8')) } catch { json = null }
    const m = mapBundle(json, { now: now.toISOString() })
    if (!m.ok || !bundleWithinArtefact(r.artefact!, { hiType: m.hiType, date: m.documentDate })) { skipped++; continue }
    if (known.has(shas[i])) { skipped++; accepted.add(entry.careContextReference); continue } // already in the file (a repeated pull)
    const reasons: Record<string, number> = {}
    for (const x2 of m.rejected) reasons[x2.reason] = (reasons[x2.reason] ?? 0) + 1
    const [doc] = await c.db.insert(documents).values({
      orgId: c.orgId, patientId: r.patientId, sha256: shas[i], mime: 'application/fhir+json', sizeBytes: entry.plaintext.length,
      filenameEnc: encryptField(`${m.recordType}-${entry.careContextReference}.json`.slice(0, 200)), intakeRoute: 'abdm',
      uploadedByKind: 'system', uploadedById: null, receivedAt: now, stage: 'completeness', status: 'done',
      identityResult: 'match', identityDetails: { method: 'abha_consent_artefact', consentId: r.artefactId, reasons: [], notes: ['abdm_linked_record'] },
      attachState: 'auto', docType: m.docType, docTypeConfidence: 1, documentDate: m.documentDate, institutionName: m.institution,
      processor: 'abdm-fhir-map', processorVersion: 'fhir-map.v1',
      flags: {
        abdm: { consentRequestId: r.id, transferId: x.id, recordType: m.recordType, hiType: m.hiType, careContextReference: entry.careContextReference, compositionId: m.compositionId },
        extraction: { method: 'structured_map' },
        gate: { candidates: m.events.length + m.rejected.length, accepted: m.events.length, kept: m.events.length, rejected: m.rejected.length, reasons },
      },
    }).returning({ id: documents.id })
    await storeFile(c.db, { orgId: c.orgId, patientId: r.patientId, documentId: doc.id, kind: 'original', mime: 'application/fhir+json', bytes: entry.plaintext })
    const rows = m.events.map((e) => ({ id: uuidv7(), e }))
    if (rows.length) {
      await c.db.insert(events).values(rows.map(({ id, e }) => ({
        id, orgId: c.orgId, patientId: r.patientId, documentId: doc.id, eventType: e.eventType, fields: e.fields, eventDate: e.eventDate,
        datePrecision: e.datePrecision, dateFlags: e.dateFlags, documentDate: m.documentDate, receivedAt: now,
        sourceType: 'external_structured' as const, extractionMethod: 'structured_map' as const, createdByKind: 'system' as const,
      })))
      await c.db.insert(evidence).values(rows.map(({ id, e }) => ({
        orgId: c.orgId, patientId: r.patientId, eventId: id, documentId: doc.id, fhirResourceRef: e.fhirRef, quoteSha256: sha256Hex(canonicalJson(e.source)),
      })))
    }
    eventCount += rows.length
    docIds.push(doc.id)
    accepted.add(entry.careContextReference)
  }
  await c.db.update(abdmTransfers).set({ state: 'TRANSFERRED', entriesCount: push.entries.length, documentIds: docIds, receivedAt: now, ...hipHashes })
    .where(eq(abdmTransfers.id, x.id))
  await recomputeRadar(c.db, c.orgId, r.patientId)
  await c.audit('abdm.transfer_received', 'abdm_transfer', x.id, { requestId: r.id, patientId: r.patientId, documents: docIds, events: eventCount, skipped })
  await notify('TRANSFERRED', accepted)
  return { transferId: x.id, transfer: 'TRANSFERRED' as const, documents: docIds.length, events: eventCount, skipped }
}

// ── erase (PRD §10.5) ────────────────────────────────────────────────────────
/** abdm_erase() enforces its own preconditions (revoked, or erase_at passed in real time); then the Radar is re-run. */
export async function eraseRequest(c: FlowCtx, requestId: string, patientId: string, reason: 'revoked' | 'expired' | 'erase_at') {
  const rows = await c.db.execute(sql`select abdm_erase(${requestId}) as counts`)
  const counts = ((rows as unknown as { counts: Record<string, number | boolean> }[])[0]?.counts ?? {})
  if (counts.already_erased) return { documents: 0, events: 0 }
  await recomputeRadar(c.db, c.orgId, patientId)
  const out = { documents: Number(counts.documents ?? 0), events: Number(counts.events ?? 0) }
  await c.audit('abdm.erased', 'abdm_consent_request', requestId, { patientId, reason, ...out })
  return out
}

/** Every request in this org (or for one patient) whose erase-at has passed and that was not erased yet. Cron + on read. */
export async function eraseDue(c: FlowCtx, patientId?: string): Promise<string[]> {
  const due = await c.db.select({ id: abdmConsentRequests.id, patientId: abdmConsentRequests.patientId, state: abdmConsentRequests.state })
    .from(abdmConsentRequests)
    .where(and(isNull(abdmConsentRequests.erasedAt), lte(abdmConsentRequests.eraseAt, sql`now()`), patientId ? eq(abdmConsentRequests.patientId, patientId) : undefined))
  for (const d of due) {
    if (d.state === 'REQUESTED' || d.state === 'GRANTED') {
      await c.db.update(abdmConsentRequests).set({ state: 'EXPIRED', updatedAt: new Date() }).where(eq(abdmConsentRequests.id, d.id))
    }
    await eraseRequest(c, d.id, d.patientId, 'erase_at')
  }
  return due.map((d) => d.id)
}

// ── read models ──────────────────────────────────────────────────────────────
export async function staffAbdmView(db: Tx, patientId: string) {
  const reqs = await db.select({ r: abdmConsentRequests, by: staff.name }).from(abdmConsentRequests)
    .leftJoin(staff, eq(staff.id, abdmConsentRequests.requestedBy))
    .where(eq(abdmConsentRequests.patientId, patientId)).orderBy(desc(abdmConsentRequests.createdAt))
  const ids = reqs.map((x) => x.r.id)
  const xfers = ids.length ? await db.select().from(abdmTransfers).where(inArray(abdmTransfers.consentRequestId, ids)).orderBy(abdmTransfers.requestedAt) : []
  const docs = await db.select({ id: documents.id, docType: documents.docType, documentDate: documents.documentDate, institution: documents.institutionName, flags: documents.flags, receivedAt: documents.receivedAt })
    .from(documents).where(and(eq(documents.patientId, patientId), eq(documents.intakeRoute, 'abdm'))).orderBy(documents.documentDate)
  const evs = docs.length ? await db.select({ documentId: events.documentId }).from(events).where(and(inArray(events.documentId, docs.map((d) => d.id)), isNull(events.withdrawnAt))) : []
  const [p] = await db.select({ abha: patients.abhaHmac }).from(patients).where(eq(patients.id, patientId))
  const consent = await activeConsent(db, patientId)
  return {
    ready: { abha: !!p?.abha, consent: !!consent?.purposes.abdm, transport: transport().kind },
    requests: reqs.map(({ r, by }) => ({
      id: r.id, state: r.state, hiTypes: r.hiTypes, from: r.dateFrom, to: r.dateTo, requestedBy: by, createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null, eraseAt: r.eraseAt.toISOString(), erasedAt: r.erasedAt?.toISOString() ?? null,
      transfers: xfers.filter((x) => x.consentRequestId === r.id).map((x) => ({
        id: x.id, state: x.state, failure: x.failure, entries: x.entriesCount, documents: x.documentIds.length,
        requestedAt: x.requestedAt.toISOString(), receivedAt: x.receivedAt?.toISOString() ?? null,
      })),
    })),
    documents: docs.map((d) => ({
      id: d.id, title: staffDocLabel((d.docType ?? 'other') as DocType), documentDate: d.documentDate, institution: d.institution,
      recordType: String((d.flags.abdm as { recordType?: string } | undefined)?.recordType ?? ''), events: evs.filter((e) => e.documentId === d.id).length,
    })),
  }
}
export type StaffAbdmView = Awaited<ReturnType<typeof staffAbdmView>>

export async function patientAbdmView(db: Tx, patientId: string) {
  const reqs = await db.select().from(abdmConsentRequests).where(eq(abdmConsentRequests.patientId, patientId)).orderBy(desc(abdmConsentRequests.createdAt))
  const xfers = reqs.length ? await db.select({ requestId: abdmTransfers.consentRequestId, docs: abdmTransfers.documentIds, state: abdmTransfers.state })
    .from(abdmTransfers).where(inArray(abdmTransfers.consentRequestId, reqs.map((r) => r.id))) : []
  return reqs.map((r) => ({
    id: r.id, state: r.state, hiTypes: r.hiTypes, from: r.dateFrom, to: r.dateTo, createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null, eraseAt: r.eraseAt.toISOString(),
    documents: xfers.filter((x) => x.requestId === r.id && x.state === 'TRANSFERRED').reduce((n, x) => n + x.docs.length, 0),
  }))
}
export type PatientAbdmRequest = Awaited<ReturnType<typeof patientAbdmView>>[number]
