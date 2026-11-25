'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { ArrowDownUp, ArrowLeft, ArrowRight, Check, ExternalLink, FileText, FlaskConical, Link2, Pill, ScanLine, Stethoscope, Undo2, X } from 'lucide-react'
import { ImagingViewer } from '@/components/documents/ImagingViewer'
import { postJson } from '@/components/documents/IdentityDecision'
import { Badge, useToast } from '@/components/ui'
import {
  KIND_LABEL, KIND_ORDER, applyLinkDecision, MODALITY_LABEL, countsByKind, earlierStudies, filterRecords, fmtCompared, fmtDay, modalitiesPresent, neighbours, otherAreaStudies, sortRecords, yearOf,
  type ModalityKey, type RecordKind, type RecordRow, type RejectedPair, type ResolvedPair,
} from '@/server/records/core'
import { PaperPreview } from './PaperPreview'

type Initial = { kind: RecordKind | 'all'; modality: ModalityKey | 'any'; order: 'new' | 'old' }
type Decide = (d: { scanId: string; reportId: string; decision: 'confirm' | 'reject' | 'reset' }) => void
type Identity = { name: string; line: string | null; code: string }

const ICON: Record<RecordKind, typeof FileText> = { report: FileText, scan: ScanLine, lab: FlaskConical, rx: Pill, other: Stethoscope }

const dateLine = (r: RecordRow) => (r.dateFrom === 'paper' ? fmtDay(r.date) : `${fmtDay(r.date)} (received; date not on paper)`)

/** The filter as a query string, so the full page and its Back link keep the same list. */
const listQuery = (s: { kind: string; modality: string; order: string }) => {
  const q = new URLSearchParams()
  if (s.kind !== 'all') q.set('kind', s.kind)
  if (s.modality !== 'any') q.set('mod', s.modality)
  if (s.order !== 'new') q.set('order', s.order)
  const qs = q.toString()
  return qs ? `?${qs}` : ''
}

