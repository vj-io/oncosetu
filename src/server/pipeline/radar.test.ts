import { describe, expect, it } from 'vitest'
import type { RadarItem, RadarOutput } from '@/core/radar'
import { needsRunner, stageStates } from './queries'
import { planRadarMerge, rowKey } from './radar'

const P = 'patient-1'
const item = (key: string, extra: Partial<RadarItem> = {}): RadarItem => ({
  dedupeKey: key, ruleId: 'RAD-SURG-HPE-01', ruleVersion: 1, triggerEventId: 'ev-1', triggerKind: 'event', expectedTypes: ['pathology_report'],
  window: { from: '2026-03-12', to: '2026-05-11' }, wording: { en: 'w', hi: 'w' }, neutralWording: { en: 'n', hi: 'n' }, sourceLabel: 'Discharge summary, p.2',
  mode: 'shadow', ...extra,
})
const row = (key: string, state: string, extra = {}) => ({ id: `row-${key}`, dedupeKey: rowKey(P, key), state: state as never, proposedDocumentId: null, ...extra })
const out = (items: RadarItem[], closureProposals: RadarOutput['closureProposals'] = []): RadarOutput => ({ items, closureProposals })
const none = new Map<string, { any: boolean; open: boolean }>()
const evs = new Set(['ev-1'])

describe('planRadarMerge (FR-RAD-03: the engine never overrides a person)', () => {
  it('a new missing item is inserted as expected, keyed per patient, with the rule mode', () => {
    const ops = planRadarMerge(P, [], out([item('k1', { mode: 'production' })]), evs, none)
    expect(ops).toEqual([expect.objectContaining({ op: 'insert', dedupeKey: `${P}:k1`, values: expect.objectContaining({ mode: 'production', triggerEventId: 'ev-1' }) })])
  })
  it('an existing item is refreshed without touching its state', () => {
    const [op] = planRadarMerge(P, [row('k1', 'requested')], out([item('k1')]), evs, none)
    expect(op).toMatchObject({ op: 'update', id: 'row-k1' })
    expect(op.op === 'update' && 'state' in op.set).toBe(false)
  })
  it('a matching document proposes closure (received), never closes', () => {
    for (const state of ['expected', 'requested']) {
      const ops = planRadarMerge(P, [row('k1', state)], out([], [{ dedupeKey: 'k1', documentId: 'doc-9', note: 'institution_differs' }]), evs, none)
      expect(ops).toEqual([{ op: 'update', id: 'row-k1', set: expect.objectContaining({ state: 'received', proposedDocumentId: 'doc-9', notes: 'institution_differs' }) }])
    }
  })
  it('closed, unobtainable and dismissed rows are left alone, even when a document arrives', () => {
    for (const state of ['closed', 'unobtainable', 'dismissed']) {
      expect(planRadarMerge(P, [row('k1', state)], out([], [{ dedupeKey: 'k1', documentId: 'doc-9' }]), evs, none)).toEqual([])
      expect(planRadarMerge(P, [row('k1', state)], out([]), evs, none)).toEqual([])
    }
  })
  it('a proposal whose document disappeared goes back to requested (open request) or expected', () => {
    const r = row('k1', 'received', { proposedDocumentId: 'doc-9' })
    const back = (open: boolean) => planRadarMerge(P, [r], out([item('k1')]), evs, new Map([['row-k1', { any: true, open }]]))[0]
    expect(back(true)).toMatchObject({ op: 'update', set: { state: 'requested', proposedDocumentId: null } })
    expect(back(false)).toMatchObject({ op: 'update', set: { state: 'expected', proposedDocumentId: null } })
    expect(planRadarMerge(P, [r], out([item('k1')]), evs, none)[0]).toMatchObject({ set: { state: 'expected' } })
  })
  it('an expected item whose trigger vanished is deleted, unless a request points at it', () => {
    expect(planRadarMerge(P, [row('k1', 'expected')], out([]), evs, none)).toEqual([{ op: 'delete', id: 'row-k1' }])
    expect(planRadarMerge(P, [row('k1', 'expected')], out([]), evs, new Map([['row-k1', { any: true, open: false }]]))).toEqual([])
  })
  it('a statement trigger is not stored as an event foreign key', () => {
    const [op] = planRadarMerge(P, [], out([item('k1', { triggerKind: 'statement', triggerEventId: 'st-1' })]), evs, none)
    expect(op.op === 'insert' && op.values.triggerEventId).toBeNull()
  })
})

describe('processing state machine helpers', () => {
  const at = new Date('2026-07-01T10:00:00Z')
  it('a runner (re)starts for queued documents and for stale processing locks only', () => {
    expect(needsRunner({ status: 'queued', lockedAt: null }, at)).toBe(true)
    expect(needsRunner({ status: 'processing', lockedAt: new Date(at.getTime() - 60_000) }, at)).toBe(false)
    expect(needsRunner({ status: 'processing', lockedAt: new Date(at.getTime() - 4 * 60_000) }, at)).toBe(true)
    for (const s of ['done', 'needs_review', 'failed', 'quarantined', 'unreadable'] as const) expect(needsRunner({ status: s, lockedAt: null }, at)).toBe(false)
  })
  it('stage states: in progress, held for a person, quarantined, finished', () => {
    const st = (status: string, stage: string, attachState = 'auto', flags = {}) => stageStates({ status, stage, attachState, flags } as never).map((s) => s.state)
    expect(st('processing', 'extracted')).toEqual(['done', 'done', 'done', 'done', 'active', 'pending', 'pending'])
    expect(st('needs_review', 'identity', 'pending_decision')).toEqual(['done', 'done', 'done', 'waiting', 'pending', 'pending', 'pending'])
    expect(st('quarantined', 'received', 'pending_decision')).toEqual(['failed', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending'])
    expect(st('done', 'completeness')).toEqual(Array(7).fill('done'))
    expect(st('unreadable', 'text')).toEqual(['done', 'failed', 'pending', 'pending', 'pending', 'pending', 'pending'])
  })
})
