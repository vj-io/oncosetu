'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, KeyRound, Plus, RefreshCw, Tag, Unlink } from 'lucide-react'
import { Button, Field, Input, Select, StageTracker, Textarea, useToast } from '@/components/ui'
import { EVENT_FIELDS, EXTRACTABLE_EVENT_TYPES } from '@/core/types'
import { HeldStages } from './HeldStages'
import { postJson } from './IdentityDecision'
import { DOC_TYPE_OPTIONS, EVENT_LABEL, FIELD_LABEL, STAGE_LABELS, trackerPosition, type StageState } from './labels'

/** Polls the status route while the document is in the pipeline; refreshes the page when it moves. */
export function LiveStage({ documentId, initial }: { documentId: string; initial: { status: string; stages: { key: string; state: StageState }[] } }) {
  const router = useRouter()
  const [s, setS] = useState(initial)
  const last = useRef(JSON.stringify(initial))
  useEffect(() => {
    if (s.status !== 'queued' && s.status !== 'processing') return
    const t = setInterval(async () => {
      const r = await fetch(`/api/documents/${documentId}/status`, { cache: 'no-store' })
      if (!r.ok) return
      const j = await r.json()
      const next = { status: j.status, stages: j.stages }
      if (JSON.stringify(next) !== last.current) {
        last.current = JSON.stringify(next)
        setS(next)
        if (j.status !== 'queued' && j.status !== 'processing') router.refresh()
      }
    }, 1500)
    return () => clearInterval(t)
  }, [documentId, router, s.status])
  const pos = trackerPosition(s.stages)
  return (
    <div className="grid gap-2">
      {pos.waiting ? <HeldStages at={pos.current} /> : <StageTracker stages={STAGE_LABELS} current={pos.current} failed={pos.failed} label="Processing stages" />}
    </div>
  )
}

function useAction() {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (url: string, body: unknown, ok: string) => {
    setBusy(true)
    setError(null)
    const r = await postJson(url, body)
    setBusy(false)
    if (!r.ok) {
      setError(r.data.error?.message ?? 'Something went wrong')
      return false
    }
    toast({ title: ok, tone: 'verified' })
    router.refresh()
    return true
  }
  return { busy, error, run }
}

export function TagForm({ documentId, initial, handwritten }: { documentId: string; initial: { docType: string | null; documentDate: string | null; institution: string | null }; handwritten: boolean }) {
  const [docType, setDocType] = useState(initial.docType ?? 'other')
  const [date, setDate] = useState(initial.documentDate ?? '')
  const [inst, setInst] = useState(initial.institution ?? '')
  const a = useAction()
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void a.run(`/api/documents/${documentId}/tags`, { docType, documentDate: date || null, institution: inst || null }, handwritten ? 'Tags saved — the image stays the source' : 'Tags saved')
      }}
    >
      <Field label="Document type"><Select value={docType} onChange={(e) => setDocType(e.target.value)}>{DOC_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Document date" optional><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Institution" optional><Input value={inst} maxLength={200} onChange={(e) => setInst(e.target.value)} /></Field>
      </div>
      {a.error && <p className="text-sm text-madder-ink">{a.error}</p>}
      <div><Button type="submit" size="sm" icon={<Tag />} loading={a.busy}>Save tags</Button></div>
    </form>
  )
}

export function ManualEventForm({ documentId, pages }: { documentId: string; pages: number[] }) {
  const [type, setType] = useState<string>('lab_report_documented')
  const [pageNo, setPageNo] = useState(pages[0] ?? 1)
  const [quote, setQuote] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const a = useAction()
  const allowed = (EVENT_FIELDS[type as keyof typeof EVENT_FIELDS] ?? []).filter((f) => f !== 'event_date')
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault()
        const body: Record<string, string | string[]> = {}
        for (const [k, v] of Object.entries(fields)) if (v.trim() && allowed.includes(k)) body[k] = k.endsWith('_names') ? v.split(',').map((x) => x.trim()).filter(Boolean) : v.trim()
        if (await a.run(`/api/documents/${documentId}/manual-events`, { eventType: type, fields: body, quote, pageNo }, 'Fact added with its quote')) {
          setQuote('')
          setFields({})
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Field label="Fact type"><Select value={type} onChange={(e) => setType(e.target.value)}>{EXTRACTABLE_EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_LABEL[t]}</option>)}</Select></Field>
        <Field label="Page"><Select value={String(pageNo)} onChange={(e) => setPageNo(Number(e.target.value))}>{pages.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
      </div>
      <Field label="Words from the page (copy them exactly)" hint="8 to 300 characters. Every detail below must appear inside these words.">
        <Textarea rows={3} value={quote} maxLength={300} onChange={(e) => setQuote(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {allowed.map((k) => (
          <Field key={k} label={FIELD_LABEL[k] ?? k} optional hint={k.endsWith('_names') ? 'Comma-separated' : undefined}>
            <Input value={fields[k] ?? ''} onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))} />
          </Field>
        ))}
      </div>
      {a.error && <p className="text-sm text-madder-ink">{a.error}</p>}
      <div><Button type="submit" size="sm" icon={<Plus />} loading={a.busy}>Add fact</Button></div>
    </form>
  )
}

export function ReprocessButton({ documentId }: { documentId: string }) {
  const a = useAction()
  return (
    <span className="grid gap-1">
      <Button size="sm" variant="secondary" icon={<RefreshCw />} loading={a.busy} onClick={() => a.run(`/api/documents/${documentId}/reprocess`, {}, 'Reprocessing')}>Reprocess</Button>
      {a.error && <span className="text-sm text-madder-ink">{a.error}</span>}
    </span>
  )
}

/** FR-DOC-06: a person confirms a low-confidence fact against the page image; only then does it enter the record. */
export function PageCheckButton({ eventId, rowVersion }: { eventId: string; rowVersion: number }) {
  const a = useAction()
  return (
    <span className="grid gap-1">
      <Button size="sm" variant="secondary" icon={<Check />} loading={a.busy} onClick={() => a.run(`/api/events/${eventId}/verify`, { action: 'verify', rowVersion }, 'Checked against the page: added to the record')}>
        Checked against the page
      </Button>
      {a.error && <span className="text-sm text-madder-ink">{a.error}</span>}
    </span>
  )
}

export function DetachForm({ documentId }: { documentId: string }) {
  const [reason, setReason] = useState('')
  const a = useAction()
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void a.run(`/api/documents/${documentId}/detach`, { reason }, 'Detached — its facts were withdrawn') }}>
      <Field label="Reason" error={a.error ?? undefined} hint="Facts from this file are withdrawn; sealed snapshots that included them get an erratum.">
        <Textarea rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div><Button type="submit" size="sm" variant="danger" icon={<Unlink />} loading={a.busy} disabled={reason.trim().length < 3}>Detach from this patient</Button></div>
    </form>
  )
}

export function PasswordForm({ documentId, incorrect }: { documentId: string; incorrect: boolean }) {
  const [pw, setPw] = useState('')
  const a = useAction()
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void a.run(`/api/documents/${documentId}/password`, { password: pw }, 'Opening with the password').then(() => setPw('')) }}>
      <Field label="PDF password" error={a.error ?? (incorrect ? 'That password did not open the file.' : undefined)} hint="Labs often use the date of birth or phone number. Used once to read the file; never stored.">
        <Input type="password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
      <div><Button type="submit" size="sm" icon={<KeyRound />} loading={a.busy} disabled={!pw}>Open file</Button></div>
    </form>
  )
}
