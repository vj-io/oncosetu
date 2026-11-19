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
    void send(ask!, { reason: reason.trim() }, ask === 'dismiss' ? 'Marked as not needed' : 'Marked as can’t be got')
  }

  const open = state === 'expected' || state === 'requested'
  return (
    <>
      {open && canRequest && <RequestBuilder patientId={patientId} actor="staff" disclosure="cleared" prefill={prefill} label={state === 'requested' ? 'Another letter' : 'Request letter'} variant={state === 'requested' ? 'secondary' : 'primary'} />}
      {open && <Button size="sm" variant="secondary" icon={<Ban />} onClick={() => { setReason(''); setAsk('unobtainable') }}>Can’t be got</Button>}
      {open && <Button size="sm" variant="ghost" icon={<X />} onClick={() => { setReason(''); setAsk('dismiss') }}>Not needed</Button>}
      {state === 'received' && <Button size="sm" icon={<Check />} onClick={() => setAsk('confirm')}>Confirm closure</Button>}
      {state === 'received' && <Button size="sm" variant="ghost" onClick={() => setAsk('reject_match')}>Not the paper we wanted</Button>}
      {(state === 'unobtainable' || state === 'dismissed') && (
        <Button size="sm" variant="ghost" icon={<RotateCcw />} loading={busy === 'reopen'} onClick={() => send('reopen', {}, 'Item reopened')}>Ask for it again</Button>
      )}

      <Dialog open={ask === 'unobtainable' || ask === 'dismiss'} onClose={() => setAsk(null)}
        title={ask === 'dismiss' ? 'This paper is not needed' : 'This paper can’t be got'}
        description={ask === 'dismiss'
          ? 'The paper is taken off the list. The reason is kept with it.'
          : 'Use this when the paper cannot be obtained, for example the family says it was lost or the hospital has closed.'}
        footer={<>
          <Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button>
          <Button variant={ask === 'dismiss' ? 'danger' : 'primary'} loading={busy === ask} onClick={submitReason}>{ask === 'dismiss' ? 'Not needed' : 'Can’t be got'}</Button>
        </>}>
        <Field label="Reason" error={error ?? undefined}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3}
            placeholder={ask === 'dismiss' ? 'e.g. Same paper as another item on this list' : 'e.g. The family says the report was lost'} />
        </Field>
      </Dialog>

      <Dialog open={ask === 'confirm'} onClose={() => setAsk(null)} title="Confirm closure"
        description="You are saying this paper is the one we were looking for. The letter for it is then marked as answered."
        footer={<>
          <Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button>
          <Button icon={<Check />} loading={busy === 'confirm'} onClick={() => send('confirm', {}, 'Closure confirmed')}>Confirm closure</Button>
        </>}>
        {proposed && (
          <div className="grid gap-4">
            <KeyValue items={[
              { label: 'Paper', value: <a className="underline decoration-brass underline-offset-4" href={proposed.href}>{proposed.label}</a> },
              { label: 'Dated', value: proposed.date },
              { label: 'From', value: proposed.institution ?? 'Institution not stated' },
            ]} />
            {institutionDiffers && <Chip kicker="Note" tone="unverified">This paper is from a different hospital than the one that mentioned it</Chip>}
          </div>
        )}
      </Dialog>

      <Dialog open={ask === 'reject_match'} onClose={() => setAsk(null)} title="Not the paper we wanted"
        description="This paper is set aside and the item goes back on the list. If a letter was given out, it stays marked as asked for."
        footer={<>
          <Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button>
          <Button variant="danger" loading={busy === 'reject_match'} onClick={() => send('reject_match', {}, 'Paper set aside')}>Not the paper we wanted</Button>
        </>} />
    </>
  )
}
