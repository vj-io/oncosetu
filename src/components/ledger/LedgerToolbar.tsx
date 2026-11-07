'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCheck, Stamp as StampIcon } from 'lucide-react'
import { BrassSeal, Button, Dialog, KeyValue, useToast } from '@/components/ui'
import type { LedgerView } from '@/server/ledger/core'
import { postJson } from './client'

type Sealed = { snapshotId: string; seq: number; sha256: string; keyId: string; sealedAt: string }

/** "Verify opened items" (FR-LED-05; only items whose source this person opened) and "Seal snapshot" (FR-LED-01, clinicians). */
export function LedgerToolbar({ patientId, eligibleIds, counts, canSeal }: { patientId: string; eligibleIds: string[]; counts: LedgerView['counts']; canSeal: boolean }) {
  const router = useRouter()
  const { toast } = useToast()
  const [dialog, setDialog] = useState<'bulk' | 'seal' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sealed, setSealed] = useState<Sealed | null>(null)

  async function bulk() {
    setBusy(true)
    const r = await postJson<{ verified: string[]; skipped: { id: string }[] }>(`/api/patients/${patientId}/verify-bulk`, { eventIds: eligibleIds })
    setBusy(false)
    if (!r.ok) return setError(r.data.error?.message ?? 'Not saved')
    setDialog(null)
    const skipped = r.data.skipped.length
    toast({ title: `${r.data.verified.length} verified`, description: skipped ? `${skipped} changed meanwhile and stay for one-by-one review.` : undefined, tone: 'verified' })
    router.refresh()
  }

  async function seal() {
    setBusy(true)
    const r = await postJson<Sealed>(`/api/patients/${patientId}/seal`)
    setBusy(false)
    if (!r.ok) return setError(r.data.error?.message ?? 'Not sealed')
    setSealed(r.data)
  }

  const close = () => {
    setDialog(null)
    setError(null)
    if (sealed) {
      setSealed(null)
      router.refresh()
    }
  }
  const total = counts.verified + counts.unverified + counts.disputed

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" icon={<CheckCheck aria-hidden />} disabled={!eligibleIds.length} onClick={() => { setDialog('bulk'); setError(null) }}>
        Mark opened items as checked ({eligibleIds.length})
      </Button>
      {canSeal && (
        <Button icon={<StampIcon aria-hidden />} disabled={!total && !counts.documents} onClick={() => { setDialog('seal'); setError(null) }}>
          Seal this visit
        </Button>
      )}

      <Dialog
        open={dialog === 'bulk'}
        onClose={close}
        title={`Mark ${eligibleIds.length} items as checked`}
        description="Only items whose page you opened and that have no disagreement, no photo-reading doubt, no name warning and no doubt about which line they belong to. Everything else stays for checking one at a time with the page open."
        footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button loading={busy} onClick={bulk}>Mark {eligibleIds.length} as checked</Button></>}
      >
        <p className="text-[15px] text-muted">Each item records your name, role and the time you checked it.</p>
        {error && <p className="mt-3 text-sm text-madder-ink">{error}</p>}
      </Dialog>

      <Dialog
        open={dialog === 'seal'}
        onClose={close}
        title={sealed ? 'Visit sealed' : 'Seal this visit'}
        description={sealed ? 'The record is now fixed as it stood at this visit. Anyone with the link can check it has not changed.' : 'This saves a copy of the record exactly as it is now. It cannot be changed afterwards. Items not yet checked are kept and clearly marked as unchecked.'}
        footer={sealed
          ? <Button onClick={close}>Done</Button>
          : <><Button variant="ghost" onClick={close}>Cancel</Button><Button loading={busy} icon={<StampIcon aria-hidden />} onClick={seal}>Seal it</Button></>}
      >
        {sealed ? (
          <div className="grid justify-items-center gap-5 py-2 text-center">
            <BrassSeal animate code={sealed.sha256} label="Sealed" size={148} />
            <Link href={`/verify/${sealed.snapshotId}`} className="text-setu-ink underline decoration-brass underline-offset-4">Check the seal (public page)</Link>
            <details className="text-left text-[13px] text-muted">
              <summary className="cursor-pointer">Technical details</summary>
              <p className="mt-1 font-mono break-all">SHA-256 {sealed.sha256}</p>
              <p className="font-mono">Ed25519 key {sealed.keyId}</p>
            </details>
          </div>
        ) : (
          <div className="grid gap-4">
            <KeyValue items={[
              { label: 'Checked against the page', value: <span className="font-mono tabular-nums">{counts.verified}</span> },
              { label: 'Not yet checked', value: <span className="font-mono tabular-nums">{counts.unverified} <span className="font-sans text-muted">· kept, marked as unchecked</span></span> },
              { label: 'Disputed', value: <span className="font-mono tabular-nums">{counts.disputed}</span> },
              { label: 'Documents', value: <span className="font-mono tabular-nums">{counts.documents}</span> },
              { label: 'Papers not in file', value: <span className="font-mono tabular-nums">{counts.missing} <span className="font-sans text-muted">· listed in the record</span></span> },
            ]} />
            {error && <p className="text-sm text-madder-ink">{error}</p>}
          </div>
        )}
      </Dialog>
    </div>
  )
}
