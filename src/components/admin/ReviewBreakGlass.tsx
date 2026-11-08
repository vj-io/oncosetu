'use client'
import { Button } from '@/components/ui'
import { postJson, useRun } from './client'

/** FR-ID-10: clears one grant from the administrator alert. */
export function ReviewBreakGlass({ id, patient }: { id: string; patient: string }) {
  const { busy, run } = useRun()
  return (
    <Button size="sm" variant="secondary" loading={busy === id} aria-label={`Mark the grant for ${patient} reviewed`}
      onClick={() => run(id, () => postJson(`/api/admin/break-glass/${id}/review`), 'Marked as reviewed')}>
      Mark reviewed
    </Button>
  )
}
