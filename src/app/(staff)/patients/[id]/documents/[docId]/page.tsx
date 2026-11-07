import Link from 'next/link'
import { forbidden, notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { ArrowLeft, CopyCheck, FileWarning, Hand, KeyRound, Languages, PenLine, ScanText, ShieldAlert, Unlink } from 'lucide-react'
import { AbdmDocument } from '@/components/abdm/AbdmDocument'
import { DetachForm, LiveStage, ManualEventForm, PasswordForm, ReprocessButton, TagForm } from '@/components/documents/DocumentTools'
import { IdentityDecision } from '@/components/documents/IdentityDecision'
import { fmtDate, fmtDateTime, identityReasonText, shortId, statusBadge } from '@/components/documents/labels'
import { ImagingViewer, type ImagingDetails } from '@/components/documents/ImagingViewer'
import { PdfPages, SourceViewer } from '@/components/documents/SourceViewer'
import { Badge, Frame, KeyValue, SectionHeader, StatusBadge, Table, type Tone } from '@/components/ui'
import { staffDocLabel } from '@/core/copy'
import type { DocType } from '@/core/types'
import { loadPatient } from '@/server/patients'
import { documentDetail } from '@/server/pipeline/queries'
import { withPatientAccess } from '@/server/registration/page'

type Header = Record<string, { value: string; label?: string } | number | null | undefined>

function Notice({ tone, icon, title, children }: { tone: Tone; icon: ReactNode; title: ReactNode; children?: ReactNode }) {
  const bar = { conflict: 'border-l-madder', unverified: 'border-l-amber', setu: 'border-l-setu', shadow: 'border-l-slate', patient: 'border-l-violet', verified: 'border-l-sage', neutral: 'border-l-control', brass: 'border-l-brass' }[tone]
  const ink = { conflict: 'text-madder-ink', unverified: 'text-amber-ink', setu: 'text-setu-ink', shadow: 'text-slate-ink', patient: 'text-violet-ink', verified: 'text-sage-ink', neutral: 'text-ink', brass: 'text-brass-ink' }[tone]
  return (
    <div className={`grid gap-1.5 border border-l-[3px] border-rule bg-surface px-4 py-3 ${bar}`}>
      <p className={`flex items-center gap-2 font-medium ${ink} [&_svg]:size-4`}>{icon}{title}</p>
      {children && <div className="text-[15px] text-muted">{children}</div>}
    </div>
  )
}

export default async function DocumentSourcePage({ params, searchParams }: { params: Promise<{ id: string; docId: string }>; searchParams: Promise<{ event?: string }> }) {
  const [{ id, docId }, { event }] = await Promise.all([params, searchParams])
  const data = await withPatientAccess(id, async (tx, session) => {
    if (session.role !== 'records' && session.role !== 'clinician') return { denied: true as const }
    if (!/^[0-9a-f-]{36}$/i.test(docId)) return null
    const [detail, patient] = await Promise.all([documentDetail(tx, id, docId), loadPatient(tx, id)])
    return detail && patient ? { detail, patient } : null
  })
  if (data && 'denied' in data) forbidden()
  if (!data) notFound()
  const { detail: d, patient } = data
  const doc = d.doc
  if (doc.intakeRoute === 'abdm') return <AbdmDocument patientId={id} documentId={doc.id} focusEventId={event ?? null} /> // FHIR source, not pages
  const imgFlags = doc.flags.imaging as { studyLabel?: string; modalityLabel?: string } | undefined
  const fileLabel = (doc.flags.file as { label?: string; storedOnly?: boolean } | undefined)
  const title = imgFlags ? (imgFlags.studyLabel ?? imgFlags.modalityLabel ?? 'Imaging file') : fileLabel?.storedOnly ? `${fileLabel.label} file` : doc.docType ? staffDocLabel(doc.docType as DocType) : doc.status === 'quarantined' ? 'Quarantined file' : 'Document'
  const b = statusBadge(d.status)
  const header = ((doc.identityDetails as { header?: Header } | null)?.header ?? {}) as Header
  const idDetails = (doc.identityDetails ?? {}) as { reasons?: string[]; notes?: string[]; score?: number }
  const flags = doc.flags as Record<string, unknown>
  const injection = flags.injection as { patterns: string[]; hiddenChars: number; hiddenPages: number[] } | undefined
  const hidden = ((doc.quality as { hidden?: { pageNo: number; text: string }[] } | null)?.hidden ?? [])
  const gate = flags.gate as { candidates: number; accepted: number; kept: number; rejected: number; reasons: Record<string, number> } | undefined
  const erratum = flags.erratum as { detachedAt: string; reason: string; withdrawnEventIds: string[]; sealedSnapshots: { seq: number }[] } | undefined
  const nearDup = flags.near_duplicate as { of: string; method: string; similarity?: number } | undefined
  const quarantine = flags.quarantine as { reasons: string[]; scan: string } | undefined
  const attached = doc.attachState === 'auto' || doc.attachState === 'attached'
  const fileInfo = flags.file as { kind?: string; category?: string; label?: string; storedOnly?: boolean; note?: string; previewNote?: string } | undefined
  const imaging = flags.imaging as (ImagingDetails & { modalityLabel?: string; studyLabel?: string }) | undefined
  const storedOnly = !!fileInfo?.storedOnly
  const live = d.status === 'queued' || d.status === 'processing'
  const v = (k: string) => (header[k] && typeof header[k] === 'object' ? (header[k] as { value: string }).value : null)
  const pageNos = d.pages.filter((p) => p.text.trim()).map((p) => p.pageNo)

  return (
    <div className="grid gap-10 py-8 [&>*]:min-w-0">
      <Link href={`/patients/${id}/documents`} className="inline-flex w-fit items-center gap-1.5 text-sm underline underline-offset-4 hover:text-setu-ink">
        <ArrowLeft aria-hidden className="size-4" /> All documents
      </Link>

      <SectionHeader
        as="h2"
        kicker={`Document · ACC. ${shortId(doc.id)}`}
        title={<>{title}{doc.institutionName ? <span className="text-muted"> · {doc.institutionName}</span> : null}</>}
        description={`${doc.documentDate ? `Document date ${fmtDate(doc.documentDate)}` : 'No document date found'} · received ${fmtDateTime(doc.receivedAt.toISOString())}${doc.pages ? ` · ${doc.pages} page${doc.pages > 1 ? 's' : ''}` : ''}`}
        actions={
          <>
            <StatusBadge status={b.status} label={b.label} />
            {doc.identityResult !== 'pending' && <StatusBadge status={doc.identityResult} />}
            {doc.status !== 'quarantined' && !live && <ReprocessButton documentId={doc.id} />}
          </>
        }
      />

      {(live || doc.attachState === 'pending_decision' || d.status === 'failed') && (
        <Frame matte><div className="p-2"><LiveStage documentId={doc.id} initial={{ status: d.status, stages: d.stages }} /></div></Frame>
      )}

      {/* Notices: what the pipeline did with this file */}
      <div className="grid gap-3 empty:hidden">
        {quarantine && (
          <Notice tone="conflict" icon={<ShieldAlert />} title="Quarantined — never processed or opened">
            Found: {quarantine.reasons.join(', ').replace(/_/g, ' ')}. The original is stored encrypted for audit. ({quarantine.scan})
          </Notice>
        )}
        {injection && (
          <Notice tone="conflict" icon={<ShieldAlert />} title={`Hidden text removed before reading${injection.patterns.length ? ` · ${injection.patterns.join(', ').replace(/_/g, ' ')}` : ''}`}>
            {injection.hiddenChars > 0 ? `${injection.hiddenChars} characters of invisible text (white or under 2 pt) on page ${injection.hiddenPages.join(', ')} were stripped. ` : 'Instruction-like wording was found in the visible text. '}
            Nothing written inside a document can confirm a fact or change anything, and every fact still needs its exact words from the visible text.
            {hidden.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm underline underline-offset-4">Show the removed text</summary>
                {hidden.map((h) => <pre key={h.pageNo} className="mt-2 border border-dashed border-madder bg-madder-tint/40 p-3 font-mono text-[13px] whitespace-pre-wrap text-madder-ink">p.{h.pageNo}: {h.text}</pre>)}
              </details>
            )}
          </Notice>
        )}
        {doc.handwritten && (
          <Notice tone="unverified" icon={<Hand />} title="Handwritten — stored as an image only">
            Handwriting is never machine-extracted (no OCR text is kept, so no facts can be quoted). Tag the document type, date and institution below.
          </Notice>
        )}
        {doc.lowConfidence && !doc.handwritten && (
          <Notice tone="unverified" icon={<ScanText />} title="Low OCR confidence on at least one page">
            Facts from these pages show the image beside the quote and cannot be bulk-verified.
          </Notice>
        )}
        {nearDup && (
          <Notice tone="unverified" icon={<CopyCheck />} title="Possible duplicate of a file already here">
            {nearDup.method === 'dhash' ? 'The image looks like a re-photograph' : `The text is ${Math.round((nearDup.similarity ?? 0) * 100)}% the same`} of{' '}
            <Link className="underline" href={`/patients/${id}/documents/${nearDup.of}`}>{d.related[nearDup.of]?.docType ? staffDocLabel(d.related[nearDup.of].docType as DocType) : 'another document'}</Link>. A person confirms.
          </Notice>
        )}
        {doc.amendmentOf && (
          <Notice tone="setu" icon={<PenLine />} title="Amendment / addendum">
            Same accession as{' '}
            <Link className="underline" href={`/patients/${id}/documents/${doc.amendmentOf}`}>
              {d.related[doc.amendmentOf]?.docType ? staffDocLabel(d.related[doc.amendmentOf].docType as DocType) : 'the original report'} of {fmtDate(d.related[doc.amendmentOf]?.documentDate ?? null)}
            </Link>; the ledger shows it as “Amended”.
          </Notice>
        )}
        {Boolean(flags.language_unsupported) && <Notice tone="shadow" icon={<Languages />} title="Language not supported by OCR — stored as an image" />}
        {d.status === 'needs_password' && (
          <Notice tone="unverified" icon={<KeyRound />} title="This PDF is password-protected">
            <div className="mt-2 max-w-sm"><PasswordForm documentId={doc.id} incorrect={!!flags.password_incorrect} /></div>
          </Notice>
        )}
        {d.status === 'unreadable' && !flags.password_required && <Notice tone="conflict" icon={<FileWarning />} title="The file could not be read">Reason: {String(flags.unreadable_reason ?? doc.lastError ?? 'unknown').replace(/_/g, ' ')}.</Notice>}
        {erratum && (
          <Notice tone="conflict" icon={<Unlink />} title={`Detached ${fmtDateTime(erratum.detachedAt)} · ${erratum.withdrawnEventIds.length} fact(s) withdrawn`}>
            Reason: {erratum.reason}. {erratum.sealedSnapshots.length ? `Erratum recorded against sealed snapshot${erratum.sealedSnapshots.length > 1 ? 's' : ''} ${erratum.sealedSnapshots.map((s) => `S${s.seq}`).join(', ')}.` : 'No sealed snapshot included it.'}
          </Notice>
        )}
      </div>

      {/* Scans, ECG, video: stored and shown, never read */}
      {storedOnly && !quarantine && (
        <section aria-labelledby="stored-h" className="grid gap-4">
          <h2 id="stored-h" className="text-lg font-medium" data-testid="stored-note">{fileInfo?.note ?? 'File — stored, not read'}</h2>
          {doc.mime === 'application/dicom' || doc.mime === 'application/x-dicom-study'
            ? (imaging
              ? <ImagingViewer documentId={doc.id} details={imaging} canView />
              : <Notice tone="shadow" icon={<ScanText />} title="The header could not be read">{fileInfo?.previewNote ?? 'The file is stored as it came.'}</Notice>)
            : doc.mime === 'application/pdf'
              ? <div className="max-h-[40rem] overflow-y-auto border border-rule"><PdfPages src={`/api/documents/${doc.id}/file?kind=original`} pages={doc.pages ?? 1} /></div>
            : doc.mime.startsWith('video/')
              ? <video controls preload="metadata" className="max-h-[32rem] w-full border border-rule bg-obsidian" src={`/api/documents/${doc.id}/file?kind=original`} data-testid="video-player" />
              : <Notice tone="shadow" icon={<ScanText />} title="Kept exactly as it arrived">Open the original to view it with the right program.</Notice>}
        </section>
      )}

      {/* Evidence: facts on exhibit beside the lit source text */}
      {attached && !storedOnly && (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-3">
            <p className="text-[15px]">
              {gate ? (
                <>
                  <span className="font-medium">{gate.kept} fact{gate.kept === 1 ? '' : 's'} found, each with its quote</span>
                  {gate.rejected > 0
                    ? <span className="text-madder-ink"> · {gate.rejected} possible fact{gate.rejected > 1 ? 's' : ''} not shown because no matching quote was found</span>
                    : <span className="text-muted"> · none left out</span>}
                </>
              ) : <span className="text-muted">No automatic extraction for this file.</span>}
            </p>
          </div>
          <SourceViewer
            documentId={doc.id}
            pages={d.pages}
            pageImages={d.pageImages}
            focusEventId={event ?? null}
            events={d.events.map((e) => ({
              id: e.id, eventType: e.eventType, fields: e.fields, eventDate: e.eventDate, datePrecision: e.datePrecision, documentDate: e.documentDate,
              flags: e.flags, verificationStatus: e.verificationStatus, extractionMethod: e.extractionMethod,
              withdrawnAt: e.withdrawnAt?.toISOString() ?? null, withdrawnReason: e.withdrawnReason,
              evidence: e.evidence.map((x) => ({ pageNo: x.pageNo, charStart: x.charStart, charEnd: x.charEnd, quote: x.quote, bbox: x.bbox })),
            }))}
          />
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
        {/* Original */}
        {d.original && doc.status !== 'quarantined' && !storedOnly && (
          <section aria-labelledby="orig-h" className="grid content-start gap-3 [&>*]:min-w-0">
            <h2 id="orig-h" className="ds-kicker">Original file</h2>
            <Frame matte caption={`${fileInfo?.label ?? 'File'} · ${doc.sizeBytes > 1048576 ? (doc.sizeBytes / 1048576).toFixed(1) + ' MB' : (doc.sizeBytes / 1024).toFixed(0) + ' KB'}`}>
              {doc.mime === 'application/pdf' ? (
                <div className="max-h-[40rem] overflow-y-auto"><PdfPages src={`/api/documents/${doc.id}/file?kind=original`} pages={doc.pages ?? 1} /></div>
              ) : (
                <div className="grid gap-2">
                  {(d.pageImages.length ? d.pageImages : [1]).map((n) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={n} src={`/api/documents/${doc.id}/file?kind=page&page=${n}`} alt={`Page ${n} of the uploaded document (re-encoded, metadata removed)`} className="h-auto w-full" />
                  ))}
                </div>
              )}
            </Frame>
          </section>
        )}

        {/* Identity: header vs registered (FR-ID-03..05) */}
        <section aria-labelledby="id-h" className="grid content-start gap-4 [&>*]:min-w-0">
          <h2 id="id-h" className="ds-kicker">Identity check · header vs registered patient</h2>
          <div className="border border-rule bg-surface p-5 shadow-placard">
            <div className="flex flex-wrap items-center gap-2">
              {doc.identityResult !== 'pending' ? <StatusBadge status={doc.identityResult} /> : <Badge tone="shadow">Not checked yet</Badge>}
              <Badge tone={attached ? 'verified' : doc.attachState === 'pending_decision' ? 'unverified' : 'conflict'}>
                {{ auto: 'Attached automatically', attached: 'Attached by a person', pending_decision: 'Held — decision needed', rejected: 'Rejected', detached: 'Detached' }[doc.attachState]}
              </Badge>
            </div>
            <Table caption="Header fields" className="mt-4">
              <thead><tr><th scope="col">Field</th><th scope="col">On the document</th><th scope="col">Registered</th></tr></thead>
              <tbody>
                <tr><th scope="row">Name</th><td>{v('name') ?? '—'}</td><td>{patient.name}</td></tr>
                <tr><th scope="row">Age / sex</th><td>{[v('age'), v('sex')].filter(Boolean).join(' / ') || '—'}</td><td>{patient.ageYears != null ? `${patient.ageYears} y` : '—'} / {patient.sex}</td></tr>
                <tr><th scope="row">Date of birth</th><td>{v('dob') ?? '—'}</td><td>{patient.dob ?? '—'}</td></tr>
                <tr><th scope="row">Hospital / lab ID</th><td>{v('mrn') ?? '—'}</td><td>{patient.mrn ?? '—'}</td></tr>
                <tr><th scope="row">Report date</th><td>{v('reportDate') ?? '—'}</td><td className="text-muted">used for the age check</td></tr>
              </tbody>
            </Table>
            {(idDetails.reasons?.length || idDetails.notes?.length) ? (
              <KeyValue className="mt-4" items={[
                ...(idDetails.reasons?.length ? [{ label: 'Why', value: idDetails.reasons.map(identityReasonText).join('; ') }] : []),
                ...(idDetails.notes?.length ? [{ label: 'Notes', value: idDetails.notes.map((n) => n.replace(/_/g, ' ')).join('; ') }] : []),
              ]} />
            ) : null}
            {doc.attachReason && <p className="mt-3 text-sm text-muted">Decision reason: {doc.attachReason}</p>}
          </div>
          {doc.attachState === 'pending_decision' && !live && <IdentityDecision documentId={doc.id} result={doc.identityResult} reasons={idDetails.reasons ?? []} />}
          {attached && !live && (
            <details className="border border-rule bg-surface p-4">
              <summary className="cursor-pointer text-sm font-medium">Wrong patient? Detach this document</summary>
              <div className="mt-3"><DetachForm documentId={doc.id} /></div>
            </details>
          )}
        </section>
      </div>

      {/* Manual correction (FR-EXT-07) */}
      {attached && !storedOnly && doc.status !== 'quarantined' && !live && (
        <section aria-labelledby="manual-h" className="grid gap-4">
          <h2 id="manual-h" className="ds-kicker border-b border-rule pb-2">Correct or add details by hand</h2>
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="grid content-start gap-3">
              <h3 className="text-lg">Document type, date and hospital</h3>
              <TagForm documentId={doc.id} handwritten={!!doc.handwritten} initial={{ docType: doc.docType, documentDate: doc.documentDate, institution: doc.institutionName }} />
            </div>
            <div className="grid content-start gap-3">
              <h3 className="text-lg">Add a fact from the page</h3>
              {pageNos.length ? <ManualEventForm documentId={doc.id} pages={pageNos} /> : <p className="text-[15px] text-muted">This document is a picture only, so facts cannot be quoted from it. You can still set its type, date and hospital.</p>}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
