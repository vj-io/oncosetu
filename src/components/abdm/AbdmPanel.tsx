'use client'

// FR-ING-ABDM-01/02 on the Documents tab: ask the patient for ABDM records, follow the request and transfer states, and
// open what arrived (structured FHIR documents) in the source viewer.
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, CloudDownload, Network, RefreshCw } from 'lucide-react'
import { Badge, Button, Checkbox, Chip, Field, Input, type Tone } from '@/components/ui'
import { postJson } from '@/components/registration/api'
import { Notice } from '@/components/registration/Notice'
import { fmtDate, fmtDateTime } from '@/components/documents/labels'
import type { StaffAbdmView } from '@/server/abdm/flow'

const HI_TYPES = [
  ['DiagnosticReport', 'Diagnostic reports (lab, imaging, pathology)'],
  ['DischargeSummary', 'Discharge summaries'],
  ['OPConsultation', 'OP consultations'],
  ['Prescription', 'Prescriptions'],
] as const
const HI_LABEL: Record<string, string> = { DiagnosticReport: 'Diagnostic reports', DischargeSummary: 'Discharge summaries', OPConsultation: 'OP consultations', Prescription: 'Prescriptions' }
const STATE: Record<string, { tone: Tone; label: string }> = {
  REQUESTED: { tone: 'unverified', label: 'Waiting for the patient' },
  GRANTED: { tone: 'verified', label: 'Granted' },
  DENIED: { tone: 'conflict', label: 'Declined' },
  REVOKED: { tone: 'shadow', label: 'Revoked · erased' },
  EXPIRED: { tone: 'shadow', label: 'Expired · erased' },
}
const XFER: Record<string, Tone> = { REQUESTED: 'unverified', TRANSFERRED: 'verified', FAILED: 'conflict', ERASED: 'shadow' }
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const yearsAgo = (n: number) => `${Number(today().slice(0, 4)) - n}${today().slice(4)}`

