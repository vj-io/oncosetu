'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Link2, UserX } from 'lucide-react'
import { Button, Field, Textarea, useToast } from '@/components/ui'
import { identityReasonText } from './labels'

export async function postJson(url: string, body: unknown = {}): Promise<{ ok: boolean; data: { error?: { code: string; message: string } } & Record<string, unknown> }> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { ok: r.ok, data: await r.json().catch(() => ({})) }
}


/** FR-ID-05: a person attaches (reason required) or rejects a document whose identity check did not match. */
export function IdentityDecision({ documentId, result, reasons, onDone, compact = false }: {
  documentId: string; result: string; reasons: string[]; onDone?: () => void; compact?: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<'attach' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(decision: 'attach' | 'reject') {
    if (reason.trim().length < 3) return setError('Write a short reason (it is kept with the decision).')
    setBusy(decision)
    setError(null)
    const r = await postJson(`/api/documents/${documentId}/attach`, { decision, reason })
    setBusy(null)
    if (!r.ok) return setError(r.data.error?.message ?? 'Could not save the decision')
    toast({ title: decision === 'attach' ? 'Attached — extraction is running' : 'Rejected — nothing from this file enters the record', tone: decision === 'attach' ? 'verified' : 'conflict' })
    onDone?.()
    router.refresh()
  }

  return (
    <div className="grid gap-3 border border-l-[3px] border-rule border-l-madder bg-madder-tint/40 p-4">
      <div className="grid gap-1">
        <p className="ds-kicker text-madder-ink">Held out of the record · identity {result}</p>
        {!compact && <p className="text-[15px]">Nothing from this file reaches the timeline until a person decides. Check the header against the registered patient.</p>}
        {reasons.length > 0 && <p className="text-sm text-muted">Why: {reasons.map(identityReasonText).join('; ')}.</p>}
      </div>
      <Field label="Reason for your decision" error={error ?? undefined}>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Header shows another patient (Sunil D., 61 M); report belongs elsewhere" maxLength={500} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="danger" icon={<UserX />} loading={busy === 'reject'} disabled={!!busy} onClick={() => decide('reject')}>Reject — not this patient</Button>
        <Button size="sm" variant="secondary" icon={<Link2 />} loading={busy === 'attach'} disabled={!!busy} onClick={() => decide('attach')}>Attach with reason</Button>
      </div>
    </div>
  )
}
