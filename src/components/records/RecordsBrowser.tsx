'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { ArrowDownUp, ArrowLeft, ArrowRight, Check, ExternalLink, FileText, FlaskConical, Link2, Pill, ScanLine, Stethoscope, X } from 'lucide-react'
import { ImagingViewer } from '@/components/documents/ImagingViewer'
import { postJson } from '@/components/documents/IdentityDecision'
import { Badge, useToast } from '@/components/ui'
import {
  KIND_LABEL, KIND_ORDER, MODALITY_LABEL, countsByKind, earlierStudies, filterRecords, fmtDay, modalitiesPresent, neighbours, sortRecords, yearOf,
  type ModalityKey, type RecordKind, type RecordRow, type ResolvedPair,
} from '@/server/records/core'
import { PaperPreview } from './PaperPreview'

type Initial = { kind: RecordKind | 'all'; modality: ModalityKey | 'any'; order: 'new' | 'old' }

const ICON: Record<RecordKind, typeof FileText> = { report: FileText, scan: ScanLine, lab: FlaskConical, rx: Pill, other: Stethoscope }

const dateLine = (r: RecordRow) => (r.dateFrom === 'paper' ? fmtDay(r.date) : `${fmtDay(r.date)} (received; date not on paper)`)

function useUrlState(patientId: string) {
  return useCallback((s: { kind: string; modality: string; order: string }, sel: string | null) => {
    const q = new URLSearchParams()
    if (s.kind !== 'all') q.set('kind', s.kind)
    if (s.modality !== 'any') q.set('mod', s.modality)
    if (s.order !== 'new') q.set('order', s.order)
    const qs = q.toString()
    history.replaceState(null, '', `/patients/${patientId}/records${qs ? `?${qs}` : ''}${sel ? `#doc=${sel}` : ''}`)
  }, [patientId])
}

export function RecordsBrowser({ patientId, rows, pairs, held, canDecide, initial }: {
  patientId: string; rows: RecordRow[]; pairs: ResolvedPair[]; held: number; canDecide: boolean; initial: Initial
}) {
  const [kind, setKind] = useState(initial.kind)
  const [modality, setModality] = useState(initial.modality)
  const [order, setOrder] = useState(initial.order)
  const [sel, setSel] = useState<string | null>(null)
  const [sheet, setSheet] = useState(false)
  const syncUrl = useUrlState(patientId)
  const listRef = useRef<HTMLUListElement>(null)

  const sorted = useMemo(() => sortRecords(rows, order), [rows, order])
  const filtered = useMemo(() => filterRecords(sorted, { kind, modality }), [sorted, kind, modality])
  const counts = useMemo(() => countsByKind(rows), [rows])
  const modalities = useMemo(() => modalitiesPresent(rows), [rows])
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])
  const pairsOf = useMemo(() => {
    const m = new Map<string, ResolvedPair>()
    for (const p of pairs) { if (!m.has(p.scanId)) m.set(p.scanId, p); if (!m.has(p.reportId)) m.set(p.reportId, p) }
    return m
  }, [pairs])

  // Start from the link: filters from the address, the open paper from its #doc=… part. On a wide screen the first paper opens.
  useEffect(() => {
    const m = /doc=([0-9a-f-]{36})/i.exec(location.hash)
    const wide = window.matchMedia('(min-width: 1024px)').matches
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (m && byId.has(m[1])) { setSel(m[1]); setSheet(!wide) } else if (wide && filtered[0]) setSel(filtered[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const select = useCallback((id: string | null, open = true) => {
    setSel(id)
    if (open) setSheet(true)
    syncUrl({ kind, modality, order }, id)
    if (id) requestAnimationFrame(() => document.getElementById(`rec-${id}`)?.scrollIntoView({ block: 'nearest' }))
  }, [kind, modality, order, syncUrl])

  const setFilter = (next: { kind?: RecordKind | 'all'; modality?: ModalityKey | 'any'; order?: 'new' | 'old' }) => {
    const s = { kind: next.kind ?? kind, modality: next.modality ?? modality, order: next.order ?? order }
    setKind(s.kind); setModality(s.modality); setOrder(s.order)
    syncUrl(s, sel)
  }

  const nb = sel ? neighbours(filtered, sel) : { prev: null, next: null, index: -1 }
  const go = useCallback((to: RecordRow | null) => { if (to) { select(to.id, sheet); document.getElementById(`rec-${to.id}`)?.focus({ preventScroll: true }) } }, [select, sheet])

  // Keyboard: arrow keys walk the list or the open preview; Escape closes the sheet on a phone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape' && sheet) { setSheet(false); return }
      const down = e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'j'
      const up = e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'k'
      if (!down && !up) return
      if (!filtered.length) return
      e.preventDefault()
      if (!sel) return go(filtered[0])
      go(down ? nb.next : nb.prev)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filtered, sel, nb.next, nb.prev, sheet, go])

  const selected = sel ? byId.get(sel) ?? null : null

  return (
    <div className="grid gap-4">
      {held > 0 && (
        <p className="border border-l-[3px] border-rule border-l-amber bg-surface px-4 py-2 text-[15px]" data-testid="held-note">
          {held} {held === 1 ? 'paper is' : 'papers are'} held until records staff confirm whose {held === 1 ? 'it is' : 'they are'}. {held === 1 ? 'It is' : 'They are'} not listed here.
        </p>
      )}

      <div className="grid gap-3" role="group" aria-label="Filter the records">
        <div className="flex flex-wrap items-center gap-2">
          {(['all', ...KIND_ORDER] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setFilter({ kind: k, modality: k === 'scan' || k === 'all' ? modality : 'any' })}
              className={clsx('inline-flex min-h-10 items-center gap-1.5 border px-3 text-[15px]', kind === k ? 'border-obsidian bg-obsidian text-gallery' : 'border-rule bg-matte hover:bg-spotlight')}>
              {k === 'all' ? 'All' : KIND_LABEL[k]} <span className="tabular-nums opacity-70">{counts[k]}</span>
            </button>
          ))}
          {modalities.length > 0 && (
            <label className="ml-auto inline-flex items-center gap-2 text-sm">
              <span className="text-muted">Kind of scan</span>
              <select value={modality} onChange={(e) => setFilter({ modality: e.target.value as ModalityKey | 'any', kind: e.target.value === 'any' ? kind : 'scan' })}
                className="min-h-10 border border-rule bg-surface px-2 text-[15px]">
                <option value="any">Any</option>
                {modalities.map((m) => <option key={m} value={m}>{MODALITY_LABEL[m]}</option>)}
              </select>
            </label>
          )}
          <button type="button" onClick={() => setFilter({ order: order === 'new' ? 'old' : 'new' })} className={clsx('inline-flex min-h-10 items-center gap-1.5 border border-rule bg-matte px-3 text-sm hover:bg-spotlight', modalities.length === 0 && 'ml-auto')}>
            <ArrowDownUp aria-hidden className="size-4" /> {order === 'new' ? 'Newest first' : 'Oldest first'}
          </button>
        </div>
        <p className="text-[13px] text-muted" aria-live="polite">{filtered.length} of {rows.length} papers, in date order. Use the up and down arrow keys to go through them.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] [&>*]:min-w-0">
        <ul ref={listRef} className="grid content-start border border-rule bg-surface" aria-label="Records">
          {filtered.length === 0 && <li className="p-6 text-[15px] text-muted">No papers match this filter.</li>}
          {filtered.map((r, i) => {
            const Icon = ICON[r.kind]
            const pr = pairsOf.get(r.id)
            const other = pr ? byId.get(r.kind === 'scan' ? pr.reportId : pr.scanId) : null
            const newYear = i === 0 || yearOf(filtered[i - 1]) !== yearOf(r)
            return (
              <li key={r.id} className="contents">
                {newYear && <div className="border-b border-rule bg-matte px-3 py-1.5 font-mono text-xs tracking-[0.14em] text-muted">{yearOf(r)}</div>}
                <button type="button" id={`rec-${r.id}`} aria-current={sel === r.id ? 'true' : undefined} onClick={() => select(r.id)}
                  className={clsx('grid w-full gap-1 border-b border-rule px-3 py-3 text-left last:border-b-0 hover:bg-spotlight/60', sel === r.id && 'bg-spotlight outline-2 -outline-offset-2 outline-brass')}>
                  <span className="flex items-start gap-2">
                    <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium tabular-nums">{fmtDay(r.date)}</span><span className="text-[15px]">{r.title}</span></span>
                      <span className="break-words text-[13px] text-muted">
                        {[r.institution, r.dateFrom === 'received' ? 'date not on paper, shown by the day received' : null].filter(Boolean).join(' · ') || 'Hospital not stated'}
                      </span>
                      {r.asWritten && <span className="line-clamp-1 text-[13px] text-ink/80">{r.asWritten}</span>}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 pl-6 text-[12px]">
                    {r.kind === 'scan' && r.scan && (r.scan.instances > 1 || r.scan.frames > 1) && <span className="text-muted">{Math.max(r.scan.instances, r.scan.frames)} images</span>}
                    {r.facts > 0 && <span className="text-muted">{r.checked}/{r.facts} checked</span>}
                    {pr && other && <Badge tone={pr.state === 'confirmed' ? 'verified' : 'unverified'} icon={<Link2 />}>{pr.state === 'confirmed' ? (r.kind === 'scan' ? 'Report linked' : 'Scan linked') : 'Possible match'}</Badge>}
                    {r.kind === 'scan' && !pr && <span className="text-muted">No report matched</span>}
                    {r.amendment && <Badge tone="setu">Amendment</Badge>}
                    {r.lateReceived && <Badge tone="patient">Older record, newly received</Badge>}
                    {r.handwritten && <Badge tone="shadow">Handwritten</Badge>}
                    {r.scan?.synthetic && <Badge tone="neutral">Synthetic</Badge>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        <div
          className={clsx(sheet ? 'fixed inset-0 z-40 overflow-y-auto bg-surface p-4' : 'hidden', 'lg:static lg:z-auto lg:block lg:max-h-[calc(100dvh-2rem)] lg:self-start lg:overflow-y-auto lg:border lg:border-rule lg:bg-surface lg:p-4')}
          role="region" aria-label="Preview" data-testid="preview-panel"
        >
          {selected ? (
            <Preview
              key={selected.id} patientId={patientId} row={selected} rows={rows} byId={byId} pair={pairsOf.get(selected.id) ?? null} canDecide={canDecide}
              position={nb.index + 1} total={filtered.length} prev={nb.prev} next={nb.next}
              onGo={go} onClose={() => setSheet(false)} onSelect={(id) => select(id)}
            />
          ) : (
            <p className="p-6 text-[15px] text-muted">Choose a paper from the list to see it here.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function Preview({ patientId, row, rows, byId, pair, canDecide, position, total, prev, next, onGo, onClose, onSelect }: {
  patientId: string; row: RecordRow; rows: RecordRow[]; byId: Map<string, RecordRow>; pair: ResolvedPair | null; canDecide: boolean
  position: number; total: number; prev: RecordRow | null; next: RecordRow | null; onGo: (r: RecordRow | null) => void; onClose: () => void; onSelect: (id: string) => void
}) {
  const [compare, setCompare] = useState<string | null>(null)
  const earlier = useMemo(() => earlierStudies(rows, row.id), [rows, row.id])
  const other = pair ? byId.get(row.kind === 'scan' ? pair.reportId : pair.scanId) ?? null : null
  const confirmedReport = row.kind === 'scan' && pair?.state === 'confirmed' ? other : null
  const cmp = compare ? byId.get(compare) ?? null : null

  return (
    <article className="grid min-w-0 gap-4">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center gap-1 border border-rule px-2 text-sm hover:bg-spotlight lg:hidden"><X aria-hidden className="size-4" />Close</button>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[13px] text-muted tabular-nums">{position > 0 ? `${position} of ${total}` : ''}</span>
            <button type="button" disabled={!prev} onClick={() => onGo(prev)} className="inline-flex min-h-10 items-center gap-1 border border-rule px-3 text-sm hover:bg-spotlight disabled:opacity-40" aria-label="Previous paper in the list"><ArrowLeft aria-hidden className="size-4" />Previous</button>
            <button type="button" disabled={!next} onClick={() => onGo(next)} className="inline-flex min-h-10 items-center gap-1 border border-rule px-3 text-sm hover:bg-spotlight disabled:opacity-40" aria-label="Next paper in the list">Next<ArrowRight aria-hidden className="size-4" /></button>
          </div>
        </div>
        <h2 className="text-xl tracking-[-0.015em] break-words">{row.title}</h2>
        <p className="text-[14px] break-words text-muted">{dateLine(row)}{row.institution ? ` · ${row.institution}` : ''}{row.pages ? ` · ${row.pages} page${row.pages > 1 ? 's' : ''}` : ''}</p>
        <Link href={`/patients/${patientId}/documents/${row.id}`} className="inline-flex min-h-9 w-fit items-center gap-1 text-sm text-setu-ink underline decoration-brass underline-offset-4">
          Open the full page with its facts <ExternalLink aria-hidden className="size-3.5" />
        </Link>
      </header>

      <PairBox patientId={patientId} row={row} other={other} pair={pair} canDecide={canDecide} onSelect={onSelect} />

      {row.kind === 'scan' && row.scan ? (
        <div className="grid gap-4">
          {cmp?.scan ? (
            <div className="grid gap-3" data-testid="compare">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] text-muted">Side by side, for your own reading. OncoSetu does not read images.</p>
                <button type="button" onClick={() => setCompare(null)} className="min-h-9 border border-rule px-3 text-sm hover:bg-spotlight">Close</button>
              </div>
              <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
                <div className="grid content-start gap-1.5">
                  <p className="font-medium">This study · {fmtDay(row.date)}</p>
                  <ImagingViewer key={row.id} documentId={row.id} details={{ ...row.scan, studyDate: row.scan.studyDate, patientName: row.scan.patientName, patientSex: row.scan.patientSex, patientAge: row.scan.patientAge, label: row.scan.label }} canView compact />
                </div>
                <div className="grid content-start gap-1.5">
                  <p className="font-medium">{cmp.title} · {fmtDay(cmp.date)}</p>
                  <p className="text-[13px] text-muted">Earlier study, for comparison. OncoSetu does not read images.</p>
                  <ImagingViewer key={cmp.id} documentId={cmp.id} details={cmp.scan} canView compact />
                </div>
              </div>
            </div>
          ) : (
            <div className={clsx('grid gap-4 [&>*]:min-w-0', confirmedReport && 'xl:grid-cols-2')}>
              <ImagingViewer key={row.id} documentId={row.id} details={row.scan} canView compact={!!confirmedReport} />
              {confirmedReport && (
                <section aria-label="Report for this scan" className="grid content-start gap-2">
                  <p className="font-medium">{confirmedReport.title} · {fmtDay(confirmedReport.date)}</p>
                  <div className="max-h-[32rem] overflow-y-auto border border-rule"><PaperPreview id={confirmedReport.id} mime={confirmedReport.mime} pages={confirmedReport.pages} pageImages={confirmedReport.pageImages} /></div>
                </section>
              )}
            </div>
          )}
          <section aria-labelledby="earlier-h" className="grid gap-2 border-t border-rule pt-3">
            <h3 id="earlier-h" className="ds-kicker">Earlier studies of the same area</h3>
            {earlier.length === 0 ? <p className="text-[14px] text-muted">None on file.</p> : (
              <ul className="flex flex-wrap gap-2">
                {earlier.map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => setCompare(compare === e.id ? null : e.id)} aria-pressed={compare === e.id}
                      className={clsx('grid min-h-12 gap-0.5 border px-3 py-2 text-left text-[14px] hover:bg-spotlight', compare === e.id ? 'border-obsidian bg-spotlight' : 'border-rule bg-matte')}>
                      <span className="font-medium">{e.title} · {fmtDay(e.date)}</span>
                      <span className="text-[12px] text-muted">{e.institution ?? 'Hospital not stated'} · {compare === e.id ? 'shown side by side' : 'show side by side'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[12px] text-muted">Earlier study, for comparison. OncoSetu does not read images.</p>
          </section>
        </div>
      ) : (
        <PaperPreview id={row.id} mime={row.mime} pages={row.pages} pageImages={row.pageImages} />
      )}
    </article>
  )
}

function PairBox({ patientId, row, other, pair, canDecide, onSelect }: {
  patientId: string; row: RecordRow; other: RecordRow | null; pair: ResolvedPair | null; canDecide: boolean; onSelect: (id: string) => void
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  if (row.kind !== 'scan' && row.docType !== 'imaging_report') return null
  if (!pair || !other) {
    return row.kind === 'scan' ? <p className="text-[14px] text-muted" data-testid="no-report">No report matched. The written report is not on file.</p> : null
  }
  const decide = async (decision: 'confirm' | 'reject') => {
    setBusy(decision)
    const r = await postJson(`/patients/${patientId}/records/links`, { scanId: pair.scanId, reportId: pair.reportId, decision })
    setBusy(null)
    if (!r.ok) { toast({ title: r.data.error?.message ?? 'Could not save', tone: 'conflict' }); return }
    toast({ title: decision === 'confirm' ? 'Linked' : pair.state === 'confirmed' ? 'Unlinked' : 'Marked as not a match', tone: 'verified' })
    router.refresh()
  }
  const label = row.kind === 'scan' ? 'Report' : 'Scan'
  const confirmed = pair.state === 'confirmed'
  return (
    <section aria-label="Scan and report pairing" data-testid="pair-box" className={clsx('grid gap-2 border border-l-[3px] border-rule bg-matte px-3 py-3', confirmed ? 'border-l-sage' : 'border-l-amber')}>
      <p className="text-[15px]">
        <span className="font-medium">{confirmed ? `${label} linked` : 'Possible match'}</span>
        {': '}{other.title}, {fmtDay(other.date)}{other.institution ? `, ${other.institution}` : ''}
      </p>
      <p className="text-[13px] text-muted">{confirmed ? 'A person confirmed these belong together.' : `${pair.reason}. A person has to confirm it.`}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onSelect(other.id)} className="min-h-10 border border-rule px-3 text-sm hover:bg-spotlight">Show the {label.toLowerCase()}</button>
        {canDecide && !confirmed && <button type="button" disabled={!!busy} onClick={() => decide('confirm')} className="inline-flex min-h-10 items-center gap-1 bg-obsidian px-3 text-sm text-gallery hover:bg-label disabled:opacity-60"><Check aria-hidden className="size-4" />Confirm</button>}
        {canDecide && <button type="button" disabled={!!busy} onClick={() => decide('reject')} className="min-h-10 border border-obsidian px-3 text-sm hover:bg-spotlight disabled:opacity-60">{confirmed ? 'Unlink' : 'Not a match'}</button>}
      </div>
    </section>
  )
}
