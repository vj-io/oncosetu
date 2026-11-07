// Recording a signed consent form: the consent itself (same append-only table and rules as always), the signed record, and
// the PDF kept as a document of the patient. DRAFT form, legal review pending.
import { and, desc, eq } from 'drizzle-orm'
import type { Tx } from '@/db'
import { consents, documents, organisations, patients, signedConsents } from '@/db/schema'
import { createHash } from 'node:crypto'
import type { Lang } from '@/core/types'
import { decryptField, encryptField } from '../crypto'
import { storeFile } from '../files'
import { HttpError } from '../http'
import { recordConsent } from '../portal/consent'
import { activeConsent } from '../patients'
import { buildConsentPdf, checkSigner, FORM_VERSION } from './consent-pdf'
import { NOTICE_VERSION } from './privacy'

export type Relation = 'self' | 'guardian' | 'caregiver'
export type SignInput = {
  orgId: string; patientId: string; relation: Relation; signerName: string; method: 'drawn' | 'typed'; signaturePng?: Uint8Array | null
  withdraw: boolean; purposes: { store: boolean; ai: boolean; share: boolean; abdm: boolean; metrics: boolean; team: boolean }
  lang: Lang; actor: { kind: 'patient' | 'caregiver'; id: string }; witness?: { staffId: string; name: string } | null
  /** Staff (desk) signing records the choices as they stand; the portal records them too, as the patient's own act. */
  recordChoices: boolean
}

const LABELS: Record<string, string> = {
  store: 'Care at this hospital: keep and organise my papers',
  ai: 'AI-assisted reading of my papers (a person always checks)',
  share: 'Share my papers with another doctor for a second opinion',
  team: 'My care team may discuss my case together',
  abdm: 'Bring in records from my ABHA health account',
  metrics: 'Include my file in anonymous hospital counts',
}

export async function createSignedConsent(tx: Tx, i: SignInput): Promise<{ id: string; documentId: string; pdf: Uint8Array }> {
  const [p] = await tx.select({ nameEnc: patients.nameEnc, minor: patients.minor }).from(patients).where(eq(patients.id, i.patientId))
  if (!p) throw new HttpError(404, 'not_found', 'Not found')
  const c = checkSigner({ minor: p.minor, relation: i.relation })
  if (!c.ok) throw new HttpError(422, 'guardian_required', c.message)
  if (!i.signerName.trim()) throw new HttpError(400, 'invalid_request', 'The signer name is required')
  if (i.method === 'drawn' && !i.signaturePng?.length) throw new HttpError(400, 'invalid_request', 'Draw a signature or type your name')

  let consentId: string | null = null
  let purposes = i.purposes
  if (i.recordChoices) {
    await recordConsent(tx, { orgId: i.orgId, patientId: i.patientId, actor: i.actor, lang: i.lang }, i.purposes, i.withdraw)
  }
  const [last] = await tx.select({ id: consents.id }).from(consents).where(eq(consents.patientId, i.patientId)).orderBy(desc(consents.recordedAt), desc(consents.id)).limit(1)
  consentId = last?.id ?? null
  if (!i.recordChoices) {
    const a = await activeConsent(tx, i.patientId)
    if (!i.withdraw && !a) throw new HttpError(409, 'no_consent', 'Record the consent first, then sign it')
    purposes = { ...i.purposes, ...(a?.purposes ? { ...a.purposes, team: !!a.purposes.team } : {}) }
  }
  const [org] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, i.orgId))
  const signedAt = new Date()
  const action = i.withdraw ? 'withdraw' : 'grant'
  const pdf = await buildConsentPdf({
    hospital: org?.name ?? 'Hospital', patientName: decryptField(p.nameEnc), signerName: i.signerName.trim(), relation: i.relation, method: i.method,
    signaturePng: i.signaturePng, witnessName: i.witness?.name ?? null, signedAt, noticeVersion: NOTICE_VERSION, action, language: i.lang,
    purposes: Object.entries(LABELS).map(([k, label]) => ({ label, on: !!(purposes as Record<string, boolean>)[k] })),
  })
  const title = action === 'withdraw' ? 'Signed withdrawal of consent' : 'Signed consent form'
  const [doc] = await tx.insert(documents).values({
    orgId: i.orgId, patientId: i.patientId, sha256: createHash('sha256').update(pdf).digest('hex'), mime: 'application/pdf', sizeBytes: pdf.length, filenameEnc: encryptField(`${title}.pdf`),
    intakeRoute: i.witness ? 'desk' : 'patient_link', uploadedByKind: i.witness ? 'staff' : i.actor.kind, uploadedById: i.witness?.staffId ?? i.actor.id,
    receivedAt: signedAt, stage: 'completeness', status: 'done', identityResult: 'match', attachState: 'attached', docType: 'other', pages: 1,
    documentDate: signedAt.toISOString().slice(0, 10), institutionName: org?.name ?? null,
    flags: { file: { kind: 'pdf', category: 'report', label: 'Consent', storedOnly: true, note: `${title} (draft form, legal review pending)` }, consentForm: { version: FORM_VERSION, action } },
  }).returning({ id: documents.id })
  await storeFile(tx, { orgId: i.orgId, patientId: i.patientId, documentId: doc.id, kind: 'original', mime: 'application/pdf', bytes: Buffer.from(pdf) })
  const [row] = await tx.insert(signedConsents).values({
    orgId: i.orgId, patientId: i.patientId, consentId, action, formVersion: FORM_VERSION, signerNameEnc: encryptField(i.signerName.trim()), signerRelation: i.relation,
    method: i.method, witnessStaffId: i.witness?.staffId ?? null, signedAt, language: i.lang, purposes, documentId: doc.id,
  }).returning({ id: signedConsents.id })
  return { id: row.id, documentId: doc.id, pdf }
}

export type SignedRow = { id: string; action: string; formVersion: string; signer: string | null; relation: Relation; method: string; witness: string | null; signedAt: string }

export async function listSignedConsents(tx: Tx, patientId: string): Promise<SignedRow[]> {
  const rows = await tx.select().from(signedConsents).where(eq(signedConsents.patientId, patientId)).orderBy(desc(signedConsents.signedAt))
  return rows.map((r) => ({ id: r.id, action: r.action, formVersion: r.formVersion, signer: r.signerNameEnc ? decryptField(r.signerNameEnc) : null, relation: r.signerRelation as Relation, method: r.method, witness: r.witnessStaffId ? 'desk witness' : null, signedAt: r.signedAt.toISOString() }))
}

/** The PDF bytes of one signed form of this patient (null if none). */
export async function readSignedPdf(tx: Tx, patientId: string, signedId: string): Promise<Uint8Array | null> {
  const [r] = await tx.select({ documentId: signedConsents.documentId }).from(signedConsents).where(and(eq(signedConsents.id, signedId), eq(signedConsents.patientId, patientId)))
  if (!r?.documentId) return null
  const { documentFiles } = await import('@/db/schema')
  const { readFile } = await import('../files')
  const [f] = await tx.select({ id: documentFiles.id }).from(documentFiles).where(and(eq(documentFiles.documentId, r.documentId), eq(documentFiles.kind, 'original'))).limit(1)
  const file = f && (await readFile(tx, f.id))
  return file ? new Uint8Array(file.bytes) : null
}
