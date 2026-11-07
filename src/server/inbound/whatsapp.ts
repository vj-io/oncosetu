// WhatsApp intake (FR-ING-05, "matched by registered phone + OTP"). Called by POST /api/inbound/whatsapp after the
// Twilio signature check. The sender's number must be the registered phone of exactly ONE patient record (phoneLogins:
// caregiver-primary and minor rules apply), else nothing is stored. Media are HELD (inbound_hold_files, encrypted; no
// documents row) until the sender replies with the one-time code sent over WhatsApp; the release turns them into
// documents (ingestDocument, intakeRoute 'whatsapp') and starts processing. Replies are TwiML text from src/i18n/inbound.ts.
// POOL RULE: phoneLogins and the media downloads run before any transaction; each branch is one withOrg().
import { and, asc, count, eq, isNull, lte, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { withOrg, type Tx } from '@/db'
import { inboundHoldFiles, inboundHolds, patients } from '@/db/schema'
import { brandFor } from '@/core/copy'
import { inboundCopy } from '@/i18n/inbound'
import { writeAudit, type AuditDetails } from '../audit'
import { decryptBytes, encryptBytes, phoneHmac } from '../crypto'
import { HttpError } from '../http'
import { log } from '../log'
import { phoneLogins, startOtp, type PhoneLogin } from '../otp'
import { sendMessage } from '../outbox'
import { activeConsent } from '../patients'
import { ingestDocument, scheduleProcessing, type IntakeProvider } from '../pipeline/ingest'
import { MAX_FILE_BYTES, sniffMime } from '../pipeline/safety'
import { codeIn, evaluateHoldReply, HOLD_TTL_MS, holdCodeHash, MAX_FILES } from './hold'
import { mediaOf } from './twilio'

const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' }
const both = (c: { en: string; hi: string }) => `${c.en}\n${c.hi}` // language unknown: no record matched

/**
 * Twilio media live on api.twilio.com (then redirect to its CDN). Any http(s) host outside production, for tests.
 * `INBOUND_MEDIA_TEST_HOSTS` (comma-separated hostnames) lets an E2E run against a local production build serve media from
 * its own test server; never set it on a deployment (it widens what the server will fetch).
 */
export function mediaUrlAllowed(url: string, production = process.env.NODE_ENV === 'production', testHosts = process.env.INBOUND_MEDIA_TEST_HOSTS ?? ''): boolean {
  let u: URL
  try { u = new URL(url) } catch { return false }
  if (!production) return u.protocol === 'https:' || u.protocol === 'http:'
  if (testHosts.split(',').map((h) => h.trim()).filter(Boolean).includes(u.hostname)) return u.protocol === 'https:' || u.protocol === 'http:'
  return u.protocol === 'https:' && (u.hostname === 'api.twilio.com' || u.hostname.endsWith('.twilio.com'))
}

async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Buffer | null> {
  if (!body) return Buffer.alloc(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return Buffer.concat(chunks)
    total += value.length
    if (total > max) { await reader.cancel(); return null }
    chunks.push(value)
  }
}

type Media = { ok: true; bytes: Buffer; mime: string } | { ok: false; reason: string }

/** Downloads one media item with Twilio basic auth (when the account SID is set); ≤ 4 MB, sniffed type only. */
export async function fetchMedia(m: { url: string; contentType: string }): Promise<Media> {
  if (!ALLOWED_TYPES.has(m.contentType)) return { ok: false, reason: 'unsupported_type' } // voice notes, video: not fetched
  if (!mediaUrlAllowed(m.url)) return { ok: false, reason: 'media_url' }
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN
  let res: Response
  try {
    res = await fetch(m.url, {
      headers: sid && token ? { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` } : {},
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return { ok: false, reason: 'media_fetch' }
  }
  if (!res.ok || Number(res.headers.get('content-length') ?? 0) > MAX_FILE_BYTES) {
    await res.body?.cancel().catch(() => {})
    return { ok: false, reason: res.ok ? 'file_too_large' : 'media_fetch' }
  }
  const bytes = await readCapped(res.body, MAX_FILE_BYTES).catch(() => undefined)
  if (bytes === undefined) return { ok: false, reason: 'media_fetch' }
  if (bytes === null) return { ok: false, reason: 'file_too_large' }
  const mime = bytes.length ? sniffMime(bytes) : null
  return mime ? { ok: true, bytes, mime } : { ok: false, reason: bytes.length ? 'unsupported_type' : 'empty_file' }
}

type Sender = PhoneLogin & { phone: string; senderHmac: string; requestId: string }

const actor = (s: Sender) => (s.caregiverId ? { actorId: s.caregiverId, actorRole: 'caregiver' } : { actorId: s.patientId, actorRole: 'patient' })
const audit = (tx: Tx, s: Sender, action: string, targetType: string, targetId: string, details: AuditDetails = {}) =>
  writeAudit(tx, { orgId: s.orgId, ...actor(s), action, targetType, targetId, requestId: s.requestId, details })

/** Open hold of this sender for this patient, row-locked. */
const openHold = (tx: Tx, s: Sender) => tx.select().from(inboundHolds)
  .where(and(eq(inboundHolds.patientId, s.patientId), eq(inboundHolds.channel, 'whatsapp'), eq(inboundHolds.senderHmac, s.senderHmac), isNull(inboundHolds.releasedAt)))
  .for('update').then((r) => r[0])

/** The webhook body → the reply text. Never throws for sender mistakes; DB errors propagate (500, Twilio retries). */
export async function receiveWhatsApp(p: URLSearchParams, requestId: string): Promise<string> {
  const phone = (p.get('From') ?? '').replace(/^whatsapp:/i, '')
  const h = phoneHmac(phone)
  const logins = h ? await phoneLogins(h) : []
  if (!h || logins.length !== 1) {
    log.info('inbound.whatsapp_unmatched', { requestId, matches: logins.length })
    return both(inboundCopy.useUploadLink)
  }
  const s: Sender = { ...logins[0], phone, senderHmac: h, requestId }
  const lang = s.preferredLanguage
  const media = mediaOf(p)
  if (media.length) {
    const got = await Promise.all(media.map(fetchMedia)) // network first: no pooled connection is held meanwhile
    return withOrg(s.orgId, (tx) => holdMedia(tx, s, got))
  }
  const code = codeIn(p.get('Body') ?? '')
  if (!code) return inboundCopy.nothingWaiting[lang]
  const r = await withOrg(s.orgId, (tx) => replyWithCode(tx, s, code))
  for (const id of r.process) scheduleProcessing(id, s.orgId)
  return r.reply
}

export const whatsappIntake: IntakeProvider<URLSearchParams, string> = { route: 'whatsapp', receive: receiveWhatsApp }

async function brandOf(tx: Tx, patientId: string) {
  const [pt] = await tx.select({ d: patients.disclosureStatus }).from(patients).where(eq(patients.id, patientId))
  return brandFor(pt?.d ?? 'unknown')
}

/** Lock order in every branch: expired hold rows → the open hold → the org's audit lock (writeAudit), so parallel webhooks never deadlock. */
async function holdMedia(tx: Tx, s: Sender, got: Media[]): Promise<string> {
  const lang = s.preferredLanguage
  const ok = got.filter((g): g is Extract<Media, { ok: true }> => g.ok)
  const reasons = got.flatMap((g) => (g.ok ? [] : [g.reason]))
  if (!(await activeConsent(tx, s.patientId))?.purposes.store) {
    await audit(tx, s, 'inbound.whatsapp_rejected', 'patient', s.patientId, { reason: 'no_consent', files: got.length })
    return inboundCopy.notAccepted[lang]
  }
  if (!ok.length) {
    await audit(tx, s, 'inbound.whatsapp_rejected', 'patient', s.patientId, { reason: 'bad_files', files: got.length, reasons })
    return inboundCopy.badFiles[lang]
  }
  const now = new Date()
  const expired = await tx.delete(inboundHolds).where(and(
    eq(inboundHolds.patientId, s.patientId), eq(inboundHolds.channel, 'whatsapp'), eq(inboundHolds.senderHmac, s.senderHmac),
    isNull(inboundHolds.releasedAt), lte(inboundHolds.expiresAt, now))).returning({ id: inboundHolds.id })
  const newId = uuidv7()
  // A forwarded album arrives as parallel webhooks: the partial unique index makes them share one hold (and one code).
  const inserted = await tx.execute(sql`
    INSERT INTO inbound_holds (id, org_id, patient_id, channel, sender_hmac, expires_at)
    VALUES (${newId}, ${s.orgId}, ${s.patientId}, 'whatsapp', ${s.senderHmac}, ${new Date(now.getTime() + HOLD_TTL_MS).toISOString()})
    ON CONFLICT (patient_id, channel, sender_hmac) WHERE released_at IS NULL DO NOTHING RETURNING id`)
  const created = (inserted as unknown as unknown[]).length > 0
  const brand = await brandOf(tx, s.patientId)
  let holdId = newId
  if (created) {
    const issued = await startOtp(s.senderHmac, 'inbound_whatsapp') // shares the per-phone SMS budget (3 / 10 min, 10 / day)
    if (!issued) {
      await tx.delete(inboundHolds).where(eq(inboundHolds.id, newId))
      for (const e of expired) await audit(tx, s, 'inbound.hold_expired', 'inbound_hold', e.id)
      await audit(tx, s, 'inbound.whatsapp_rejected', 'patient', s.patientId, { reason: 'code_limit', files: got.length })
      return inboundCopy.useUploadLink[lang]
    }
    await tx.update(inboundHolds).set({ codeHash: holdCodeHash(newId, issued.code) }).where(eq(inboundHolds.id, newId))
    await sendMessage(tx, {
      orgId: s.orgId, patientId: s.patientId, toPhone: s.phone, channel: 'whatsapp', templateKey: 'inbound.whatsapp_code',
      body: inboundCopy.code[lang](brand, issued.code), lang,
    })
  } else {
    const h = await openHold(tx, s)
    if (!h) throw new Error('inbound hold vanished') // only a concurrent release/discard between the two statements
    holdId = h.id
  }
  const [{ n }] = await tx.select({ n: count() }).from(inboundHoldFiles).where(eq(inboundHoldFiles.holdId, holdId))
  const take = ok.slice(0, Math.max(0, MAX_FILES - n))
  for (const f of take) {
    const { bytes, dekWrapped } = encryptBytes(f.bytes)
    await tx.insert(inboundHoldFiles).values({ orgId: s.orgId, patientId: s.patientId, holdId, mime: f.mime, bytesEnc: bytes, dekWrapped, size: f.bytes.length })
  }
  for (const e of expired) await audit(tx, s, 'inbound.hold_expired', 'inbound_hold', e.id)
  await audit(tx, s, 'inbound.whatsapp_held', 'inbound_hold', holdId, {
    patientId: s.patientId, files: take.length, skipped: got.length - take.length, newHold: created,
  })
  if (!take.length) return inboundCopy.notAccepted[lang] // the hold already has MAX_FILES files
  return created ? inboundCopy.held[lang](brand, take.length) : inboundCopy.heldMore[lang](brand, take.length)
}

async function replyWithCode(tx: Tx, s: Sender, code: string): Promise<{ reply: string; process: string[] }> {
  const lang = s.preferredLanguage
  const h = await openHold(tx, s)
  const d = evaluateHoldReply(h, code, new Date())
  if (d.kind === 'none') return { reply: inboundCopy.nothingWaiting[lang], process: [] }
  const hold = h!
  if (d.kind === 'expired') {
    await tx.delete(inboundHolds).where(eq(inboundHolds.id, hold.id))
    await audit(tx, s, 'inbound.hold_expired', 'inbound_hold', hold.id)
    return { reply: inboundCopy.expired[lang], process: [] }
  }
  if (d.kind === 'wrong') {
    await tx.update(inboundHolds).set({ attempts: d.attempts }).where(eq(inboundHolds.id, hold.id))
    await audit(tx, s, 'inbound.hold_code_wrong', 'inbound_hold', hold.id, { attempts: d.attempts })
    return { reply: inboundCopy.wrongCode[lang](d.left), process: [] }
  }
  if (d.kind === 'discard' || !(await activeConsent(tx, s.patientId))?.purposes.store) {
    await tx.delete(inboundHolds).where(eq(inboundHolds.id, hold.id)) // files cascade: never stored as documents
    await audit(tx, s, 'inbound.hold_discarded', 'inbound_hold', hold.id, { reason: d.kind === 'discard' ? 'attempts' : 'no_consent' })
    return { reply: d.kind === 'discard' ? inboundCopy.discarded[lang] : inboundCopy.notAccepted[lang], process: [] }
  }
  // Release: each held file becomes a document now (dedupe, safety scan, encrypted store), then processing starts.
  const files = await tx.select().from(inboundHoldFiles).where(eq(inboundHoldFiles.holdId, hold.id)).orderBy(asc(inboundHoldFiles.createdAt))
  const uploadedBy = s.caregiverId ? { kind: 'caregiver' as const, id: s.caregiverId } : { kind: 'patient' as const, id: s.patientId }
  const documentIds: string[] = [], process: string[] = []
  let skipped = 0
  for (const [i, f] of files.entries()) {
    try {
      const r = await ingestDocument(tx, {
        orgId: s.orgId, patientId: s.patientId, uploadedBy, intakeRoute: 'whatsapp', fileName: `whatsapp-${i + 1}.${EXT[f.mime] ?? 'bin'}`,
        mime: f.mime, bytes: new Uint8Array(decryptBytes(Buffer.from(f.bytesEnc), f.dekWrapped)),
      })
      documentIds.push(r.documentId)
      if (!r.duplicateOf && r.status === 'queued') process.push(r.documentId)
    } catch (e) {
      if (!(e instanceof HttpError)) throw e // refused before anything was written (type, size), so the transaction is intact
      skipped++
    }
  }
  await tx.update(inboundHolds).set({ releasedAt: new Date(), documentIds }).where(eq(inboundHolds.id, hold.id))
  await tx.delete(inboundHoldFiles).where(eq(inboundHoldFiles.holdId, hold.id))
  await audit(tx, s, 'inbound.hold_released', 'inbound_hold', hold.id, { patientId: s.patientId, documents: documentIds, skipped })
  return { reply: inboundCopy.released[lang](await brandOf(tx, s.patientId), documentIds.length), process }
}

/** Cron + backstop: drops every expired, unreleased hold of one org (files cascade). Returns the hold ids. */
export async function sweepExpiredHolds(tx: Tx, orgId: string, requestId: string): Promise<string[]> {
  const gone = await tx.delete(inboundHolds).where(and(isNull(inboundHolds.releasedAt), lte(inboundHolds.expiresAt, new Date())))
    .returning({ id: inboundHolds.id, patientId: inboundHolds.patientId })
  for (const g of gone) {
    await writeAudit(tx, { orgId, actorId: null, actorRole: 'system', action: 'inbound.hold_expired', targetType: 'inbound_hold', targetId: g.id, requestId, details: { patientId: g.patientId } })
  }
  return gone.map((g) => g.id)
}
