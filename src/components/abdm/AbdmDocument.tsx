// Source viewer for an ABDM document (FR-ING-ABDM-02): each fact beside the FHIR resource it was copied from
// (evidence.fhir_resource_ref), instead of a lit quote on a page. Rendered by the documents/[docId] page for intake 'abdm'.
import Link from 'next/link'
import { forbidden, notFound } from 'next/navigation'
import clsx from 'clsx'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { ArrowLeft, Network } from 'lucide-react'
import { Badge, Chip, Placard, SectionHeader, StatusBadge } from '@/components/ui'
import { EVENT_LABEL, FIELD_LABEL, fmtDate, fmtDateTime, shortId } from '@/components/documents/labels'
import { staffDocLabel } from '@/core/copy'
import { resolveRef } from '@/core/fhir'
import type { DocType } from '@/core/types'
import { abdmConsentRequests, documentFiles, documents, events, evidence } from '@/db/schema'
import { eraseDue } from '@/server/abdm/flow'
import { writeAudit } from '@/server/audit'
import { readFile } from '@/server/files'
import { withPatientAccess } from '@/server/registration/page'
import { ShowResource, ViewedOnMount } from './AbdmViewed'

const STATE_LABEL: Record<string, string> = { GRANTED: 'Consent granted', REVOKED: 'Consent revoked', EXPIRED: 'Consent expired', DENIED: 'Declined', REQUESTED: 'Requested' }

