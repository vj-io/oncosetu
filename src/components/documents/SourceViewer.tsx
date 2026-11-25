'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, Crosshair, ScanText } from 'lucide-react'
import { Badge, StatusBadge, type Tone } from '@/components/ui'
import { PageCheckButton } from './DocumentTools'
import { EVENT_LABEL, FIELD_LABEL, FLAG_LABEL, fmtDate } from './labels'

export type ViewerEvidence = { pageNo: number | null; charStart: number | null; charEnd: number | null; quote: string | null; bbox: number[][] | null }
export type ViewerEvent = {
  id: string; eventType: string; fields: Record<string, unknown>; eventDate: string | null; datePrecision: string; documentDate: string | null
  flags: Record<string, boolean>; verificationStatus: string; extractionMethod: string; withdrawnAt: string | null; withdrawnReason: string | null
  evidence: ViewerEvidence[]
  rowVersion?: number
}

/** FR-DOC-06: a low-confidence fact nobody has checked is held out of the record (ledger, seal, shares) until a person checks it here. */
export const needsPageCheck = (e: Pick<ViewerEvent, 'flags' | 'verificationStatus' | 'withdrawnAt'>) =>
  !e.withdrawnAt && !!e.flags.low_confidence && e.verificationStatus === 'unverified'
export type ViewerPage = { pageNo: number; text: string; words: { c: number; s: number; e: number }[] | null; lowConfidence: boolean; ocrConfidence: number | null }

const METHOD: Record<string, string> = { text_layer: 'Typed PDF', ocr_llm: 'Read from a photo: check the numbers', manual: 'Entered by staff', structured_map: 'From a health record', asr: 'From speech' }

/** The facts column is grouped by what is still to be done with each line, most urgent first. Nothing is hidden: every line is in exactly one group. */
type GroupKey = 'needs' | 'problem' | 'open' | 'checked' | 'withdrawn'
const FACT_GROUPS: { key: GroupKey; title: string; bar: string }[] = [
  { key: 'needs', title: 'Needs checking', bar: 'border-l-amber' },
  { key: 'problem', title: 'Disputed or rejected', bar: 'border-l-madder' },
  { key: 'open', title: 'Not yet checked', bar: 'border-l-slate' },
  { key: 'checked', title: 'Checked', bar: 'border-l-sage' },
  { key: 'withdrawn', title: 'Withdrawn', bar: 'border-l-slate' },
]
function factGroup(e: Pick<ViewerEvent, 'flags' | 'verificationStatus' | 'withdrawnAt'>): GroupKey {
  if (e.withdrawnAt) return 'withdrawn'
  if (needsPageCheck(e)) return 'needs'
  if (e.verificationStatus === 'disputed' || e.verificationStatus === 'rejected') return 'problem'
  return e.verificationStatus === 'unverified' ? 'open' : 'checked'
}

const SHORT_DATE =(e: Pick<ViewerEvent, 'eventDate'>) => (e.eventDate ? fmtDate(e.eventDate) : 'No date')

function spanConfidence(page: ViewerPage | undefined, s: number, e: number): number | null {
  const ws = (page?.words ?? []).filter((w) => w.s < e && w.e > s)
  return ws.length ? ws.reduce((a, w) => a + (w.c > 1 ? w.c / 100 : w.c), 0) / ws.length : null
}

/** The title of a fact line. When the fields give nothing beyond the label ("Margins as written"), the first words of its own quote are shown. */
export function lineTitle(e: ViewerEvent): string {
  const h = headline(e)
  const label = EVENT_LABEL[e.eventType] ?? e.eventType
  const quote = e.evidence[0]?.quote?.replace(/\s+/g, ' ').trim()
  if ((h === label || !h) && quote) return quote.length > 60 ? `${quote.slice(0, 60).trimEnd()}…` : quote
  return h
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
  return <canvas ref={ref} role="img" aria-label="Page image around the quote" className="h-auto max-h-40 w-full border border-amber bg-matte object-contain rounded-lg" />
}

