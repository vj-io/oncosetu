'use client'
import { useState } from 'react'
import { GitMerge } from 'lucide-react'
import { Badge, Button, Dialog, EmptyState, Field, Frame, Input, Select, Table } from '@/components/ui'
import { postJson, useRun } from './client'

export type DupViewItem = { id: string; accession: string; initials: string; mrn: string | null; created: string; documents: number; events: number }
export type CandidateItem = { key: string; reasons: string[]; confidence: 'high' | 'possible'; a: DupViewItem; b: DupViewItem; suggestedSurvivor: string }
export type MergeItem = {
  id: string; state: string; survivor: string; duplicate: string; requestedBy: string; requestedById: string; approvedBy: string | null
  reason: string | null; created: string; executed: string | null
}

const REASON: Record<string, string> = {
  abha: 'Same ABHA number', identity: 'Same name and date of birth', name_dob: 'Similar name, same date of birth',
  name_phone: 'Similar name, same phone number', phone: 'Same phone number', mrn: 'Same MRN',
}
const STATE_TONE: Record<string, 'unverified' | 'verified' | 'shadow' | 'setu'> = { requested: 'unverified', executed: 'verified', rejected: 'shadow', approved: 'setu' }

function Side({ v, role }: { v: DupViewItem; role: string }) {
  return (
    <div className="grid gap-1 border border-rule bg-surface px-4 py-3">
      <p className="ds-kicker">{role}</p>
      <p className="font-mono text-sm tracking-[0.08em]">{v.accession} <span className="text-faint">· initials {v.initials}</span></p>
      <p className="text-sm text-muted">MRN {v.mrn ?? '—'} · registered {v.created}</p>
      <p className="text-sm text-muted">{v.documents} documents · {v.events} events</p>
    </div>
  )
}