export async function AbdmDocument({ patientId, documentId, focusEventId }: { patientId: string; documentId: string; focusEventId: string | null }) {
  const data = await withPatientAccess(patientId, async (tx, session) => {
    if (session.role !== 'records' && session.role !== 'clinician') return { denied: true as const }
    // PRD §10.5 on read: nothing past its artefact's erase-at is shown.
    await eraseDue({
      db: tx, orgId: session.orgId,
      audit: async (action, targetType, targetId, details) => {
        await writeAudit(tx, { orgId: session.orgId, actorId: session.staffId, actorRole: session.role, action, targetType, targetId, details })
      },
    }, patientId)
    const [doc] = await tx.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.patientId, patientId), eq(documents.intakeRoute, 'abdm')))
    if (!doc) return null
    const [file] = await tx.select({ id: documentFiles.id }).from(documentFiles).where(and(eq(documentFiles.documentId, doc.id), eq(documentFiles.kind, 'original')))
    const bundle: unknown = file ? JSON.parse((await readFile(tx, file.id))!.bytes.toString('utf8')) : null
    const evs = await tx.select().from(events).where(eq(events.documentId, doc.id)).orderBy(asc(events.createdAt))
    const ev = evs.length ? await tx.select().from(evidence).where(inArray(evidence.eventId, evs.map((e) => e.id))) : []
    const meta = (doc.flags.abdm ?? {}) as { consentRequestId?: string; recordType?: string; careContextReference?: string }
    const [req] = meta.consentRequestId ? await tx.select().from(abdmConsentRequests).where(eq(abdmConsentRequests.id, meta.consentRequestId)) : []
    return {
      doc, bundle, meta, req: req ? { state: req.state, eraseAt: req.eraseAt.toISOString(), hipId: req.artefact?.hipId ?? null } : null,
      facts: evs.map((e) => {
        const refs = ev.filter((x) => x.eventId === e.id && x.fhirResourceRef).map((x) => ({ ref: x.fhirResourceRef!, hash: x.quoteSha256 }))
        return { e, refs, resources: refs.map((r) => ({ ...r, json: resolveRef(bundle, r.ref) })) }
      }),
    }
  })
  if (data && 'denied' in data) forbidden()
  if (!data) notFound()
  const { doc, meta, req, facts, bundle } = data
  const title = staffDocLabel((doc.docType ?? 'other') as DocType)
  const live = facts.filter((f) => !f.e.withdrawnAt)
  const focus = focusEventId && live.some((f) => f.e.id === focusEventId) ? focusEventId : null

  return (
    <div className="grid gap-10 py-8 [&>*]:min-w-0">
      <Link href={`/patients/${patientId}/documents`} className="inline-flex w-fit items-center gap-1.5 text-sm underline underline-offset-4 hover:text-setu-ink">
        <ArrowLeft aria-hidden className="size-4" /> Document index
      </Link>
      <SectionHeader
        as="h2"
        kicker={`Source viewer · ACC. ${shortId(doc.id)}`}
        title={<>{title}{doc.institutionName ? <span className="text-muted"> · {doc.institutionName}</span> : null}</>}
        description={`${doc.documentDate ? `Document date ${fmtDate(doc.documentDate)}` : 'No document date'} · received ${fmtDateTime(doc.receivedAt.toISOString())} · FHIR ${meta.recordType ?? 'bundle'}${meta.careContextReference ? ` · care context ${meta.careContextReference}` : ''}`}
        actions={
          <>
            <Chip tone="setu" icon={<Network aria-hidden />}>ABDM · structured</Chip>
            {req && <Badge tone={req.state === 'GRANTED' ? 'verified' : 'shadow'}>{STATE_LABEL[req.state] ?? req.state}</Badge>}
          </>
        }
      />
      <div className="grid gap-1.5 border border-l-[3px] border-rule border-l-setu bg-surface px-4 py-3 text-[15px]">
        <p className="font-medium text-setu-ink">Structured source: copied from FHIR resources, not read from a page</p>
        <p className="text-muted">
          Received through ABDM{req?.hipId ? ` from ${req.hipId}` : ''}, decrypted only after the consent artefact was checked. Each fact names the resource it
          came from; nothing is inferred (no stage, grade, response or dose). This record is erased {req ? `on ${fmtDateTime(req.eraseAt)}` : 'when its consent ends'} or
          as soon as the patient revokes the consent.
        </p>
      </div>
      {focus && <ViewedOnMount eventId={focus} />}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] [&>*]:min-w-0">
        <section aria-labelledby="facts-h" className="grid content-start gap-4">
          <h2 id="facts-h" className="ds-kicker">Facts on exhibit · {live.length}</h2>
          {facts.map(({ e, refs }, i) => {
            const fields = Object.entries(e.fields).filter(([k]) => k !== 'event_date_text' && k !== 'institution_name')
            const v = (k: string) => (Array.isArray(e.fields[k]) ? (e.fields[k] as string[]).join(', ') : e.fields[k] != null ? String(e.fields[k]) : '')
            return (
              <div key={e.id} id={`ev-${e.id}`} className="scroll-mt-24">
                <Placard
                  animate delay={120 + i * 70}
                  className={clsx(focus === e.id && 'outline-2 outline-offset-4 outline-brass', e.withdrawnAt && 'opacity-60')}
                  kicker={EVENT_LABEL[e.eventType] ?? e.eventType}
                  status={e.withdrawnAt ? <Badge tone="shadow">Withdrawn</Badge> : <StatusBadge status={e.verificationStatus as 'unverified'} />}
                  title={v('procedure_text') || v('medication_names') || v('test_name') || v('doctor_name') || EVENT_LABEL[e.eventType] || e.eventType}
                  what={fields.length ? (
                    <span className="grid gap-0.5">
                      {fields.map(([k, x]) => <span key={k}><span className="text-muted">{FIELD_LABEL[k] ?? k}:</span> {Array.isArray(x) ? x.join(', ') : String(x)}</span>)}
                    </span>
                  ) : undefined}
                  where={
                    <span className="grid gap-1">
                      <span className="text-muted">FHIR resource{e.fields.institution_name ? ` · ${String(e.fields.institution_name)}` : ''}</span>
                      {refs.map((r) => <code key={r.ref} className="font-mono text-[13px] break-all text-ink">{r.ref}</code>)}
                    </span>
                  }
                  who={e.verificationStatus === 'unverified' ? 'Not yet verified by a person' : e.verificationStatus.replace(/_/g, ' ')}
                  when={<span>{e.eventDate ? fmtDate(e.eventDate) : 'No date in the resource'}{e.fields.event_date_text ? <span className="text-muted"> (FHIR “{String(e.fields.event_date_text)}”)</span> : null}</span>}
                  accession={shortId(e.id)}
                  footer={
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Chip kicker="Source" tone="setu">ABDM record</Chip>
                      <Chip kicker="Method" tone="neutral">Structured</Chip>
                      {!e.withdrawnAt && <ShowResource eventId={e.id} />}
                    </span>
                  }
                />
              </div>
            )
          })}
        </section>

        <section aria-labelledby="res-h" className="grid content-start gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
          <h2 id="res-h" className="ds-kicker">Source resources · FHIR R4 JSON as received</h2>
          {facts.map(({ e, resources }) => resources.map((r) => (
            <article key={`${e.id}:${r.ref}`} id={`r-${e.id}`} className={clsx('scroll-mt-24 border bg-matte shadow-frame', focus === e.id ? 'border-brass outline-2 outline-brass' : 'border-rule')}>
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-rule bg-surface px-4 py-2">
                <span className="font-mono text-[11px] tracking-[0.12em] break-all text-faint uppercase">{r.ref}</span>
                <span className="font-mono text-[11px] text-faint" title="SHA-256 of the canonical resource JSON (stored as the evidence hash)">#{r.hash?.slice(0, 10)}</span>
              </header>
              <pre className="max-h-80 overflow-auto p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-words">{r.json ? JSON.stringify(r.json, null, 2) : 'Resource not found in the bundle.'}</pre>
            </article>
          )))}
          <details className="border border-rule bg-surface p-4">
            <summary className="cursor-pointer text-sm font-medium">Whole bundle · {doc.mime} · {(doc.sizeBytes / 1024).toFixed(0)} KB · sha256 {doc.sha256.slice(0, 12)}…</summary>
            <pre className="mt-3 max-h-[32rem] overflow-auto font-mono text-[12px] whitespace-pre-wrap break-words">{JSON.stringify(bundle, null, 2)}</pre>
          </details>
        </section>
      </div>
    </div>
  )
}