function useUrlState(patientId: string) {
  return useCallback((s: { kind: string; modality: string; order: string }, sel: string | null) => {
    history.replaceState(null, '', `/patients/${patientId}/records${listQuery(s)}${sel ? `#doc=${sel}` : ''}`)
  }, [patientId])
}

export function RecordsBrowser({ patientId, rows, pairs: pairsIn, rejected: rejectedIn, held, heldScans, canDecide, identity, initial }: {
  patientId: string; rows: RecordRow[]; pairs: ResolvedPair[]; rejected: RejectedPair[]; held: number; heldScans: number; canDecide: boolean; identity: Identity; initial: Initial
}) {
  const [kind, setKind] = useState(initial.kind)
  const [modality, setModality] = useState(initial.modality)
  const [order, setOrder] = useState(initial.order)
  const [sel, setSel] = useState<string | null>(null)
  // A decision shows at once; when the server's fresh lists arrive they replace it.
  const [local, setLocal] = useState<{ pairs: ResolvedPair[]; rejected: RejectedPair[]; from: [ResolvedPair[], RejectedPair[]] } | null>(null)
  const fresh = local && local.from[0] === pairsIn && local.from[1] === rejectedIn ? local : null
  const pairs = fresh?.pairs ?? pairsIn
  const rejected = fresh?.rejected ?? rejectedIn
  const decide = useCallback((d: { scanId: string; reportId: string; decision: 'confirm' | 'reject' | 'reset' }) => {
    setLocal((cur) => {
      const base = cur && cur.from[0] === pairsIn && cur.from[1] === rejectedIn ? cur : { pairs: pairsIn, rejected: rejectedIn }
      return { ...applyLinkDecision(base.pairs, base.rejected, d), from: [pairsIn, rejectedIn] }
    })
  }, [pairsIn, rejectedIn])
  const [sheet, setSheet] = useState(false)
  const syncUrl = useUrlState(patientId)
  const listRef = useRef<HTMLUListElement>(null)

  const sorted = useMemo(() => sortRecords(rows, order), [rows, order])
  const filtered = useMemo(() => filterRecords(sorted, { kind, modality, withReports: true }), [sorted, kind, modality])
  const counts = useMemo(() => countsByKind(rows), [rows])
  const modalities = useMemo(() => modalitiesPresent(rows), [rows])
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])
  const pairsOf = useMemo(() => {
    const m = new Map<string, ResolvedPair>()
    for (const p of pairs) { if (!m.has(p.scanId)) m.set(p.scanId, p); if (!m.has(p.reportId)) m.set(p.reportId, p) }
    return m
  }, [pairs])
  const rejectedOf = useMemo(() => {
    const m = new Map<string, RejectedPair[]>()
    for (const p of rejected) for (const id of [p.scanId, p.reportId]) m.set(id, [...(m.get(id) ?? []), p])
    return m
  }, [rejected])

  // Start from the link: filters from the address, the open paper from its #doc=… part. On a wide screen the first paper opens.
  useEffect(() => {
    const m = /doc=([0-9a-f-]{36}(?:\.\d+)?)/i.exec(location.hash)
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

  // A new filter or order: if the open paper is not in the new list, the preview moves to the first paper of it (or empties on a phone).
  const setFilter = (next: { kind?: RecordKind | 'all'; modality?: ModalityKey | 'any'; order?: 'new' | 'old' }) => {
    const s = { kind: next.kind ?? kind, modality: next.modality ?? modality, order: next.order ?? order }
    const list = filterRecords(sortRecords(rows, s.order), { kind: s.kind, modality: s.modality, withReports: true })
    let nextSel = sel
    if (!sel || !list.some((r) => r.id === sel)) {
      nextSel = window.matchMedia('(min-width: 1024px)').matches ? (list[0]?.id ?? null) : null
      if (!nextSel) setSheet(false)
    }
    setKind(s.kind); setModality(s.modality); setOrder(s.order); setSel(nextSel)
    syncUrl(s, nextSel)
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
      if (!sel || nb.index < 0) return go(filtered[0])
      go(down ? nb.next : nb.prev)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filtered, sel, nb.index, nb.next, nb.prev, sheet, go])

  // The open paper is shown only while it is in the filtered list.
  const selected = sel && filtered.some((r) => r.id === sel) ? byId.get(sel) ?? null : null
  const qs = listQuery({ kind, modality, order })

  return (
    <div className="grid gap-4">
      {held > 0 && (
        <p className="border border-l-[3px] border-rule border-l-amber bg-surface px-4 py-2 text-[15px] rounded-lg" data-testid="held-note">
          {held} {held === 1 ? 'paper is' : 'papers are'} held until records staff confirm whose {held === 1 ? 'it is' : 'they are'}
          {heldScans > 0 ? ` (${heldScans} ${heldScans === 1 ? 'scan' : 'scans'}${held - heldScans > 0 ? `, ${held - heldScans} ${held - heldScans === 1 ? 'paper' : 'papers'}` : ''})` : ''}. {held === 1 ? 'It is' : 'They are'} not listed here.{' '}
          <Link href={`/patients/${patientId}/documents`} className="underline decoration-link underline-offset-4 hover:text-setu-ink">Review held papers</Link>
        </p>
      )}

      <div className="grid gap-3" role="group" aria-label="Filter the records">
        <div className="flex flex-wrap items-center gap-2">
          {(['all', ...KIND_ORDER] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setFilter({ kind: k, modality: k === 'scan' || k === 'all' || k === 'report' ? modality : 'any' })}
              className={clsx('inline-flex min-h-10 items-center gap-1.5 border px-3 text-[15px] rounded-md', kind === k ? 'border-obsidian bg-obsidian text-gallery' : 'border-rule bg-matte hover:bg-spotlight')}>
              {k === 'all' ? 'All' : KIND_LABEL[k]} <span className="tabular-nums opacity-70">{counts[k]}</span>
            </button>
          ))}
          {modalities.length > 0 && (
            <label className="ml-auto inline-flex items-center gap-2 text-sm">
              <span className="text-muted">Kind of scan</span>
              <select value={modality} onChange={(e) => setFilter({ modality: e.target.value as ModalityKey | 'any', kind: e.target.value === 'any' || kind === 'all' || kind === 'scan' || kind === 'report' ? kind : 'all' })}
                className="min-h-10 border border-rule bg-surface px-2 text-[15px] rounded-md">
                <option value="any">Any</option>
                {modalities.map((m) => <option key={m} value={m}>{MODALITY_LABEL[m]}</option>)}
              </select>
            </label>
          )}
          <button type="button" onClick={() => setFilter({ order: order === 'new' ? 'old' : 'new' })} className={clsx('inline-flex min-h-10 items-center gap-1.5 border border-rule bg-matte px-3 text-sm hover:bg-spotlight rounded-md', modalities.length === 0 && 'ml-auto')}>
            <ArrowDownUp aria-hidden className="size-4" /> {order === 'new' ? 'Newest first' : 'Oldest first'}
          </button>
        </div>
        <p className="text-[13px] text-muted" aria-live="polite">
          {filtered.length} of {rows.length} papers, in date order.
          {modality !== 'any' && kind !== 'scan' ? ` Includes the written imaging reports about ${MODALITY_LABEL[modality]}.` : ''}
          <span className="hidden [@media(pointer:fine)]:inline"> Press ↑ ↓ or ← → to move through them.</span>
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] [&>*]:min-w-0">
        <ul ref={listRef} className="grid content-start overflow-hidden border border-edge bg-surface shadow-card rounded-lg" aria-label="Records">
          {filtered.length === 0 && <li className="p-6 text-[15px] text-muted">No papers match this filter.</li>}
          {filtered.map((r, i) => {
            const Icon = ICON[r.kind]
            const pr = pairsOf.get(r.id)
            const other = pr ? byId.get(r.kind === 'scan' ? pr.reportId : pr.scanId) : null
            const newYear = i === 0 || yearOf(filtered[i - 1]) !== yearOf(r)
            return (
              <li key={r.id} className="contents">
                {newYear && <div className="border-b border-rule bg-matte px-3 py-1.5 text-xs text-muted">{yearOf(r)}</div>}
                <button type="button" id={`rec-${r.id}`} aria-current={sel === r.id ? 'true' : undefined} onClick={() => select(r.id)}
                  className={clsx('grid w-full gap-1 border-b border-rule px-3 py-3 text-left last:border-b-0 hover:bg-spotlight/60', sel === r.id && 'bg-setu-tint shadow-[inset_3px_0_0_var(--color-setu)]')}>
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
                    {r.section && <span className="text-muted">Report {r.section.n} of {r.section.of} in one file</span>}
                    {r.section?.newest && <Badge tone="verified">Newest in this file</Badge>}
                    {r.compared?.length ? <span className="text-muted">Compared with {r.compared.map(fmtCompared).join(', ')}</span> : null}
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
          className={clsx(sheet ? 'fixed inset-0 z-40 overflow-y-auto bg-surface p-4' : 'hidden', 'lg:sticky lg:top-20 lg:z-auto lg:block lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto lg:border lg:border-edge lg:bg-surface lg:p-4 lg:shadow-card lg:rounded-lg')}
          role="region" aria-label="Preview" data-testid="preview-panel"
        >
          {selected ? (
            <Preview
              key={selected.id} patientId={patientId} row={selected} rows={rows} byId={byId} pair={pairsOf.get(selected.id) ?? null} rejected={rejectedOf.get(selected.id) ?? []} canDecide={canDecide}
              identity={identity} qs={qs} position={nb.index + 1} total={filtered.length} prev={nb.prev} next={nb.next}
              onGo={go} onClose={() => setSheet(false)} onSelect={(id) => select(id)} onDecide={decide}
            />
          ) : (
            <p className="p-6 text-[15px] text-muted">{filtered.length ? 'Choose a paper from the list to see it here.' : 'No paper to show with this filter.'}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function Preview({ patientId, row, rows, byId, pair, rejected, canDecide, identity, qs, position, total, prev, next, onGo, onClose, onSelect, onDecide }: {
  patientId: string; row: RecordRow; rows: RecordRow[]; byId: Map<string, RecordRow>; pair: ResolvedPair | null; rejected: RejectedPair[]; canDecide: boolean
  identity: Identity; qs: string
  position: number; total: number; prev: RecordRow | null; next: RecordRow | null; onGo: (r: RecordRow | null) => void; onClose: () => void; onSelect: (id: string) => void; onDecide: Decide
}) {
  const [compare, setCompare] = useState<string | null>(null)
  const earlier = useMemo(() => earlierStudies(rows, row.id), [rows, row.id])
  const sameArea = useMemo(() => otherAreaStudies(rows, row.id), [rows, row.id])
  const other = pair ? byId.get(row.kind === 'scan' ? pair.reportId : pair.scanId) ?? null : null
  // The candidate report is shown beside the scan whether or not it is confirmed, so the decision is made with both in view.
  const reportBeside = row.kind === 'scan' ? other : null
  const cmp = compare ? byId.get(compare) ?? null : null
  const fullHref = `/patients/${patientId}/documents/${row.docId}${qs}`
  const hasOthers = earlier.length + sameArea.length > 0

  const studyButton = (e: RecordRow) => (
    <li key={e.id}>
      <button type="button" onClick={() => setCompare(compare === e.id ? null : e.id)} aria-pressed={compare === e.id}
        className={clsx('grid min-h-12 gap-0.5 border px-3 py-2 text-left text-[14px] hover:bg-spotlight rounded-lg', compare === e.id ? 'border-obsidian bg-spotlight' : 'border-rule bg-matte')}>
        <span className="font-medium">{e.title} · {fmtDay(e.date)}</span>
        <span className="text-[12px] text-muted">{e.institution ?? 'Hospital not stated'} · {compare === e.id ? 'shown side by side' : 'show side by side'}</span>
      </button>
    </li>
  )

  return (
    <article className="grid min-w-0 gap-4">
      {/* Always in view while a paper is open: whose record this is. */}
      <div className="sticky top-0 z-10 -mx-4 -mt-4 border-b border-rule bg-surface px-4 py-2 text-[14px]" data-testid="preview-identity">
        <span className="font-medium">{identity.name}</span>
        <span className="text-muted">{identity.line ? ` · ${identity.line}` : ''} · {identity.code}</span>
      </div>
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center gap-1 border border-rule px-2 text-sm hover:bg-spotlight lg:hidden rounded-md"><X aria-hidden className="size-4" />Close</button>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[13px] text-muted tabular-nums">{position > 0 ? `${position} of ${total}` : ''}</span>
            <button type="button" disabled={!prev} onClick={() => onGo(prev)} className="inline-flex min-h-10 items-center gap-1 border border-rule px-3 text-sm hover:bg-spotlight disabled:opacity-40 rounded-md" aria-label="Previous paper in the list"><ArrowLeft aria-hidden className="size-4" />Previous</button>
            <button type="button" disabled={!next} onClick={() => onGo(next)} className="inline-flex min-h-10 items-center gap-1 border border-rule px-3 text-sm hover:bg-spotlight disabled:opacity-40 rounded-md" aria-label="Next paper in the list">Next<ArrowRight aria-hidden className="size-4" /></button>
          </div>
        </div>
        <h2 className="text-xl tracking-[-0.015em] break-words">{row.title}</h2>
        <p className="text-[14px] break-words text-muted">{dateLine(row)}{row.institution ? ` · ${row.institution}` : ''}{row.pages ? ` · ${row.pages} page${row.pages > 1 ? 's' : ''}` : ''}</p>
        {row.section && <p className="text-[14px] text-muted">Report {row.section.n} of {row.section.of} in one file: page{row.section.pages.length > 1 ? 's' : ''} {row.section.pages.join(', ')} of it.{row.section.newest ? ' The newest report in this file.' : ''}</p>}
        {(row.compared?.length || row.comparedBy?.length) ? (
          <ul className="grid gap-1 text-[14px]" data-testid="comparisons">
            {row.compared?.map((c) => {
              const on = c.rowIds.map((rid) => byId.get(rid)).filter((o): o is RecordRow => !!o)
              return (
                <li key={c.date}>
                  Compared with {on.length
                    ? on.map((o, i) => <span key={o.id}>{i ? ' and ' : ''}<button type="button" onClick={() => onSelect(o.id)} className="underline underline-offset-4">{o.title}, {fmtDay(o.date)}</button></span>)
                    : <>a study of {fmtCompared(c)} <span className="text-muted">(not in this record)</span></>}
                </li>
              )
            })}
            {row.comparedBy?.map((id) => {
              const o = byId.get(id)
              return o ? <li key={id}>A later report compares with this one: <button type="button" onClick={() => onSelect(o.id)} className="underline underline-offset-4">{o.title}, {fmtDay(o.date)}</button></li> : null
            })}
          </ul>
        ) : null}
        <Link href={fullHref} className="inline-flex min-h-9 w-fit items-center gap-1 text-sm text-setu-ink underline decoration-link underline-offset-4">
          {row.kind === 'scan' ? 'Open larger, with the file header' : 'Open the full page with its facts'} <ExternalLink aria-hidden className="size-3.5" />
        </Link>
      </header>

      <PairBox patientId={patientId} row={row} other={other} pair={pair} rejected={rejected} byId={byId} canDecide={canDecide} onSelect={onSelect} onDecide={onDecide} />

      {row.kind === 'scan' && row.scan ? (
        <div className="grid gap-4">
          {cmp?.scan ? (
            <div className="grid gap-3" data-testid="compare">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] text-muted">Side by side, for your own reading. OncoSetu does not read images.</p>
                <button type="button" onClick={() => setCompare(null)} className="min-h-9 border border-rule px-3 text-sm hover:bg-spotlight rounded-md">Close</button>
              </div>
              <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
                <div className="grid content-start gap-1.5">
                  <p className="min-h-[3.25rem] text-[14px]"><span className="font-medium">{row.title} · {fmtDay(row.date)}</span><br /><span className="text-[12px] text-muted">This study</span></p>
                  <ImagingViewer key={row.id} documentId={row.id} details={row.scan} canView compact showNote={false} seriesLabel={`Images of this study, ${fmtDay(row.date)}`} />
                </div>
                <div className="grid content-start gap-1.5">
                  <p className="min-h-[3.25rem] text-[14px]"><span className="font-medium">{cmp.title} · {fmtDay(cmp.date)}</span><br /><span className="text-[12px] text-muted">Earlier study, for comparison</span></p>
                  <ImagingViewer key={cmp.id} documentId={cmp.id} details={cmp.scan} canView compact showNote={false} seriesLabel={`Images of earlier study, ${fmtDay(cmp.date)}`} />
                </div>
              </div>
            </div>
          ) : (
            <div className={clsx('grid gap-4 [&>*]:min-w-0', reportBeside && 'xl:grid-cols-2')}>
              <ImagingViewer key={row.id} documentId={row.id} details={row.scan} canView compact={!!reportBeside} enlargeHref={fullHref} />
              {reportBeside && (
                <section aria-label={pair?.state === 'confirmed' ? 'Report for this scan' : 'Possible report for this scan, not yet confirmed'} className="grid content-start gap-2" data-testid="report-beside">
                  <p className="font-medium">{pair?.state === 'confirmed' ? '' : 'Possible report, not confirmed: '}{reportBeside.title} · {fmtDay(reportBeside.date)}</p>
                  <div className="max-h-[32rem] overflow-y-auto border border-rule"><PaperPreview id={reportBeside.id} mime={reportBeside.mime} pages={reportBeside.pages} pageImages={reportBeside.pageImages} /></div>
                </section>
              )}
            </div>
          )}
          <section aria-labelledby="earlier-h" className="grid gap-2 border-t border-rule pt-3">
            <h3 id="earlier-h" className="ds-kicker">Earlier studies of the same kind and area</h3>
            {earlier.length === 0 ? <p className="text-[14px] text-muted">None on file.</p> : <ul className="flex flex-wrap gap-2">{earlier.map(studyButton)}</ul>}
            {sameArea.length > 0 && (
              <>
                <h3 className="ds-kicker mt-1">Other studies of this area</h3>
                <ul className="flex flex-wrap gap-2">{sameArea.map(studyButton)}</ul>
              </>
            )}
            {hasOthers && !cmp?.scan && <p className="text-[12px] text-muted">Earlier study, for comparison. OncoSetu does not read images.</p>}
          </section>
        </div>
      ) : (
        <PaperPreview id={row.docId} mime={row.mime} pages={row.pages} pageImages={row.pageImages} only={row.section?.pages} />
      )}
    </article>
  )
}

function PairBox({ patientId, row, other, pair, rejected, byId, canDecide, onSelect, onDecide }: {
  patientId: string; row: RecordRow; other: RecordRow | null; pair: ResolvedPair | null; rejected: RejectedPair[]; byId: Map<string, RecordRow>; canDecide: boolean; onSelect: (id: string) => void; onDecide: Decide
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  if (row.kind !== 'scan' && row.docType !== 'imaging_report') return null

  const send = async (scanId: string, reportId: string, decision: 'confirm' | 'reject' | 'reset', done: string) => {
    setBusy(decision)
    const r = await postJson(`/patients/${patientId}/records/links`, { scanId, reportId, decision })
    setBusy(null)
    if (!r.ok) { toast({ title: r.data.error?.message ?? 'Could not save', tone: 'conflict' }); return }
    onDecide({ scanId, reportId, decision })
    setAsking(false)
    toast({ title: done, tone: 'verified' })
    router.refresh()
  }

  // Pairs a person turned down are said so, with a way back. They are never described as a missing report.
  const turnedDown = rejected.map((p) => {
    const o = byId.get(row.kind === 'scan' ? p.reportId : p.scanId)
    if (!o) return null
    return (
      <section key={`${p.scanId}|${p.reportId}`} aria-label="A pair marked not a match" data-testid="rejected-box" className="grid gap-2 border border-l-[3px] border-rule border-l-slate bg-matte px-3 py-3 rounded-lg">
        <p className="text-[15px]"><span className="font-medium">Marked not a match</span>: a person said {o.title} of {fmtDay(o.date)}{o.institution ? `, ${o.institution}` : ''} is not {row.kind === 'scan' ? "this scan's report" : "this report's scan"}. It is still on file.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onSelect(o.id)} className="min-h-10 border border-rule px-3 text-sm hover:bg-spotlight rounded-md">Show the {row.kind === 'scan' ? 'report' : 'scan'}</button>
          {canDecide && <button type="button" disabled={!!busy} onClick={() => send(p.scanId, p.reportId, 'reset', 'Undone. It can be offered as a possible match again')} className="inline-flex min-h-10 items-center gap-1 border border-obsidian px-3 text-sm hover:bg-spotlight disabled:opacity-60 rounded-md"><Undo2 aria-hidden className="size-4" />Undo</button>}
          {canDecide && <button type="button" disabled={!!busy} onClick={() => send(p.scanId, p.reportId, 'confirm', 'Linked')} className="inline-flex min-h-10 items-center gap-1 bg-obsidian px-3 text-sm text-gallery hover:bg-pine-hover disabled:opacity-60 rounded-md"><Link2 aria-hidden className="size-4" />Link them anyway</button>}
        </div>
      </section>
    )
  })

  if (!pair || !other) {
    return (
      <>
        {row.kind === 'scan' && (turnedDown.some(Boolean)
          ? <p className="text-[14px] text-muted" data-testid="no-report">No report is linked to this scan now.</p>
          : <p className="text-[14px] text-muted" data-testid="no-report">No report matched. The written report is not on file.</p>)}
        {turnedDown}
      </>
    )
  }
  const label = row.kind === 'scan' ? 'Report' : 'Scan'
  const confirmed = pair.state === 'confirmed'
  return (
    <>
      <section aria-label="Scan and report pairing" data-testid="pair-box" className={clsx('grid gap-2 border border-l-[3px] border-rule bg-matte px-3 py-3 rounded-lg', confirmed ? 'border-l-sage' : 'border-l-amber')}>
        <p className="text-[15px]">
          <span className="font-medium">{confirmed ? `${label} linked` : 'Possible match'}</span>
          {': '}{other.title}, {fmtDay(other.date)}{other.institution ? `, ${other.institution}` : ''}
        </p>
        <p className="text-[13px] text-muted">{confirmed ? 'A person confirmed these belong together.' : `${pair.reason}. A person has to confirm it.`}</p>
        {asking ? (
          <div className="grid gap-2" role="alertdialog" aria-label="Confirm: not a match" data-testid="reject-confirm">
            <p className="text-[14px]">{confirmed ? 'Unlink them?' : 'Mark this as not a match?'} Both papers stay on file. You can undo this afterwards.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!!busy} onClick={() => send(pair.scanId, pair.reportId, 'reject', confirmed ? 'Unlinked. You can undo this on the scan or the report' : 'Marked as not a match. You can undo this on the scan or the report')} className="min-h-10 bg-obsidian px-3 text-sm text-gallery hover:bg-pine-hover disabled:opacity-60 rounded-md">{confirmed ? 'Yes, unlink' : 'Yes, not a match'}</button>
              <button type="button" disabled={!!busy} onClick={() => setAsking(false)} className="min-h-10 border border-rule px-3 text-sm hover:bg-spotlight rounded-md">Keep it</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onSelect(other.id)} className="min-h-10 border border-rule px-3 text-sm hover:bg-spotlight rounded-md">Show the {label.toLowerCase()}</button>
            {canDecide && !confirmed && <button type="button" disabled={!!busy} onClick={() => send(pair.scanId, pair.reportId, 'confirm', 'Linked')} className="inline-flex min-h-10 items-center gap-1 bg-obsidian px-3 text-sm text-gallery hover:bg-pine-hover disabled:opacity-60 rounded-md"><Check aria-hidden className="size-4" />Confirm</button>}
            {canDecide && <button type="button" disabled={!!busy} onClick={() => setAsking(true)} className="min-h-10 border border-obsidian px-3 text-sm hover:bg-spotlight disabled:opacity-60 rounded-md">{confirmed ? 'Unlink' : 'Not a match'}</button>}
          </div>
        )}
      </section>
      {turnedDown}
    </>
  )
}
