'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Crosshair, ScanText } from 'lucide-react'
import { Badge, Chip, Placard, StatusBadge, type Tone } from '@/components/ui'
import { EVENT_LABEL, FIELD_LABEL, FLAG_LABEL, fmtDate, shortId } from './labels'

export type ViewerEvidence = { pageNo: number | null; charStart: number | null; charEnd: number | null; quote: string | null; bbox: number[][] | null }
export type ViewerEvent = {
  id: string; eventType: string; fields: Record<string, unknown>; eventDate: string | null; datePrecision: string; documentDate: string | null
  flags: Record<string, boolean>; verificationStatus: string; extractionMethod: string; withdrawnAt: string | null; withdrawnReason: string | null
  evidence: ViewerEvidence[]
}
export type ViewerPage = { pageNo: number; text: string; words: { c: number; s: number; e: number }[] | null; lowConfidence: boolean; ocrConfidence: number | null }

const METHOD: Record<string, string> = { text_layer: 'PDF text layer', ocr_llm: 'OCR', manual: 'Keyed by staff', structured_map: 'Structured', asr: 'Speech' }

function spanConfidence(page: ViewerPage | undefined, s: number, e: number): number | null {
  const ws = (page?.words ?? []).filter((w) => w.s < e && w.e > s)
  return ws.length ? ws.reduce((a, w) => a + (w.c > 1 ? w.c / 100 : w.c), 0) / ws.length : null
}

function headline(e: ViewerEvent): string {
  const f = e.fields
  const v = (k: string) => (Array.isArray(f[k]) ? (f[k] as string[]).join(', ') : f[k] != null ? String(f[k]) : '')
  if (e.eventType === 'chemotherapy_session_documented') return `Cycle ${v('cycle_number')}${f.regimen_text ? ` · ${v('regimen_text')}` : ''}`
  if (e.eventType === 'admission_documented') return `Admitted ${e.eventDate ? fmtDate(e.eventDate) : ''}`.trim()
  if (e.eventType === 'discharge_documented') return `Discharged ${e.eventDate ? fmtDate(e.eventDate) : ''}`.trim()
  if (e.eventType === 'report_pending_documented') return `${v('test_name') || 'Report'} — ${v('status_text') || 'pending'}`
  if (e.eventType === 'follow_up_documented') return `${v('appointment_text')}${e.eventDate ? ` — ${fmtDate(e.eventDate)}` : ''}`
  return v('section_text') || v('history_text') || v('allergy_text') || v('procedure_text') || v('medication_names') || v('test_names') || v('test_name') || v('referred_to_text') || v('treatment_text') || EVENT_LABEL[e.eventType] || e.eventType
}

/** Crop of the page image around a low-confidence quote (FR-EXT-10): the person compares the pixels, not the OCR. */
function ImageCrop({ src, boxes }: { src: string; boxes: number[][] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      const pad = 16
      const x0 = Math.max(0, Math.min(...boxes.map((b) => b[0])) - pad), y0 = Math.max(0, Math.min(...boxes.map((b) => b[1])) - pad)
      const x1 = Math.min(img.naturalWidth, Math.max(...boxes.map((b) => b[2])) + pad), y1 = Math.min(img.naturalHeight, Math.max(...boxes.map((b) => b[3])) + pad)
      const c = ref.current
      if (!c) return
      c.width = x1 - x0
      c.height = y1 - y0
      c.getContext('2d')!.drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0)
    }
    img.src = src
  }, [src, boxes])
  return <canvas ref={ref} role="img" aria-label="Page image around the quote" className="h-auto max-h-40 w-full border border-amber bg-matte object-contain" />
}

/** Page text with every accepted quote lit; the active one gets the spotlight. */
function PageText({ page, events, active, onPick }: { page: ViewerPage; events: ViewerEvent[]; active: string | null; onPick: (id: string) => void }) {
  const spans = events.flatMap((e) => e.evidence.filter((x) => x.pageNo === page.pageNo && x.charStart != null && x.charEnd != null)
    .map((x) => ({ id: e.id, s: x.charStart!, e: x.charEnd!, low: !!e.flags.low_confidence })))
  const cuts = [...new Set([0, page.text.length, ...spans.flatMap((s) => [s.s, s.e])])].filter((n) => n >= 0 && n <= page.text.length).sort((a, b) => a - b)
  const firstOf = new Map<string, number>()
  return (
    <pre className="font-sans text-[14px] leading-[1.75] break-words whitespace-pre-wrap text-ink [tab-size:4]">
      {cuts.slice(0, -1).map((a, i) => {
        const b = cuts[i + 1]
        const cover = spans.filter((s) => s.s <= a && s.e >= b)
        const text = page.text.slice(a, b)
        if (!cover.length) return <Fragment key={a}>{text}</Fragment>
        const isActive = cover.some((c) => c.id === active)
        const id = cover.find((c) => !firstOf.has(c.id))?.id
        if (id) firstOf.set(id, a)
        return (
          <mark
            key={a}
            id={id ? `q-${id}` : undefined}
            onClick={() => onPick(cover[0].id)}
            className={clsx('ds-quote cursor-pointer', cover.every((c) => c.low) && 'ds-quote-low', isActive && 'ds-sweep outline-2 outline-offset-2 outline-brass')}
          >
            {text}
          </mark>
        )
      })}
    </pre>
  )
}

