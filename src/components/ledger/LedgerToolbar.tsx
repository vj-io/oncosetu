'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCheck, Stamp as StampIcon } from 'lucide-react'
import { BrassSeal, Button, Dialog, KeyValue, useToast } from '@/components/ui'
import type { LedgerView } from '@/server/ledger/core'
import { postJson } from './client'

type Sealed = { snapshotId: string; seq: number; sha256: string; keyId: string; sealedAt: string }

/** "Verify all eligible" (FR-LED-05) and "Seal snapshot" (FR-LED-01, clinicians). */
export function LedgerToolbar({ patientId, eligibleIds, counts, nextSeq, canSeal }: { patientId: string; eligibleIds: string[]; counts: LedgerView['counts']; nextSeq: number; canSeal: boolean }) {
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
        Verify all eligible ({eligibleIds.length})
      </Button>
      {canSeal && (
        <Button icon={<StampIcon aria-hidden />} disabled={!total && !counts.documents} onClick={() => { setDialog('seal'); setError(null) }}>
          Seal snapshot S{nextSeq}
        </Button>
      )}

      <Dialog
        open={dialog === 'bulk'}
        onClose={close}
        title={`Verify ${eligibleIds.length} items`}
        description="Only items with no conflict, no low OCR confidence, no identity warning, no uncertain binding and that are not newly received older records. Everything else stays for one-by-one review with its source open."
        footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button loading={busy} onClick={bulk}>Verify {eligibleIds.length}</Button></>}
      >
        <p className="text-[15px] text-muted">Each item gets its own verification record with your name, role and time.</p>
        {error && <p className="mt-3 text-sm text-madder-ink">{error}</p>}
      </Dialog>

      <Dialog
        open={dialog === 'seal'}
        onClose={close}
        title={sealed ? `Snapshot S${sealed.seq} sealed` : `Seal snapshot S${nextSeq}`}
        description={sealed ? 'Immutable, hashed and signed. Anyone with the link can check it has not changed.' : 'An immutable, signed copy of the record as it stands now. Unverified items are carried forward, clearly labelled.'}
        footer={sealed
          ? <Button onClick={close}>Done</Button>
          : <><Button variant="ghost" onClick={close}>Cancel</Button><Button loading={busy} icon={<StampIcon aria-hidden />} onClick={seal}>Press the seal</Button></>}
      >
        {sealed ? (
          <div className="grid justify-items-center gap-5 py-2 text-center">
            <BrassSeal animate code={sealed.sha256} label={`S${sealed.seq} sealed`} size={148} />
            <p className="font-mono text-[12px] leading-relaxed break-all text-muted">SHA-256 {sealed.sha256}</p>
            <p className="font-mono text-[11px] tracking-[0.12em] text-faint uppercase">Ed25519 · key {sealed.keyId}</p>
            <Link href={`/verify/${sealed.snapshotId}`} className="text-setu-ink underline decoration-brass underline-offset-4">Public verification page</Link>
          </div>
        ) : (
          <div className="grid gap-4">
            <KeyValue items={[
              { label: 'Verified', value: <span className="font-mono tabular-nums">{counts.verified}</span> },
              { label: 'Not yet verified', value: <span className="font-mono tabular-nums">{counts.unverified} <span className="font-sans text-muted">· carried forward, labelled</span></span> },
              { label: 'Disputed', value: <span className="font-mono tabular-nums">{counts.disputed}</span> },
              { label: 'Documents', value: <span className="font-mono tabular-nums">{counts.documents}</span> },
              { label: 'Missing', value: <span className="font-mono tabular-nums">{counts.missing} <span className="font-sans text-muted">· listed as not in file</span></span> },
            ]} />
            {error && <p className="text-sm text-madder-ink">{error}</p>}
          </div>
        )}
      </Dialog>
    </div>
  )
}
