'use client'
// J8: org_admin executes due erasure requests (one, or every due one). The DB function re-checks everything.
import { useState } from 'react'
import { Eraser } from 'lucide-react'
import { Button, Dialog } from '@/components/ui'
import { postJson, useRun } from '@/components/admin/client'

const WHAT = (
  <div className="grid gap-3 text-sm">
    <p><strong>Deleted:</strong> documents with their original files and page images, extracted text, record items (every version) and their evidence, verifications, patient statements, completeness items, record requests, sealed snapshots, share links and their view log, caregivers, other names, visits, sessions, AI processing records and messages.</p>
    <p><strong>Kept:</strong> a tombstone (record id, status and erasure date; name, date of birth, phone, ABHA, MRN and card token removed), the consent history (the legal record of the withdrawal), the request itself, and the audit trail (ids only).</p>
    <p>This cannot be undone.</p>
  </div>
)

function Confirm({ trigger, title, confirm, disabled, hint, onConfirm, busy }: {
  trigger: string; title: string; confirm: string; disabled: boolean; hint?: string; busy: boolean; onConfirm: () => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="secondary" disabled={disabled} title={hint} onClick={() => setOpen(true)} icon={<Eraser aria-hidden />}>{trigger}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} footer={<>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="danger" loading={busy} onClick={async () => { await onConfirm(); setOpen(false) }}>{confirm}</Button>
      </>}>{WHAT}</Dialog>
    </>
  )
}

export function ExecuteErasure({ id, accession, due, eligibleAfter }: { id: string; accession: string; due: boolean; eligibleAfter: string }) {
  const { busy, run } = useRun()
  return (
    <Confirm trigger="Execute now" title={`Erase the records of ${accession}?`} confirm="Erase records" busy={busy === id}
      disabled={!due} hint={due ? undefined : `Eligible after ${eligibleAfter}`}
      onConfirm={() => run(id, () => postJson(`/api/admin/erasure/${id}/execute`), 'Records erased')} />
  )
}

export function RunDueErasures({ count }: { count: number }) {
  const { busy, run } = useRun()
  return (
    <Confirm trigger={`Run all due (${count})`} title={`Erase the records of ${count} patient${count === 1 ? '' : 's'}?`} confirm="Erase all due"
      busy={busy === 'all'} disabled={count === 0}
      onConfirm={() => run('all', () => postJson('/api/admin/erasure/run-due'), 'Due requests processed')} />
  )
}
