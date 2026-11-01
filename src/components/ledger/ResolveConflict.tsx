'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Scale } from 'lucide-react'
import { Button, Dialog, Field, Textarea, useToast } from '@/components/ui'
import { postJson } from './client'

type Side = { id: string; kind: 'event' | 'statement'; label: string }

export function ResolveConflict({ eventId, sides }: { eventId: string; sides: Side[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [keep, setKeep] = useState<string>('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!note.trim()) return setError('Write a short note: it is kept with both items.')
    setBusy(true)
    const r = await postJson(`/api/events/${eventId}/resolve`, { note, ...(keep ? { keepEventId: keep } : {}) })
    setBusy(false)
    if (!r.ok) return setError(r.data.error?.message ?? 'Not saved')
    setOpen(false)
    toast({ title: 'Conflict resolved', description: keep ? 'The kept side is verified; the other stays as documented.' : 'Both sides stay as documented.', tone: 'verified' })
    router.refresh()
  }

  return (
    <>
      <Button size="sm" variant="secondary" icon={<Scale aria-hidden />} onClick={() => { setOpen(true); setError(null) }}>Resolve</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Resolve conflict"
        description="Nothing is deleted. Choose the side that is right, or keep both, and note why."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={submit}>Mark resolved</Button></>}
      >
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit() }}>
          <fieldset className="grid gap-1">
            <legend className="ds-kicker mb-2 text-muted">Which is right?</legend>
            {[...sides.filter((s) => s.kind === 'event').map((s) => ({ v: s.id, l: `Keep and verify — ${s.label}` })), { v: '', l: 'Both stand as documented' }].map((o) => (
              <label key={o.v || 'both'} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
                <input type="radio" name="keep" value={o.v} checked={keep === o.v} onChange={() => setKeep(o.v)} className="size-4 accent-ink" />
                {o.l}
              </label>
            ))}
          </fieldset>
          <Field label="Note" hint="Required. Stored with the verification record." error={error ?? undefined}>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
        </form>
      </Dialog>
    </>
  )
}
