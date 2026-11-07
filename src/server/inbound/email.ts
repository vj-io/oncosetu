// Email drop (FR-ING-04, V05-E2E-07). Called by POST /api/inbound/email after the Basic-auth check. The recipient
// `<alias_token>@INBOUND_EMAIL_DOMAIN` names the patient; the sender must be an address staff verified in person for
// that patient or one of its active caregivers, else nothing is stored. Each attachment goes through ingestDocument
// (intakeRoute 'email') and processing starts after the response. The body, subject and headers are never stored.
// POOL RULE: the two public lookups run before the one withOrg() transaction.
import { sql } from 'drizzle-orm'
import { db, withOrg } from '@/db'
import { writeAudit } from '../audit'
import { hmac } from '../crypto'
import { HttpError } from '../http'
import { log } from '../log'
import { activeConsent } from '../patients'
import { ingestDocument, scheduleProcessing, type DocStatus, type IntakeProvider } from '../pipeline/ingest'
import { aliasTokensOf, attachmentsOf, senderOf, type PostmarkPayload } from './postmark'
import { inboundDomain } from './staff'

export type EmailOutcome =
  | { accepted: true; documents: { documentId: string; status: DocStatus; duplicateOf?: string }[]; skipped: { index: number; reason: string }[] }
  | { accepted: false; reason: 'unknown_recipient' | 'ambiguous_recipient' | 'unregistered_sender' | 'no_consent' | 'no_attachments' }

/** The email drop as an intake channel. The route has already refused the request when INBOUND_EMAIL_DOMAIN is unset. */
export const emailIntake: IntakeProvider<PostmarkPayload, EmailOutcome> = {
  route: 'email',
  receive: (p, requestId) => {
    const domain = inboundDomain()
    if (!domain) throw new Error('INBOUND_EMAIL_DOMAIN is not set')
    return receiveEmail(p, domain, requestId)
  },
}

export async function receiveEmail(p: PostmarkPayload, domain: string, requestId: string): Promise<EmailOutcome> {
  const tokens = aliasTokensOf(p, domain)
  const alias = tokens.length === 1
    ? (await db.execute<{ patient_id: string; org_id: string }>(sql`select * from resolve_inbound_alias(${tokens[0]})`))[0]
    : undefined
  if (!alias) {
    log.info('inbound.email_unrouted', { requestId, recipients: tokens.length })
    return { accepted: false, reason: tokens.length > 1 ? 'ambiguous_recipient' : 'unknown_recipient' }
  }
  const sender = senderOf(p)
  const contact = sender
    ? (await db.execute<{ contact_id: string; patient_id: string; caregiver_id: string | null }>(sql`select * from resolve_contact_email(${hmac(sender)})`))
      .find((c) => c.patient_id === alias.patient_id)
    : undefined
  const orgId = alias.org_id, patientId = alias.patient_id
  const atts = attachmentsOf(p)

  const out = await withOrg(orgId, async (tx): Promise<EmailOutcome> => {
    const reject = async (reason: Extract<EmailOutcome, { accepted: false }>['reason']) => {
      await writeAudit(tx, { orgId, actorId: null, actorRole: 'system', action: 'inbound.email_rejected', targetType: 'patient', targetId: patientId, requestId, details: { reason, attachments: atts.length } })
      return { accepted: false as const, reason }
    }
    if (!contact) return reject('unregistered_sender')
    if (!(await activeConsent(tx, patientId))?.purposes.store) return reject('no_consent')
    const uploadedBy = contact.caregiver_id ? { kind: 'caregiver' as const, id: contact.caregiver_id } : { kind: 'patient' as const, id: patientId }
    const skipped = atts.flatMap((a) => ('reason' in a ? [{ index: a.index, reason: a.reason as string }] : []))
    const documents: Extract<EmailOutcome, { accepted: true }>['documents'] = []
    for (const a of atts) {
      if ('reason' in a) continue
      try {
        const r = await ingestDocument(tx, { orgId, patientId, uploadedBy, intakeRoute: 'email', fileName: a.name, bytes: a.bytes })
        documents.push({ documentId: r.documentId, status: r.status, ...(r.duplicateOf ? { duplicateOf: r.duplicateOf } : {}) })
      } catch (e) {
        if (!(e instanceof HttpError)) throw e // refused before anything was written (type, size), so the transaction is intact
        skipped.push({ index: a.index, reason: e.code })
      }
    }
    if (!documents.length) return reject('no_attachments')
    await writeAudit(tx, {
      orgId, actorId: uploadedBy.id, actorRole: uploadedBy.kind, action: 'inbound.email_received', targetType: 'patient', targetId: patientId, requestId,
      details: { contactId: contact.contact_id, documents: documents.map((d) => d.documentId), skipped: skipped.length },
    })
    return { accepted: true, documents, skipped }
  })
  if (out.accepted) for (const d of out.documents) if (!d.duplicateOf && d.status === 'queued') scheduleProcessing(d.documentId, orgId)
  return out
}