/** Page text with every accepted quote lit; the active one gets the spotlight. */
function PageText({ page, events, active, onPick }: { page: ViewerPage; events: ViewerEvent[]; active: string | null; onPick: (id: string) => void }) {
  const spans = events.flatMap((e) => e.evidence.filter((x) => x.pageNo === page.pageNo && x.charStart != null && x.charEnd != null)
    .map((x) => ({ id: e.id, s: x.charStart!, e: x.charEnd!, low: !!e.flags.low_confidence })))
  const cuts = [...new Set([0, page.text.length, ...spans.flatMap((s) => [s.s, s.e])])].filter((n) => n >= 0 && n <= page.text.length).sort((a, b) => a - b)
  const firstOf = new Map<string, number>()
  // While a quote on this page is active, the other quotes step back to a paler band so the active one stands out.
  const hasActive = spans.some((s) => s.id === active)
  return (
    <pre className="max-w-[72ch] font-mono text-[13.5px] leading-[1.8] break-words whitespace-pre-wrap text-ink [tab-size:4]">
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
            className={clsx(
              'ds-quote cursor-pointer',
              cover.every((c) => c.low) && 'ds-quote-low',
              // Active: darker yellow (#fde68a), a #8f6c12 outline (3.9:1 on that yellow, 4.6:1 on the paper) and a leading marker, so it is not colour alone.
              isActive && "ds-sweep rounded-[3px] [--ql:var(--color-brass-dark)] [--qb:var(--color-highlight-on)] outline-2 outline-offset-1 outline-brass-dark before:mr-0.5 before:font-semibold before:text-brass-dark before:content-['▸']",
              !isActive && hasActive && !cover.every((c) => c.low) && '[--qb:#fff8dc]',
            )}
          >
            {text}
          </mark>
        )
      })}
    </pre>
  )
}

/** One page picture with a frame drawn round the words of the fact being looked at (when the file gives their position). */
function PageImage({ src, n, boxes }: { src: string; n: number; boxes: number[][] }) {
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null)
  return (
    <div className="relative border border-paper-rule bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`Page ${n} of the paper as it was received`} className="block h-auto w-full" onLoad={(e) => setDim({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
      {dim && boxes.map((b, i) => (
        <span key={i} aria-hidden className="pointer-events-none absolute border-2 border-brass bg-brass/20"
          style={{ left: `${(b[0] / dim.w) * 100}%`, top: `${(b[1] / dim.h) * 100}%`, width: `${((b[2] - b[0]) / dim.w) * 100}%`, height: `${((b[3] - b[1]) / dim.h) * 100}%` }} />
      ))}
    </div>
  )
}