function Candidate({ c, onRequest, busy }: { c: CandidateItem; onRequest: (survivorId: string, duplicateId: string, reason: string) => void; busy: boolean }) {
  const [survivor, setSurvivor] = useState(c.suggestedSurvivor)
  const [reason, setReason] = useState('')
  const dupId = survivor === c.a.id ? c.b.id : c.a.id
  const s = survivor === c.a.id ? c.a : c.b
  const d = survivor === c.a.id ? c.b : c.a
  return (
    <Frame className="grid gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={c.confidence === 'high' ? 'conflict' : 'unverified'}>{c.confidence === 'high' ? 'Likely duplicate' : 'Possible duplicate'}</Badge>
        {c.reasons.map((r) => <Badge key={r} tone="neutral">{REASON[r]}</Badge>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Side v={s} role="Survivor · keeps the record" />
        <Side v={d} role="Duplicate · merged into survivor" />
      </div>
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
        <Field label="Survivor">
          <Select value={survivor} onChange={(e) => setSurvivor(e.target.value)}>
            <option value={c.a.id}>{c.a.accession}</option>
            <option value={c.b.id}>{c.b.accession}</option>
          </Select>
        </Field>
        <Field label="Reason" optional><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="How you know these are one person" /></Field>
        <Button icon={<GitMerge aria-hidden />} loading={busy} onClick={() => onRequest(survivor, dupId, reason)}>Request merge</Button>
      </div>
    </Frame>
  )
}

export function DuplicatesPanel({ candidates, merges, meId }: { candidates: CandidateItem[]; merges: MergeItem[]; meId: string }) {
  const { busy, run } = useRun()
  const [approving, setApproving] = useState<MergeItem | null>(null)
  const pending = merges.filter((m) => m.state === 'requested')
  const history = merges.filter((m) => m.state !== 'requested')

  return (
    <div className="grid grid-cols-1 gap-10">
      <section aria-labelledby="pending-h" className="grid grid-cols-1 gap-4">
        <h2 id="pending-h" className="text-2xl tracking-[-0.025em]">Waiting for a second approval</h2>
        {pending.length === 0 ? <EmptyState title="No merge is pending" description="A merge starts when one staff member requests it below; a different staff member then approves." /> : (
          <ul className="grid gap-3">
            {pending.map((m) => {
              const mine = m.requestedById === meId
              return (
                <li key={m.id} className="grid gap-3 border border-l-[3px] border-rule border-l-amber bg-surface px-5 py-4 shadow-placard">
                  <p className="font-mono text-sm tracking-[0.08em]">{m.duplicate} <span className="text-faint">→ merge into →</span> {m.survivor}</p>
                  <p className="text-sm text-muted">Requested by {m.requestedBy} on {m.created}{m.reason ? ` · “${m.reason}”` : ''}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {mine ? <Badge tone="unverified">You requested this: a second person must approve</Badge> : <Button onClick={() => setApproving(m)}>Review and approve</Button>}
                    <Button variant={mine ? 'ghost' : 'secondary'} loading={busy === `reject:${m.id}`} disabled={busy !== null}
                      onClick={() => run(`reject:${m.id}`, () => postJson(`/api/admin/duplicates/${m.id}`, { action: 'reject' }), mine ? 'Request withdrawn' : 'Merge rejected')}>
                      {mine ? 'Withdraw request' : 'Reject'}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="cand-h" className="grid grid-cols-1 gap-4">
        <h2 id="cand-h" className="text-2xl tracking-[-0.025em]">Likely duplicate records</h2>
        <p className="max-w-prose text-muted">Found from the ABHA number, phone number, name with date of birth, and transliteration-aware name matching. Names are not shown here.</p>
        {candidates.length === 0 ? <EmptyState title="No likely duplicates" description="No two active records share an identifier or a matching name and date of birth." /> : (
          <div className="grid grid-cols-1 gap-4">
            {candidates.map((c) => (
              <Candidate key={c.key} c={c} busy={busy === `req:${c.key}`}
                onRequest={(sv, dp, reason) => run(`req:${c.key}`, () => postJson('/api/admin/duplicates', { survivorId: sv, duplicateId: dp, reason: reason || undefined }), 'Merge requested: waiting for a second approver')} />
            ))}
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section aria-labelledby="hist-h" className="grid grid-cols-1 gap-4">
          <h2 id="hist-h" className="text-2xl tracking-[-0.025em]">Recent decisions</h2>
          <Table caption="Merge requests">
            <thead><tr><th>Duplicate</th><th>Survivor</th><th>Requested by</th><th>Approved by</th><th>Outcome</th><th>When</th></tr></thead>
            <tbody>
              {history.map((m) => (
                <tr key={m.id}>
                  <td className="font-mono text-[13px]">{m.duplicate}</td><td className="font-mono text-[13px]">{m.survivor}</td>
                  <td>{m.requestedBy}</td><td>{m.approvedBy ?? '—'}</td>
                  <td><Badge tone={STATE_TONE[m.state] ?? 'neutral'}>{m.state}</Badge></td>
                  <td className="font-mono text-[13px] whitespace-nowrap">{m.executed ?? m.created}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      <Dialog open={!!approving} onClose={() => setApproving(null)} title="Approve and execute this merge?"
        description="This is the second approval. It runs at once and cannot be undone from here."
        footer={<>
          <Button variant="ghost" onClick={() => setApproving(null)}>Cancel</Button>
          <Button variant="danger" loading={busy === 'approve'} onClick={async () => {
            if (!approving) return
            await run('approve', () => postJson(`/api/admin/duplicates/${approving.id}`, { action: 'approve' }), 'Records merged')
            setApproving(null)
          }}>Approve and merge</Button>
        </>}>
        {approving && (
          <div className="grid gap-3 text-[15px]">
            <p><span className="font-mono">{approving.duplicate}</span> is merged into <span className="font-mono">{approving.survivor}</span>.</p>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              <li>Documents, pages, events, evidence, statements, missing-record items, requests, shares and encounters move to the survivor.</li>
              <li>The duplicate is marked merged and its card token is revoked.</li>
              <li>Consent, verification and sealed-snapshot history is append-only: it stays on the duplicate record, linked by this merge. The survivor&apos;s own consent applies.</li>
            </ul>
          </div>
        )}
      </Dialog>
    </div>
  )
}
