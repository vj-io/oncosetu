'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import {
  Activity, ArrowRight, Camera, CopyCheck, FileImage, FileText, Fingerprint, Hand, KeyRound, Languages, Library, LoaderCircle, PauseCircle, PenLine, ScanLine, ScanText, ShieldAlert, Upload, Video,
} from 'lucide-react'
import { Badge, Button, EmptyState, StageTracker, StatusBadge, TONE, type Tone } from '@/components/ui'
import { capFor, needsChunks, uploadChunked } from '@/lib/chunked-upload'
import type { DocSummary } from '@/server/pipeline/queries'
import { HeldStages } from './HeldStages'
import { IdentityDecision } from './IdentityDecision'
import { PRIORITY_GROUPS, STAGE_LABELS, fmtDate, fmtDateTime, shortId, statusBadge, trackerPosition } from './labels'

export type Progress = { documents: number; pagesReceived: number; pagesProcessed: number; pagesVerified: number; inQueue: number; awaitingDecision: number }

type UploadItem = { key: string; name: string; size: number; state: 'preparing' | 'uploading' | 'done' | 'error'; pct: number; note?: string; documentId?: string }
type Sample = { file: string; title: string; docType: string; demoStep: string; kind: string }

const MAX_BATCH = 50
const MAX_BYTES = 4 * 1024 * 1024
const MAX_SIDE = 2400

/** Ordinary photos are re-encoded in the browser (JPEG, up to 2400 px, EXIF orientation applied). Everything else is sent as it is. */
async function prepare(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !/\.heic$/i.test(file.name)) return file
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
    if (scale === 1 && file.size <= MAX_BYTES * 0.9 && file.type === 'image/jpeg') return file
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale)
    c.height = Math.round(bmp.height * scale)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85))
    return out ?? file
  } catch {
    return file // the browser cannot decode it (e.g. HEIC outside Safari): send as-is, the server decides
  }
}

function sendFile(url: string, blob: Blob, name: string, clientFileId: string, onPct: (n: number) => void): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      let body: Record<string, unknown> = {}
      try { body = JSON.parse(xhr.responseText) } catch { /* empty */ }
      resolve({ status: xhr.status, body })
    }
    xhr.onerror = () => resolve({ status: 0, body: { error: { message: 'Network error — retry; the upload id makes a retry safe' } } })
    const fd = new FormData()
    fd.set('file', blob, name)
    fd.set('clientFileId', clientFileId)
    fd.set('intakeRoute', 'bulk')
    xhr.send(fd)
  })
}

const norm = (s: string) => s.toLowerCase().replace(/\b(?:mrs?|ms|smt|shri|mr|mohd|md|dr)\.?\s+/g, '').replace(/[^\p{L}]+/gu, ' ').trim()

