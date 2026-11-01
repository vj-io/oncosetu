'use client'
import { Button } from '@/components/ui'
import { postJson, useRun } from './client'

/** FR-VER-04: agree / disagree on a sampled item (clinician other than the verifier). */
export function QaReview({ verificationId }: { verificationId: string }) {
  const { busy, run } = useRun()
  const go = (outcome: 'agree' | 'disagree') =>
    run(outcome, () => postJson('/api/admin/metrics/qa', { verificationId, outcome }), outcome === 'agree' ? 'Second review recorded: agree' : 'Second review recorded: disagree')
  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="secondary" loading={busy === 'agree'} disabled={busy !== null} onClick={() => go('agree')}>Agree</Button>
      <Button size="sm" variant="danger" loading={busy === 'disagree'} disabled={busy !== null} onClick={() => go('disagree')}>Disagree</Button>
    </div>
  )
}