export function SourceViewer({ documentId, pages, events, pageImages, focusEventId }: {
  documentId: string; pages: ViewerPage[]; events: ViewerEvent[]; pageImages: number[]; focusEventId: string | null
}) {
  const live = useMemo(() => events.filter((e) => !e.withdrawnAt), [events])
  const [active, setActive] = useState<string | null>(focusEventId && live.some((e) => e.id === focusEventId) ? focusEventId : null)
  const viewed = useRef(new Set<string>())

  // FR-VER-03: opening an event's source is logged once per event per visit.
  const markViewed = (id: string) => {
    if (viewed.current.has(id)) return
    viewed.current.add(id)
    void fetch(`/api/events/${id}/viewed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  }
  // On wide screens the source column is its own scroll box: move only it, so the placard stays where it is.
  const scrollQuote = (id: string) => requestAnimationFrame(() => {
    const q = document.getElementById(`q-${id}`)
    const panel = document.getElementById('source-panel')
    if (!q) return
    if (panel && panel.scrollHeight > panel.clientHeight + 4) {
      const top = q.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - panel.clientHeight / 3
      panel.scrollTo({ top, behavior: 'smooth' })
    } else q.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
  const pick = (id: string, scroll = true) => {
    setActive(id)
    markViewed(id)
    if (scroll) scrollQuote(id)
  }
  // Deep link ?event=<id>: the placard and its quote are already lit (initial state); bring them into view.
  useEffect(() => {
    if (!focusEventId || !live.some((e) => e.id === focusEventId)) return
    markViewed(focusEventId)
    document.getElementById(`ev-${focusEventId}`)?.scrollIntoView({ block: 'start' })
    scrollQuote(focusEventId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEventId])

  const textPages = pages.filter((p) => p.text.trim())

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] [&>*]:min-w-0">
      {/* Placards */}
      <section aria-labelledby="facts-h" className="grid content-start gap-4">
        <h2 id="facts-h" className="ds-kicker">Facts on file · {live.length}</h2>
        {!live.length && <p className="border border-dashed border-control bg-gallery p-5 text-[15px] text-muted">No machine-extracted facts. Anything listed here must be quoted from the page text.</p>}
        {events.map((e, i) => {
          const ev = e.evidence[0]
          const page = pages.find((p) => p.pageNo === ev?.pageNo)
          const conf = ev?.charStart != null && ev.charEnd != null ? spanConfidence(page, ev.charStart, ev.charEnd) : null
          const low = !!e.flags.low_confidence || !!e.flags.binding_uncertain || (conf !== null && conf < 0.8) // OCR'd result rows always show the image
          const flags = Object.keys(e.flags).filter((k) => e.flags[k] && FLAG_LABEL[k])
          const fields = Object.entries(e.fields).filter(([k]) => k !== 'event_date_text' && k !== 'institution_name')
          const withdrawn = !!e.withdrawnAt
          return (
            <div key={e.id} id={`ev-${e.id}`} className="scroll-mt-24">
              <Placard
                animate
                delay={120 + i * 70}
                className={clsx(active === e.id && 'outline-2 outline-offset-4 outline-brass', withdrawn && 'opacity-60')}
                kicker={EVENT_LABEL[e.eventType] ?? e.eventType}
                status={withdrawn ? <Badge tone="shadow">Withdrawn</Badge> : <StatusBadge status={e.verificationStatus as 'unverified'} />}
                title={headline(e)}
                what={fields.length ? (
                  <span className="grid gap-0.5">
                    {fields.map(([k, v]) => <span key={k}><span className="text-muted">{FIELD_LABEL[k] ?? k}:</span> {Array.isArray(v) ? v.join(', ') : String(v)}</span>)}
                  </span>
                ) : undefined}
                where={ev ? (
                  <span className="grid gap-2">
                    <span className="text-muted">Page {ev.pageNo}{e.fields.institution_name ? ` · ${String(e.fields.institution_name)}` : ''}</span>
                    <q className="font-display text-[15px] leading-snug text-ink italic">{ev.quote}</q>
                    {low && pageImages.includes(ev.pageNo ?? 1) && ev.bbox?.length ? (
                      <span className="grid gap-1">
                        <ImageCrop src={`/api/documents/${documentId}/file?kind=page&page=${ev.pageNo}`} boxes={ev.bbox} />
                        <span className="flex items-start gap-1.5 text-[13px] text-amber-ink"><ScanText aria-hidden className="mt-0.5 size-3.5 shrink-0" />OCR confidence {conf !== null ? conf.toFixed(2) : 'low'} — compare with the image. Cannot be bulk-verified.</span>
                      </span>
                    ) : null}
                  </span>
                ) : undefined}
                who={withdrawn ? `Withdrawn${e.withdrawnReason ? ` (${e.withdrawnReason.replace(/_/g, ' ')})` : ''}` : e.verificationStatus === 'unverified' ? 'Not yet verified by a person' : e.verificationStatus.replace(/_/g, ' ')}
                when={
                  <span>
                    {e.eventDate ? fmtDate(e.eventDate) : 'Date not stated in the quote'}
                    {e.fields.event_date_text ? <span className="text-muted"> (written “{String(e.fields.event_date_text)}”)</span> : null}
                    {e.flags.date_from_document ? <span className="text-muted"> — the document’s own date</span> : null}
                  </span>
                }
                accession={shortId(e.id)}
                footer={
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Chip kicker="Source" tone="setu">Document</Chip>
                    <Chip kicker="Method" tone="neutral">{METHOD[e.extractionMethod] ?? e.extractionMethod}{e.flags.rule_based ? ' · rule-based' : e.flags.llm || (e.extractionMethod === 'ocr_llm' && !e.flags.rule_based) ? ' · LLM' : ''}</Chip>
                    {flags.map((f) => <Badge key={f} tone={(f === 'late_received' ? 'patient' : f === 'identity_warning' ? 'conflict' : 'unverified') as Tone}>{FLAG_LABEL[f]}</Badge>)}
                    {ev && !withdrawn && (
                      <button type="button" onClick={() => pick(e.id)} className="ml-auto inline-flex min-h-9 items-center gap-1 px-2 text-sm underline underline-offset-4 hover:bg-spotlight">
                        <Crosshair aria-hidden className="size-4" /> Show in source
                      </button>
                    )}
                  </span>
                }
              />
            </div>
          )
        })}
      </section>

      {/* Source text */}
      <section id="source-panel" aria-labelledby="source-h" className="grid content-start gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
        <h2 id="source-h" className="ds-kicker">Source text · every lit passage is a quote the record relies on</h2>
        {!textPages.length && <p className="border border-dashed border-control bg-gallery p-5 text-[15px] text-muted">No machine text is kept for this document (image only).</p>}
        {textPages.map((p) => (
          <article key={p.pageNo} className="border border-rule bg-matte shadow-frame">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-rule bg-surface px-4 py-2">
              <span className="font-mono text-[11px] tracking-[0.12em] text-faint uppercase">Page {p.pageNo}{p.ocrConfidence != null ? ` · OCR mean confidence ${p.ocrConfidence.toFixed(2)}` : ' · text layer'}</span>
              {p.lowConfidence && <StatusBadge status="low_confidence" />}
            </header>
            <div className="px-4 py-4 sm:px-5">
              <PageText page={p} events={live} active={active} onPick={(id) => pick(id, false)} />
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}

/**
 * The original PDF drawn page by page with PDF.js into images (no browser PDF plugin, no PDF scripts): the file route
 * serves PDFs under CSP `sandbox`, where browser PDF viewers refuse to run.
 */
export function PdfPages({ src, pages }: { src: string; pages: number }) {
  const [imgs, setImgs] = useState<string[]>([])
  const [error, setError] = useState(false)
  useEffect(() => {
    let off = false
    ;(async () => {
      const { getDocumentProxy, renderPageAsImage } = await import('unpdf')
      const bytes = new Uint8Array(await (await fetch(src, { credentials: 'same-origin' })).arrayBuffer())
      const pdf = await getDocumentProxy(bytes)
      for (let n = 1; n <= Math.min(pdf.numPages, 20) && !off; n++) {
        const url = await renderPageAsImage(pdf, n, { width: 1100, toDataURL: true, format: 'png' })
        if (!off) setImgs((xs) => [...xs, url])
      }
    })().catch(() => !off && setError(true))
    return () => { off = true }
  }, [src])
  if (error) return <p className="p-4 text-sm text-muted">The original could not be drawn in the browser.</p>
  return (
    <div className="grid gap-2 bg-alcove p-2">
      {imgs.map((u, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={u} alt={`Original page ${i + 1}`} className="h-auto w-full border border-rule bg-white" />
      ))}
      {imgs.length < pages && <p className="p-3 font-mono text-[11px] tracking-[0.12em] text-faint uppercase">Drawing page {imgs.length + 1} of {pages}…</p>}
    </div>
  )
}
