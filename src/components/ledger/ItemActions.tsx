'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, Check, CircleAlert, Lock, Pencil, X } from 'lucide-react'
import { Button, ButtonLink, Dialog, Field, Input, Stamp, Textarea, useToast } from '@/components/ui'
import type { ItemView } from '@/server/ledger/core'
import { postJson } from './client'

type Props = { item: Pick<ItemView, 'id' | 'rowVersion' | 'status' | 'permits' | 'editable' | 'sources' | 'viewedSource' | 'typeLabel'> & { readings: ItemView['when']['readings'] } }
type Mode = 'edit' | 'reject' | 'dispute' | null

const TITLES = { edit: 'Correct this item', reject: 'Reject this item', dispute: 'Mark this item disputed' } as const
const HELP = {
  edit: 'The correction is saved as a new version. The original extraction and its source quote are kept.',
  reject: 'The item leaves the record (it does not match its source). The document itself is unchanged.',
  dispute: 'The item stays in the record, labelled “Disputed”, until it is resolved.',
} as const

/** Verify · Edit · Reject · Dispute for one ledger item. Opening the source is the first, natural step. */
export function ItemActions({ item }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const noteId = useId()
  const [mode, setMode] = useState<Mode>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [stamped, setStamped] = useState(false)
  const [reason, setReason] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const p = item.permits
  const anyAllowed = Object.values(p).some((x) => x === true)
  const blocked = [p.verify, p.edit].find((x) => x !== true) as string | undefined
  const verified = item.status === 'verified_matches_source' || item.status === 'edited'
  const source = item.sources.find((s) => s.href)

  async function send(action: 'verify' | 'edit' | 'reject' | 'dispute', extra: Record<string, unknown> = {}) {
    setBusy(action)
    setError(null)
    const r = await postJson(`/api/events/${item.id}/verify`, { action, rowVersion: item.rowVersion, ...extra })
    setBusy(null)
    if (r.ok) {
      setMode(null)
      if (action === 'verify') setStamped(true)
      else toast({ title: action === 'edit' ? 'Correction saved as a new version' : action === 'reject' ? 'Item rejected' : 'Item marked disputed', tone: action === 'edit' ? 'setu' : 'conflict' })
      router.refresh()
      return
    }
    const msg = r.data.error?.message ?? 'Something went wrong'
    if (r.status === 409) {
      setMode(null)
      toast({ title: 'Changed by someone else', description: msg, tone: 'unverified' })
      router.refresh()
    } else if (mode) setError(msg)
    else toast({ title: 'Not saved', description: msg, tone: 'conflict' })
  }

  function submit() {
    if (!mode) return
    if (!reason.trim()) return setError('Give a reason. It is stored with the verification record.')
    if (mode !== 'edit') return send(mode, { reason })
    const changed = Object.fromEntries(
      item.editable
        .filter((f) => fields[f.key] !== undefined && fields[f.key].trim() !== f.value.trim())
        .map((f) => [f.key, f.list ? fields[f.key].split(',').map((x) => x.trim()).filter(Boolean) : fields[f.key].trim()]),
    )
    if (!Object.keys(changed).length) return setError('Change at least one field.')
    return send('edit', { reason, fields: changed })
  }

  const open = (m: Exclude<Mode, null>) => {
    setMode(m)
    setReason('')
    setFields({})
    setError(null)
  }

  if (!anyAllowed) {
    return <p className="flex items-center gap-1.5 text-sm text-faint"><Lock aria-hidden className="size-3.5" />Headline view: verification is done by records staff and clinicians.</p>
  }

  return (
    <div className="grid w-full gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {source?.href && (
          <ButtonLink href={source.href} variant="secondary" size="sm" icon={<BookOpen aria-hidden />}>
            Open source
          </ButtonLink>
        )}
        {stamped || (verified && !busy) ? (
          <Stamp animate={stamped} rotate={-4}>
            <Check aria-hidden /> Verified
          </Stamp>
        ) : (
          <Button size="sm" icon={<Check aria-hidden />} loading={busy === 'verify'} disabled={p.verify !== true || !!busy} aria-describedby={blocked ? noteId : undefined} onClick={() => send('verify')}>
            Verify
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<Pencil aria-hidden />} disabled={p.edit !== true || !!busy} aria-describedby={blocked ? noteId : undefined} onClick={() => open('edit')}>
          Edit
        </Button>
        <Button size="sm" variant="ghost" icon={<X aria-hidden />} disabled={p.reject !== true || !!busy} aria-describedby={blocked ? noteId : undefined} onClick={() => open('reject')}>
          Reject
        </Button>
        {p.dispute === true && (
          <Button size="sm" variant="ghost" icon={<CircleAlert aria-hidden />} disabled={!!busy || item.status === 'disputed'} onClick={() => open('dispute')}>
            Dispute
          </Button>
        )}
      </div>
      {item.readings && p.edit === true && (
        // Day and month could be swapped: one click records the reading on the page as an edit (new version, original kept).
        <div role="group" aria-label="Pick the date" className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Which date is on the page?</span>
          {item.readings.map((r) => (
            <Button key={r.iso} size="sm" variant="secondary" disabled={!!busy}
              onClick={() => send('edit', { reason: `Day and month checked on the page: ${r.label}`, fields: { event_date_text: r.label } })}>
              {r.label}
            </Button>
          ))}
        </div>
      )}
      {blocked ? (
        <p id={noteId} className="flex items-center gap-1.5 text-sm text-muted"><Lock aria-hidden className="size-3.5 shrink-0" />{blocked}</p>
      ) : !verified && !stamped && !item.viewedSource && source ? (
        <p className="text-sm text-faint">Open the source before verifying. The verification records whether you did.</p>
      ) : null}

      <Dialog
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode ? TITLES[mode] : ''}
        description={mode ? `${item.typeLabel}. ${HELP[mode]}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
            <Button variant={mode === 'edit' ? 'primary' : 'danger'} loading={!!busy} onClick={submit}>
              {mode === 'edit' ? 'Save new version' : mode === 'reject' ? 'Reject item' : 'Mark disputed'}
            </Button>
          </>
        }
      >
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit() }}>
          {mode === 'edit' &&
            item.editable.map((f) => (
              <Field key={f.key} label={f.label} hint={f.list ? 'Separate items with commas.' : f.key === 'event_date_text' ? 'As written, e.g. 12/03/2026. The date is re-read from this text.' : undefined}>
                <Input value={fields[f.key] ?? f.value} onChange={(e) => setFields((s) => ({ ...s, [f.key]: e.target.value }))} />
              </Field>
            ))}
          <Field label="Reason" hint="Required. Stored with the verification record, never in the audit log." error={error ?? undefined}>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
          </Field>
        </form>
      </Dialog>
    </div>
  )
}
