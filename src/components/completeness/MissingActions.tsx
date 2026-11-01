'use client'
// Human actions on one completeness item (FR-RAD-03): request, unobtainable (reason), dismiss (reason), confirm a
// proposed closure (E-RAD-01 note), not a match, reopen. Every action goes through POST /api/missing/[id]/transition.
import { useState } from 'react'
import { Ban, Check, RotateCcw, X } from 'lucide-react'
import { postJson, useRun } from '@/components/admin/client'
import { Button, Chip, Dialog, Field, KeyValue, Textarea } from '@/components/ui'
import type { MissingState } from '@/core/types'
import { RequestBuilder, type RequestPrefill } from '../requests/RequestBuilder'

type Proposed = { label: string; date: string; institution: string | null; href: string }
type Ask = null | 'unobtainable' | 'dismiss' | 'confirm' | 'reject_match'

export function MissingActions({ id, patientId, state, proposed, institutionDiffers, canAct, canRequest, prefill }: {
  id: string
  patientId: string
  state: MissingState
  proposed: Proposed | null
  institutionDiffers: boolean
  canAct: boolean
  canRequest: boolean
  prefill: RequestPrefill
}) {
  const { busy, run } = useRun()
  const [ask, setAsk] = useState<Ask>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  if (!canAct) return null

  const send = (action: string, extra: Record<string, unknown> = {}, ok?: string) =>
    run(action, () => postJson(`/api/missing/${id}/transition`, { action, ...extra }), ok).then((r) => { if (r) setAsk(null) })

  function submitReason() {
    if (!reason.trim()) return setError('A reason is required.')
    setError(null)
    void send(ask!, { reason: reason.trim() }, ask === 'dismiss' ? 'Item dismissed' : 'Marked unobtainable')
  }

  const open = state === 'expected' || state === 'requested'
  return (
    <>
      {open && canRequest && <RequestBuilder patientId={patientId} actor="staff" disclosure="cleared" prefill={prefill} label="Request" variant="primary" />}
      {open && <Button size="sm" variant="secondary" icon={<Ban />} onClick={() => { setReason(''); setAsk('unobtainable') }}>Unobtainable</Button>}
      {open && <Button size="sm" variant="ghost" icon={<X />} onClick={() => { setReason(''); setAsk('dismiss') }}>Dismiss</Button>}
      {state === 'received' && <Button size="sm" icon={<Check />} onClick={() => setAsk('confirm')}>Confirm closure</Button>}
      {state === 'received' && <Button size="sm" variant="ghost" onClick={() => setAsk('reject_match')}>Not a match</Button>}
      {(state === 'unobtainable' || state === 'dismissed') && (
        <Button size="sm" variant="ghost" icon={<RotateCcw />} loading={busy === 'reopen'} onClick={() => send('reopen', {}, 'Item reopened')}>Reopen</Button>
      )}

      <Dialog open={ask === 'unobtainable' || ask === 'dismiss'} onClose={() => setAsk(null)}
        title={ask === 'dismiss' ? 'Dismiss this item' : 'Mark as unobtainable'}
        description={ask === 'dismiss'
          ? 'Dismissing removes the item from the checklist. The reason is kept with the item.'
          : 'For records that cannot be obtained, for example the patient reports them lost or the institution has closed (E-RAD-02).'}
        footer={<>
          <Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button>
          <Button variant={ask === 'dismiss' ? 'danger' : 'primary'} loading={busy === ask} onClick={submitReason}>{ask === 'dismiss' ? 'Dismiss' : 'Mark unobtainable'}</Button>
        </>}>
        <Field label="Reason" error={error ?? undefined}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3}
            placeholder={ask === 'dismiss' ? 'e.g. Duplicate of another item; report already reviewed in the outside file' : 'e.g. Patient reports the report was lost'} />
        </Field>
      </Dialog>

      <Dialog open={ask === 'confirm'} onClose={() => setAsk(null)} title="Confirm closure"
        description="A person confirms every match. Any request for this document is marked fulfilled."
        footer={<>
          <Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button>
          <Button icon={<Check />} loading={busy === 'confirm'} onClick={() => send('confirm', {}, 'Closure confirmed')}>Confirm closure</Button>
        </>}>
        {proposed && (
          <div className="grid gap-4">
            <KeyValue items={[
              { label: 'Document', value: <a className="underline decoration-brass underline-offset-4" href={proposed.href}>{proposed.label}</a> },
              { label: 'Dated', value: proposed.date },
              { label: 'From', value: proposed.institution ?? 'Institution not stated' },
            ]} />
            {institutionDiffers && <Chip kicker="Note" tone="unverified">Institution differs from the one in the triggering record (E-RAD-01)</Chip>}
          </div>
        )}
      </Dialog>

      <Dialog open={ask === 'reject_match'} onClose={() => setAsk(null)} title="Not a match"
        description="The proposed document is set aside and the item goes back to waiting (requested if a request is open)."
        footer={<>
          <Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button>
          <Button variant="danger" loading={busy === 'reject_match'} onClick={() => send('reject_match', {}, 'Match set aside')}>Not a match</Button>
        </>} />
    </>
  )
}