export function SourceViewer({ documentId, pages, events, pageImages, focusEventId, mime, pageCount }: {
  documentId: string; pages: ViewerPage[]; events: ViewerEvent[]; pageImages: number[]; focusEventId: string | null; mime: string; pageCount: number
}) {
  const live = useMemo(() => events.filter((e) => !e.withdrawnAt), [events])
  const initial = focusEventId && live.some((e) => e.id === focusEventId) ? focusEventId : null
  const [active, setActive] = useState<string | null>(initial)
  // Folded fact groups. Picking a fact opens its group; folding the group of the active fact clears the active fact.
  const [closed, setClosed] = useState<ReadonlySet<GroupKey>>(new Set())
  const isPdf = mime === 'application/pdf'
  const textPages = pages.filter((p) => p.text.trim())
  // A link to one fact opens where its words are lit: the words view, unless the file gives the place on the picture.
  const [mode, setMode] = useState<'page' | 'text'>(initial && textPages.length && (isPdf || !events.find((e) => e.id === initial)?.evidence.some((x) => x.bbox?.length)) ? 'text' : 'page')
  const viewed = useRef(new Set<string>())
  const imageDoc = !isPdf && (pageImages.length > 0 || mime.startsWith('image/'))

  // FR-VER-03: opening an event's source is logged once per event per visit.
  const markViewed = (id: string) => {
    if (viewed.current.has(id)) return
    viewed.current.add(id)
    void fetch(`/api/events/${id}/viewed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  }
  // On wide screens the page column is its own scroll box: move only it, so the facts stay where they are.
  const scrollQuote = (id: string) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const q = document.getElementById(`q-${id}`)
    const panel = document.getElementById('source-panel')
    if (!q) return
    if (panel && panel.scrollHeight > panel.clientHeight + 4) {
      const top = q.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - panel.clientHeight / 3
      panel.scrollTo({ top, behavior: 'smooth' })
    } else q.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }))
  const pick = (id: string, scroll = true) => {
    setActive(id)
    markViewed(id)
    const ev = events.find((e) => e.id === id)
    const g = ev && factGroup(ev)
    if (g) setClosed((c) => { if (!c.has(g)) return c; const n = new Set(c); n.delete(g); return n })
    // A typed PDF is drawn as plain pictures with no positions, so its highlighted words are on the words view.
    const needsText = isPdf || !ev?.evidence.some((x) => x.bbox?.length)
    if (needsText && textPages.length) setMode('text')
    if (scroll) scrollQuote(id)
  }
  useEffect(() => {
    if (!focusEventId || !live.some((e) => e.id === focusEventId)) return
    markViewed(focusEventId)
    document.getElementById(`ev-${focusEventId}`)?.scrollIntoView({ block: 'start' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEventId])

  const activeEvent = events.find((e) => e.id === active)
  const boxesOn = (n: number) => (activeEvent?.evidence ?? []).filter((x) => x.pageNo === n && x.bbox?.length).flatMap((x) => x.bbox!)

  const toggleGroup = (k: GroupKey) => {
    if (!closed.has(k) && activeEvent && factGroup(activeEvent) === k) setActive(null)
    setClosed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }
  const groups = FACT_GROUPS.map((g) => ({ ...g, items: events.filter((e) => factGroup(e) === g.key) })).filter((g) => g.items.length > 0)
  const shownPages = mode === 'page' ? (pageImages.length || pageCount) : textPages.length

  const renderFact = (e: ViewerEvent) => {
            const ev = e.evidence[0]
            const page = pages.find((p) => p.pageNo === ev?.pageNo)
            const conf = ev?.charStart != null && ev.charEnd != null ? spanConfidence(page, ev.charStart, ev.charEnd) : null
            const low = !!e.flags.low_confidence || !!e.flags.binding_uncertain || (conf !== null && conf < 0.8) // photo-read rows always show the image
            const flags = Object.keys(e.flags).filter((k) => e.flags[k] && FLAG_LABEL[k])
            const fields = Object.entries(e.fields).filter(([k]) => k !== 'event_date_text' && k !== 'institution_name')
            const withdrawn = !!e.withdrawnAt
            const held = needsPageCheck(e)
            const open = active === e.id
            const state = withdrawn ? <Badge tone="shadow">Withdrawn</Badge> : held ? <Badge tone="unverified" icon={<ScanText />}>Needs checking</Badge> : <StatusBadge status={e.verificationStatus as 'unverified'} />
            return (
              // The active row: pale teal (#e3f1f2) plus a 3px #8f6c12 bar, the same colour as the outline on the active quote. The bar is a
              // pseudo-element so the button's hover colour cannot paint over it (bar 4.9:1 on white, 4.2:1 on the row).
              <li key={e.id} id={`ev-${e.id}`} data-held={held || undefined} className={clsx('relative scroll-mt-24 border-b border-rule last:border-b-0', open && 'bg-select before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-brass-dark', withdrawn && 'opacity-60')}>
                <button type="button" aria-expanded={open} onClick={() => (open ? setActive(null) : pick(e.id, false))}
                  className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 text-left hover:bg-spotlight">
                  <span className="grid min-w-0 gap-0.5 break-words"><span className="ds-kicker">{EVENT_LABEL[e.eventType] ?? e.eventType}</span><span className="text-[15px] leading-snug font-medium text-ink">{lineTitle(e)}</span></span>
                  <ChevronDown aria-hidden className={clsx('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
                  <span className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted"><span>{SHORT_DATE(e)}</span>{ev && <span>· page {ev.pageNo}</span>}</span>
                  <span className="justify-self-end">{state}</span>
                </button>
                {open && (
                  <div className="grid gap-3 border-t border-[#c5dde0] px-4 py-3 text-[14px]">
                    {fields.length > 0 && (
                      <p className="grid gap-0.5">{fields.map(([k, v]) => <span key={k} className="break-words"><span className="text-muted">{FIELD_LABEL[k] ?? k}:</span> {Array.isArray(v) ? v.join(', ') : String(v)}</span>)}</p>
                    )}
                    {ev && <q className="font-display text-[15px] leading-snug break-words text-ink italic">{ev.quote}</q>}
                    {e.fields.event_date_text ? <p className="text-muted">Date as written: “{String(e.fields.event_date_text)}”{e.flags.date_from_document ? ' (the paper’s own date)' : ''}</p> : null}
                    {low && ev && pageImages.includes(ev.pageNo ?? 1) && ev.bbox?.length ? (
                      <span className="grid gap-1">
                        <ImageCrop src={`/api/documents/${documentId}/file?kind=page&page=${ev.pageNo}`} boxes={ev.bbox} />
                        <span className="flex items-start gap-1.5 text-[13px] text-amber-ink"><ScanText aria-hidden className="mt-0.5 size-3.5 shrink-0" />Read from a photo ({conf !== null ? conf.toFixed(2) : 'low'} sure). Compare with the picture. Cannot be checked in bulk.</span>
                      </span>
                    ) : null}
                    <p className="text-muted">{withdrawn ? `Withdrawn${e.withdrawnReason ? ` (${e.withdrawnReason.replace(/_/g, ' ')})` : ''}` : held ? 'Not in the record until a person checks it against the page.' : e.verificationStatus === 'unverified' ? 'Not yet verified by a person.' : e.verificationStatus.replace(/_/g, ' ')}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {flags.map((f) => <Badge key={f} tone={(f === 'late_received' ? 'patient' : f === 'identity_warning' ? 'conflict' : 'unverified') as Tone}>{FLAG_LABEL[f]}</Badge>)}
                      {held && e.rowVersion !== undefined && <PageCheckButton eventId={e.id} rowVersion={e.rowVersion} />}
                      {ev && !withdrawn && (
                        <button type="button" onClick={() => pick(e.id)} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-setu-ink underline underline-offset-4 hover:bg-white/70">
                          <Crosshair aria-hidden className="size-4" /> Show on the page
                        </button>
                      )}
                    </div>
                    <details className="text-[13px] text-muted">
                      <summary className="w-fit cursor-pointer underline underline-offset-4">Details</summary>
                      <p className="mt-1">How it was read: {METHOD[e.extractionMethod] ?? e.extractionMethod}</p>
                    </details>
                  </div>
                )}
              </li>
            )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-8 [&>*]:min-w-0">
      {/* The paper, first: a warm sheet (#fbf8f1) with its own sticky header, so it reads as the thing received, not as part of the app */}
      <section id="source-panel" aria-labelledby="page-h" className="grid content-start overflow-hidden rounded-xl border border-paper-rule bg-paper shadow-card lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-paper-rule bg-paper-band px-4 py-2 lg:sticky lg:top-0 lg:z-10">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <h2 id="page-h" className="text-[15px] font-semibold text-ink">The paper</h2>
            <span className="text-[13px] text-muted">{mode === 'page' ? 'as received' : 'words read from it'} · {shownPages} {shownPages === 1 ? 'page' : 'pages'}</span>
          </div>
          {textPages.length > 0 && (
            <div className="inline-flex gap-0.5 rounded-md bg-white/70 p-0.5 text-sm ring-1 ring-paper-rule ring-inset" role="group" aria-label="How to show the paper">
              {(['page', 'text'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={clsx('min-h-10 rounded-sm px-3 font-medium', mode === m ? 'bg-obsidian text-white' : 'text-ink hover:bg-white')}>{m === 'page' ? 'Page' : 'Words'}</button>
              ))}
            </div>
          )}
        </div>
        <div className="grid content-start gap-3 p-3 sm:p-4">
          {mode === 'page' ? (
            isPdf ? <PdfPages src={`/api/documents/${documentId}/file?kind=original`} pages={pageCount} />
            : imageDoc ? (
              <div className="grid gap-2">{(pageImages.length ? pageImages : [1]).map((n) => <PageImage key={n} n={n} src={`/api/documents/${documentId}/file?kind=page&page=${n}`} boxes={boxesOn(n)} />)}</div>
            ) : <p className="border border-dashed border-control bg-white p-5 text-[15px] text-muted rounded-lg">This kind of file cannot be drawn here. <a className="underline" href={`/api/documents/${documentId}/file?kind=original`}>Open the original</a>.</p>
          ) : (
            <div className="grid gap-3">
              <p className="text-[13px] text-muted">Highlighted words are the ones the record uses.</p>
              {!textPages.length && <p className="border border-dashed border-control bg-white p-5 text-[15px] text-muted rounded-lg">No words were read from this paper (picture only).</p>}
              {textPages.map((p) => (
                <article key={p.pageNo} className="rounded-lg border border-paper-rule bg-paper">
                  <header className="flex flex-wrap items-center justify-between gap-2 rounded-t-lg border-b border-paper-rule bg-paper-band px-4 py-2">
                    <span className="text-[13px] font-medium text-muted">Page {p.pageNo}{p.ocrConfidence != null ? ` · read from a photo, confidence ${p.ocrConfidence.toFixed(2)}` : ''}</span>
                    {p.lowConfidence && <StatusBadge status="low_confidence" />}
                  </header>
                  <div className="px-4 py-4 sm:px-5"><PageText page={p} events={live} active={active} onPick={(id) => pick(id, false)} /></div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Facts found: a white card, one neutral sticky header, rows grouped by what still has to be done with them */}
      <section aria-labelledby="facts-h" className="grid content-start overflow-hidden rounded-xl border border-edge bg-white shadow-card lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-edge bg-wash px-4 py-2 lg:sticky lg:top-0 lg:z-10">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <h2 id="facts-h" className="text-[15px] font-semibold text-ink">Facts found</h2>
            <span className="text-[13px] text-muted">what the paper says</span>
          </div>
          <span className="rounded-full border border-edge bg-white px-2.5 py-0.5 text-[13px] font-semibold text-ink tabular-nums">{live.length}<span className="sr-only"> {live.length === 1 ? 'line' : 'lines'}</span></span>
        </div>
        {!live.length && <p className="m-4 border border-dashed border-control bg-white p-5 text-[15px] text-muted rounded-lg">Nothing was picked out of this paper automatically. Read the page.</p>}
        <div>
          {groups.map((g) => {
            const shown = !closed.has(g.key)
            return (
              <div key={g.key} className="border-b border-rule last:border-b-0">
                <h3 className={clsx('border-b border-l-[3px] border-b-rule bg-white lg:sticky lg:top-14 lg:z-[5]', g.bar)}>
                  <button type="button" aria-expanded={shown} aria-controls={`facts-${g.key}`} onClick={() => toggleGroup(g.key)} className="flex min-h-11 w-full items-center gap-2 px-3.5 text-left text-[13px] font-semibold text-ink hover:bg-spotlight">
                    {g.title}
                    <span className="rounded-full bg-alcove px-2 py-0.5 text-[13px] font-semibold tabular-nums">{g.items.length}</span>
                    <ChevronDown aria-hidden className={clsx('ml-auto size-4 shrink-0 text-muted transition-transform', !shown && '-rotate-90')} />
                  </button>
                </h3>
                <ul id={`facts-${g.key}`} className="grid" hidden={!shown}>
                  {g.items.map(renderFact)}
                </ul>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

/**
 * The original PDF drawn page by page with PDF.js into images (no browser PDF plugin, no PDF scripts): the file route
 * serves PDFs under CSP `sandbox`, where browser PDF viewers refuse to run.
 */
/** `only`: draw just these page numbers (one report of a file that holds several, E-DOC-10). */
export function PdfPages({ src, pages, only }: { src: string; pages: number; only?: readonly number[] }) {
  const [imgs, setImgs] = useState<{ n: number; url: string }[]>([])
  const onlyKey = only?.join(',') ?? ''
  const [error, setError] = useState(false)
  useEffect(() => {
    let off = false
    ;(async () => {
      const { getDocumentProxy, renderPageAsImage } = await import('unpdf')
      const bytes = new Uint8Array(await (await fetch(src, { credentials: 'same-origin' })).arrayBuffer())
      const pdf = await getDocumentProxy(bytes)
      const list = onlyKey ? onlyKey.split(',').map(Number).filter((n) => n <= pdf.numPages).slice(0, 20) : Array.from({ length: Math.min(pdf.numPages, 20) }, (_, i) => i + 1)
      for (const n of list) {
        if (off) break
        const url = await renderPageAsImage(pdf, n, { width: 1100, toDataURL: true, format: 'png' })
        if (!off) setImgs((xs) => [...xs, { n, url }])
      }
    })().catch(() => !off && setError(true))
    return () => { off = true }
  }, [src, onlyKey])
  if (error) return <p className="p-4 text-sm text-muted">The original could not be drawn in the browser.</p>
  return (
    <div className="grid gap-2 bg-paper p-2">
      {imgs.map(({ n, url }) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={n} src={url} alt={`Original page ${n}`} className="h-auto w-full border border-paper-rule bg-white" />
      ))}
      {imgs.length < (only?.length ?? pages) && <p className="p-3 text-[13px] text-faint font-medium">Drawing page {only ? only[imgs.length] : imgs.length + 1} of {only ? `the file (${imgs.length + 1} of ${only.length} here)` : pages}…</p>}
    </div>
  )
}