export function AbdmPanel({ patientId }: { patientId: string }) {
  const router = useRouter()
  const [view, setView] = useState<StaffAbdmView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const seen = useRef<string | null>(null)
  const [form, setForm] = useState({ types: HI_TYPES.map(([k]) => k as string), from: yearsAgo(2), to: today() })

  const [tick, setTick] = useState(0)
  const reload = () => setTick((t) => t + 1)
  useEffect(() => {
    let alive = true
    fetch(`/api/patients/${patientId}/abdm`, { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<StaffAbdmView>) : Promise.reject(new Error(String(res.status)))))
      .then((v) => {
        if (!alive) return
        // A transfer landed or data was erased since the last look: refresh the document index above.
        const sig = JSON.stringify([v.documents.map((d) => d.id), v.requests.map((r) => r.state)])
        if (seen.current !== null && seen.current !== sig) router.refresh()
        seen.current = sig
        setView(v)
      })
      .catch(() => { if (alive) setError('Could not load ABDM requests. Reload to try again.') })
    return () => { alive = false }
  }, [patientId, router, tick])
  // While a request waits for the patient, look again every 10 s.
  const waiting = !!view?.requests.some((r) => r.state === 'REQUESTED')
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => setTick((n) => n + 1), 10_000)
    return () => clearInterval(t)
  }, [waiting])

  async function request() {
    setError(null); setDone(null)
    if (!form.types.length) return setError('Pick at least one kind of record.')
    if (!form.from || !form.to || form.from > form.to) return setError('Pick a date range: the start on or before the end.')
    setBusy(true)
    const r = await postJson(`/api/patients/${patientId}/abdm/consent-requests`, { hiTypes: form.types, from: form.from, to: form.to })
    setBusy(false)
    if (!r.ok) return setError(r.message)
    setDone('Consent request sent. The patient approves or declines it in their portal; records arrive only after that.')
    reload()
  }

  const ready = view?.ready
  const blocked = ready && (!ready.abha ? 'No ABHA number is recorded for this patient (add it at registration).' : !ready.consent ? 'The patient has not consented to ABDM pull (consent purpose d). Record it on the Consent tab first.' : null)

  return (
    <section aria-labelledby="abdm-h" className="grid gap-5 border border-rule bg-surface p-5 shadow-placard [&>*]:min-w-0">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="ds-kicker flex items-center gap-1.5"><Network aria-hidden className="size-3.5" /> ABDM · health information exchange</p>
          <h2 id="abdm-h" className="text-xl">Records from ABDM <span data-testid="abdm-planned" className="ml-2 inline-block border border-amber bg-amber-tint px-2 py-0.5 align-middle font-mono text-[11px] tracking-[0.08em] text-amber-ink uppercase">Planned: not live yet</span></h2>
          <p className="max-w-2xl text-[15px] text-muted">
            Ask the patient to share records linked to their ABHA. Bundles are decrypted only after the consent artefact is checked, mapped from FHIR
            into facts with their source resource, and erased when the artefact ends or the patient revokes it.
          </p>
          <p className="max-w-2xl text-[15px] text-muted">
            Planned, not live: production access as a health information user takes 3–6 months of ABDM approval. Today the
            ways in are the desk, the patient&apos;s own upload or forward, and a records request letter.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ready && <Chip kicker="Gateway" tone={ready.transport === 'sandbox' ? 'setu' : 'shadow'}>{ready.transport === 'sandbox' ? 'ABDM sandbox' : 'In-process (synthetic HIP)'}</Chip>}
          <Button variant="ghost" size="sm" icon={<RefreshCw aria-hidden />} onClick={reload}>Refresh</Button>
        </div>
      </header>

      {blocked ? <Notice tone="unverified" title="Cannot request yet">{blocked}</Notice> : view && (
        <div className="grid gap-4 border border-rule bg-gallery p-4">
          <fieldset className="grid gap-2">
            <legend className="ds-kicker mb-1 text-muted">Kinds of records</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {HI_TYPES.map(([k, label]) => (
                <Checkbox key={k} label={label} checked={form.types.includes(k)}
                  onChange={(e) => setForm({ ...form, types: e.target.checked ? [...form.types, k] : form.types.filter((t) => t !== k) })} />
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From"><Input type="date" value={form.from} max={form.to} onChange={(e) => setForm({ ...form, from: e.target.value })} /></Field>
            <Field label="To"><Input type="date" value={form.to} max={today()} onChange={(e) => setForm({ ...form, to: e.target.value })} /></Field>
          </div>
          <div><Button onClick={request} loading={busy} icon={<CloudDownload aria-hidden />}>Request records</Button></div>
        </div>
      )}

      {error && <Notice tone="conflict" title={error} />}
      {done && <Notice tone="verified" title={done} />}

      {view && view.requests.length > 0 && (
        <ul aria-label="ABDM consent requests" className="grid divide-y divide-rule border-y border-rule">
          {view.requests.map((r) => (
            <li key={r.id} className="grid gap-2 py-3" data-testid="abdm-request">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STATE[r.state].tone}>{STATE[r.state].label}</Badge>
                <span className="text-[15px]">{r.hiTypes.map((h) => HI_LABEL[h] ?? h).join(', ')}</span>
                <span className="text-sm text-muted">· {fmtDate(r.from)} – {fmtDate(r.to)}</span>
              </div>
              <p className="text-sm text-faint">
                Asked {fmtDateTime(r.createdAt)}{r.requestedBy ? ` by ${r.requestedBy}` : ''}
                {r.decidedAt ? ` · answered ${fmtDateTime(r.decidedAt)}` : ''}
                {r.erasedAt ? ` · data erased ${fmtDateTime(r.erasedAt)}` : r.state === 'GRANTED' ? ` · erase-at ${fmtDateTime(r.eraseAt)}` : ''}
              </p>
              {r.transfers.map((x) => (
                <p key={x.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={XFER[x.state]}>Transfer {x.state.toLowerCase()}</Badge>
                  <span className="text-muted">
                    {x.entries} encrypted entr{x.entries === 1 ? 'y' : 'ies'} · {x.documents} document{x.documents === 1 ? '' : 's'} added
                    {x.failure ? ` · refused: ${x.failure.replace(/_/g, ' ')}` : ''}
                    {x.receivedAt ? ` · ${fmtDateTime(x.receivedAt)}` : ''}
                  </span>
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}

      {view && view.documents.length > 0 && (
        <div className="grid gap-2">
          <h3 className="ds-kicker text-muted">Received bundles</h3>
          <ul aria-label="ABDM documents" className="grid gap-2">
            {view.documents.map((d) => (
              <li key={d.id}>
                <Link href={`/patients/${patientId}/documents/${d.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-rule bg-gallery px-3 py-2 hover:bg-spotlight">
                  <span className="font-medium">{d.title}</span>
                  <Chip tone="setu">ABDM · structured</Chip>
                  <span className="text-sm text-muted">{fmtDate(d.documentDate)}{d.institution ? ` · ${d.institution}` : ''} · {d.events} fact{d.events === 1 ? '' : 's'} · FHIR {d.recordType}</span>
                  <ArrowRight aria-hidden className="ml-auto size-4" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