export function DocumentsBoard({ patientId, patientName, demo, initial, canDecide }: {
  patientId: string; patientName: string; demo: boolean; initial: { rows: DocSummary[]; progress: Progress }
  canDecide: boolean
}) {
  const [data, setData] = useState(initial)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [drag, setDrag] = useState(false)
  const [samples, setSamples] = useState<{ backlog: string[]; items: Sample[] } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/patients/${patientId}/documents`, { cache: 'no-store' })
    if (r.ok) setData(await r.json())
  }, [patientId])

  const busy = data.rows.some((r) => r.status === 'queued' || r.status === 'processing') || uploads.some((u) => u.state === 'uploading' || u.state === 'preparing')
  useEffect(() => {
    if (!busy) return
    const t = setInterval(refresh, 1500)
    return () => clearInterval(t)
  }, [busy, refresh])

  // Demo mode: the matching synthetic patient's documents, one click to upload.
  useEffect(() => {
    if (!demo) return
    ;(async () => {
      const [patients, manifest0, imaging] = await Promise.all([fetch('/demo-docs/patients.json').then((r) => r.json()), fetch('/demo-docs/manifest.json').then((r) => r.json()), fetch('/demo-docs/imaging-manifest.json').then((r) => (r.ok ? r.json() : [])).catch(() => [])])
      const manifest = [...(manifest0 as unknown[]), ...(imaging as unknown[])]
      const me = norm(patientName)
      const p = (patients as { patientKey: string; fullName: string; aliases: string[]; demo: Record<string, string[]> }[])
        .find((x) => [x.fullName, ...x.aliases].some((n) => norm(n) === me))
      if (!p) return
      setSamples({ backlog: p.demo.backlog ?? [], items: (manifest as (Sample & { patientKey: string })[]).filter((m) => m.patientKey === p.patientKey) })
    })().catch(() => setSamples(null))
  }, [demo, patientName])

  const upload = useCallback(async (files: { name: string; get: () => Promise<Blob> }[]) => {
    const batch = files.slice(0, MAX_BATCH)
    const items: UploadItem[] = batch.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, size: 0, state: 'preparing', pct: 0 }))
    setUploads((u) => [...items, ...u].slice(0, 60))
    const patch = (key: string, p: Partial<UploadItem>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)))
    let next = 0
    const worker = async () => {
      while (next < batch.length) {
        const i = next++
        const it = items[i]
        try {
          const blob = await prepare(new File([await batch[i].get()], batch[i].name, { type: batch[i].name.endsWith('.pdf') ? 'application/pdf' : undefined }))
          if (blob.size > capFor(it.name)) { patch(it.key, { state: 'error', note: 'Larger than the limit (50 MB per file, 200 MB per ZIP)' }); continue }
          patch(it.key, { state: 'uploading', size: blob.size })
          if (needsChunks(blob.size)) {
            const c = await uploadChunked(`/api/patients/${patientId}/uploads`, blob, it.name, (pct) => patch(it.key, { pct }))
            if (c.status !== 200) { patch(it.key, { state: 'error', note: c.code === 'checksum_mismatch' ? 'The file was damaged on the way. Try again.' : c.code === 'chunk_failed' ? 'The connection dropped. Try again.' : 'Upload failed. Check the file type and size.' }); continue }
            const skip = c.skipped.length ? `${c.skipped.length} file${c.skipped.length > 1 ? 's' : ''} in the ZIP skipped: ${[...new Set(c.skipped.map((x) => x.reason))].join('; ')}` : undefined
            patch(it.key, { state: 'done', pct: 100, note: c.duplicate ? 'Already in file — linked, not reprocessed' : skip })
            void refresh()
            continue
          }
          const r = await sendFile(`/api/patients/${patientId}/documents`, blob, it.name, crypto.randomUUID(), (pct) => patch(it.key, { pct }))
          if (r.status !== 200) { patch(it.key, { state: 'error', note: (r.body.error as { message?: string })?.message ?? `Upload failed (${r.status})` }); continue }
          const skipped = (r.body.skipped as { reason: string }[] | undefined) ?? []
          const note = skipped.length ? `${skipped.length} file${skipped.length > 1 ? 's' : ''} in the ZIP skipped: ${[...new Set(skipped.map((x) => x.reason))].join('; ')}`
            : r.body.duplicateOf ? 'Already in file — linked, not reprocessed'
            : r.body.status === 'quarantined' ? 'Quarantined by the safety check'
            : r.body.nearDuplicateOf ? 'Possible re-photograph of a file already here' : undefined
          patch(it.key, { state: 'done', pct: 100, documentId: r.body.documentId as string, note })
          void refresh()
        } catch {
          patch(it.key, { state: 'error', note: 'Could not read this file' })
        }
      }
    }
    await Promise.all([worker(), worker(), worker()])
    void refresh()
  }, [patientId, refresh])

  const fromFiles = (list: FileList | File[]) => upload([...list].map((f) => ({ name: f.name, get: async () => f })))
  const fromSamples = (names: string[]) => upload(names.map((n) => ({ name: n, get: () => fetch(`/demo-docs/${n}`).then((r) => r.blob()) })))

  // Documents waiting for a person to confirm the patient sit in their own group, never under a clinical heading.
  const held = useMemo(() => data.rows.filter((r) => r.attachState === 'pending_decision' && r.status !== 'queued' && r.status !== 'processing'), [data.rows])
  const groups = useMemo(() => {
    const rest = data.rows.filter((r) => !held.includes(r))
    const forms = rest.filter((r) => r.file?.label === 'Consent')
    const stored = rest.filter((r) => r.file?.storedOnly && !forms.includes(r))
    const text = rest.filter((r) => !r.file?.storedOnly)
    return PRIORITY_GROUPS.map((g) => ({ ...g, rows: g.title.startsWith('Scans') ? stored : g.title.startsWith('Signed consent') ? forms : text.filter((r) => g.types.includes(r.docType ?? 'other') || (g.title.startsWith('Other') && !r.docType)) })).filter((g) => g.rows.length)
  }, [data.rows, held])
  const p = data.progress

  return (
    <div className="grid gap-10">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Summary */}
        <section aria-labelledby="progress-h" className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3 self-start border border-rule bg-surface p-5 shadow-placard sm:p-6">
          <p className="ds-kicker">In this file</p>
          <h2 id="progress-h" className="text-xl tracking-[-0.02em]">{p.documents} document{p.documents === 1 ? '' : 's'}</h2>
          <p className="text-sm text-muted">
            {p.inQueue > 0 ? <><LoaderCircle aria-hidden className="ds-spin mr-1 inline size-3.5" />{p.inQueue} being checked · </> : null}
            {p.awaitingDecision > 0 ? <span className="text-madder-ink">{p.awaitingDecision} held for checking · </span> : null}
            {p.pagesVerified} of {p.pagesReceived} pages confirmed by a person.
          </p>
        </section>

        {/* Upload (FR-ING-02) */}
        <section aria-labelledby="upload-h" className="grid content-start gap-4">
          <h2 id="upload-h" className="sr-only">Upload documents</h2>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void fromFiles(e.dataTransfer.files) }}
            className={clsx('grid place-items-center gap-3 border-2 border-dashed px-6 py-8 text-center transition-colors', drag ? 'border-setu bg-setu-tint' : 'border-control bg-matte')}
          >
            <Upload aria-hidden className="size-7 text-muted" strokeWidth={1.5} />
            <div className="grid gap-1">
              <p className="font-display text-lg tracking-[-0.015em]">Drop the patient’s records here</p>
              <p data-testid="staff-upload-formats" className="text-sm text-muted">PDF, photos (JPEG, PNG, HEIC, WebP, TIFF), scan files (X-ray, CT, PET, MRI, DICOM), ECG files, short videos, Word or text reports, or a ZIP of these · up to {MAX_BATCH} files · 50 MB per file, 200 MB per ZIP.</p>
              <p className="text-sm text-muted">OncoSetu keeps the scan and reads the written report; it doesn’t interpret images.</p>
            </div>
            <input ref={input} type="file" multiple className="sr-only" onChange={(e) => { if (e.target.files?.length) void fromFiles(e.target.files); e.target.value = '' }} />
            <Button size="sm" variant="secondary" onClick={() => input.current?.click()}>Choose files</Button>
          </div>

          {samples && (
            <details className="border border-rule bg-surface p-4">
              <summary className="cursor-pointer text-sm text-muted">Demo tools: add sample documents</summary>
              <div className="mt-3 grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">Sample documents for {patientName}</p>
                {samples.backlog.length > 0 && <Button size="sm" icon={<Library />} onClick={() => fromSamples(samples.backlog)}>Add all {samples.backlog.length} sample documents</Button>}
              </div>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {samples.items.map((s) => (
                  <li key={s.file}>
                    <button type="button" onClick={() => fromSamples([s.file])} className="flex w-full items-start gap-2 border border-rule bg-matte px-3 py-2 text-left text-sm hover:border-ink hover:bg-spotlight">
                      {s.kind === 'image' || s.kind === 'dicom' || s.kind === 'zip' ? <FileImage aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" /> : <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />}
                      <span className="grid min-w-0"><span className="truncate">{s.title}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
              </div>
            </details>
          )}

          {uploads.length > 0 && (
            <ul aria-label="Uploads" className="grid gap-1.5">
              {uploads.map((u) => (
                <li key={u.key} className="grid gap-1 border border-rule bg-matte px-3 py-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{u.name}</span>
                    <span className={clsx('shrink-0 font-mono text-[11px] tracking-[0.1em] uppercase', u.state === 'error' ? 'text-madder-ink' : u.state === 'done' ? 'text-sage-ink' : 'text-setu-ink')}>
                      {u.state === 'preparing' ? 'Preparing' : u.state === 'uploading' ? `${u.pct}%` : u.state === 'done' ? 'Received' : 'Not accepted'}
                    </span>
                  </div>
                  {(u.state === 'uploading' || u.state === 'preparing') && (
                    <div className="h-1 bg-alcove" role="progressbar" aria-label={`Upload ${u.name}`} aria-valuenow={u.pct} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full bg-setu transition-[width]" style={{ width: `${u.pct}%` }} />
                    </div>
                  )}
                  {u.note && <p className={clsx('text-[13px]', u.state === 'error' ? 'text-madder-ink' : 'text-muted')}>{u.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Document index (FR-ONB-01) */}
      <section aria-labelledby="index-h" className="grid gap-8">
        <h2 id="index-h" className="sr-only">Document index</h2>
        {!data.rows.length && <EmptyState icon={<FileText />} title="No documents yet" description="Upload the backlog the patient brought — reports, discharge summaries, prescriptions, phone photos." />}
        {held.length > 0 && (
          <div className="grid gap-3" data-testid="held-group">
            <h3 className="ds-kicker flex items-center gap-2 border-b border-madder pb-2 text-madder-ink"><PauseCircle aria-hidden className="size-4" />Held for checking · {held.length}</h3>
            <p className="text-sm text-muted">These files are kept out of the record until a person confirms they belong to this patient.</p>
            <ul className="grid gap-3">
              {held.map((r, i) => <DocRow key={r.id} row={r} patientId={patientId} canDecide={canDecide} index={i} onChange={refresh} />)}
            </ul>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.title} className="grid gap-3">
            <h3 className="ds-kicker border-b border-rule pb-2">{g.title} · {g.rows.length}</h3>
            <ul className="grid gap-3">
              {g.rows.map((r, i) => <DocRow key={r.id} row={r} patientId={patientId} canDecide={canDecide} index={i} onChange={refresh} />)}
            </ul>
          </div>
        ))}
      </section>
    </div>
  )
}

const TONE_FOR: Record<string, Tone> = { done: 'verified', needs_review: 'unverified', needs_password: 'unverified', failed: 'conflict', quarantined: 'conflict', unreadable: 'conflict', queued: 'shadow', processing: 'setu' }

function DocRow({ row: r, patientId, canDecide, index, onChange }: { row: DocSummary; patientId: string; canDecide: boolean; index: number; onChange: () => void }) {
  const live = r.status === 'queued' || r.status === 'processing'
  const pos = trackerPosition(r.stages)
  const pending = r.attachState === 'pending_decision' && !live
  const b = statusBadge(r.status)
  const href = `/patients/${patientId}/documents/${r.id}`
  const chips: { icon: ReactNode; text: string; tone: Tone }[] = []
  const cat = r.file?.category
  const CatIcon = cat === 'scan' ? ScanLine : cat === 'ecg' ? Activity : cat === 'video' ? Video : cat === 'photo' ? Camera : FileText
  if (cat) chips.push({ icon: <CatIcon />, text: r.file!.label, tone: 'neutral' })
  if (r.imaging?.synthetic) chips.push({ icon: <ShieldAlert />, text: 'Synthetic sample', tone: 'shadow' })
  if (r.flags.injection) chips.push({ icon: <ShieldAlert />, text: 'Hidden instructions removed', tone: 'conflict' })
  if (r.flags.handwritten) chips.push({ icon: <Hand />, text: 'Handwritten · image only', tone: 'unverified' })
  if (r.flags.lowConfidence) chips.push({ icon: <ScanText />, text: 'Low OCR confidence', tone: 'unverified' })
  if (r.flags.nearDuplicateOf) chips.push({ icon: <CopyCheck />, text: 'Possible duplicate', tone: 'unverified' })
  if (r.flags.languageUnsupported) chips.push({ icon: <Languages />, text: 'Language not supported', tone: 'shadow' })
  if (r.flags.amendmentOf) chips.push({ icon: <PenLine />, text: 'Amendment', tone: 'setu' })
  if (r.flags.lateReceived) chips.push({ icon: <FileText />, text: 'Older record, newly received', tone: 'patient' })
  if (r.status === 'needs_password') chips.push({ icon: <KeyRound />, text: 'Password needed', tone: 'unverified' })
  if (r.flags.detached) chips.push({ icon: <Fingerprint />, text: 'Detached', tone: 'conflict' })

  return (
    <li className={clsx('ds-frame-in border border-l-[3px] border-rule bg-matte shadow-placard', TONE[TONE_FOR[r.status] ?? 'neutral'].bar)} style={{ ['--delay' as string]: `${Math.min(index, 8) * 40}ms` }}>
      <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5">
        <div className="grid min-w-0 gap-1.5">
          <p className="font-mono text-[11px] tracking-[0.12em] text-faint uppercase">ACC. {shortId(r.id)} · received {fmtDateTime(r.receivedAt)}{r.pages ? ` · ${r.pages} page${r.pages > 1 ? 's' : ''}` : ''}</p>
          <h4 className="text-lg leading-snug tracking-[-0.015em]">
            {r.title}
            {r.institution && <span className="text-muted"> · {r.institution}</span>}
          </h4>
          {r.file?.storedOnly && <p data-testid="stored-note" className="text-sm font-medium">{r.file.note}</p>}
          {r.imaging && (
            <p className="text-sm text-muted" data-testid="imaging-line">
              {[r.imaging.label, r.imaging.studyDate ? fmtDate(r.imaging.studyDate) : null, r.imaging.bodyPart, r.imaging.institution].filter(Boolean).join(' · ')}
              {r.imaging.patientName && <> · header name: {r.imaging.patientName}{r.imaging.patientSex ? `, ${r.imaging.patientSex}` : ''}{r.imaging.patientAge ? `, ${r.imaging.patientAge}` : ''}</>}
              {r.imaging.instances > 1 && <> · {r.imaging.instances} images</>}
            </p>
          )}
          <p className="text-sm text-muted">
            {r.documentDate ? `Document date ${fmtDate(r.documentDate)}` : r.file?.storedOnly ? 'No facts are read from this file' : 'No document date found'}
            {r.events > 0 && <> · <span className="text-ink">{r.events} fact{r.events > 1 ? 's' : ''} with quotes</span> ({r.verified} verified)</>}
            {r.rejected > 0 && <> · {r.rejected} not shown (no matching quote)</>}
          </p>
          {chips.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {chips.map((c) => <Badge key={c.text} tone={c.tone} icon={c.icon}>{c.text}</Badge>)}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-start gap-2 sm:flex-col sm:items-end">
          {r.imaging && canDecide && r.status !== 'quarantined' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/documents/${r.id}/preview`} alt={`Preview picture of ${r.imaging.label}`} width={96} height={96} loading="lazy" className="size-24 border border-rule bg-obsidian object-contain" />
          )}
          <StatusBadge status={b.status} label={b.label} />
          {r.identity !== 'pending' && <StatusBadge status={r.identity} />}
          {canDecide && !live && (
            <Link href={href} className="inline-flex items-center gap-1 pt-1 text-sm underline underline-offset-4 hover:text-setu-ink">
              Open source viewer <ArrowRight aria-hidden className="size-4" />
            </Link>
          )}
        </div>
      </div>
      {(live || pending || r.status === 'failed' || r.status === 'unreadable') && (
        <div className="grid gap-3 border-t border-rule px-4 py-4 sm:px-5">
          {pos.waiting ? <HeldStages at={pos.current} /> : <StageTracker stages={STAGE_LABELS} current={pos.current} failed={pos.failed} label={`Processing stages for ${r.title}`} />}
          {pending && canDecide && <IdentityDecision documentId={r.id} result={r.identity} reasons={r.identityReasons} compact onDone={onChange} />}
          {pending && !canDecide && <p className="text-sm text-muted">A records officer or clinician decides whether this file belongs to this patient.</p>}
        </div>
      )}
      {r.flags.quarantined && (
        <p className="border-t border-rule px-4 py-3 text-sm text-madder-ink sm:px-5">Not processed: active content or a test virus signature was found. The original is kept encrypted and never opened.</p>
      )}
    </li>
  )
}

