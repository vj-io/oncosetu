'use client'
// Staff (records, clinician) record an erasure request on the patient's request, from the denial screen that consent
// withdrawal leaves behind (J8, PRD §10.5). Nothing is deleted: the request is queued until the retention period has run.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eraser } from 'lucide-react'
import { Button, Checkbox } from '@/components/ui'
import { postJson } from '@/components/registration/api'

export function RecordErasure({ patientId, status }: { patientId: string; status: string | null }) {
  const router = useRouter()
  const [asked, setAsked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (status) return <p role="status" className="border border-rule bg-surface px-4 py-3 text-sm">{status}</p>

  async function record() {
    setBusy(true)
    setError(null)
    const r = await postJson(`/api/patients/${patientId}/erasure`)
    setBusy(false)
    if (r.ok) router.refresh()
    else setError(r.message)
  }

  return (
    <div className="grid gap-2 border border-rule bg-surface px-4 py-3 text-left">
      <p className="text-sm font-medium">Erasure request</p>
      <p className="text-sm text-muted">Consent was withdrawn. If the patient or caregiver asked for the record to be erased, record it here. It is queued until the retention period has run; nothing is deleted now.</p>
      <Checkbox label="The patient or caregiver asked for erasure" checked={asked} onChange={(e) => setAsked(e.target.checked)} />
      <div><Button variant="secondary" loading={busy} disabled={!asked} onClick={record} icon={<Eraser aria-hidden />}>Record erasure request</Button></div>
      {error && <p role="alert" className="text-sm text-madder-ink">{error}</p>}
    </div>
  )
}
