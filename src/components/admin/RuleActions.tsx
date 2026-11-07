'use client'
import { useState } from 'react'
import { Button, Checkbox, Dialog, Field, Select, useToast } from '@/components/ui'
import { postJson, useRun } from './client'

/** FR-RAD-05: production needs the reviewing clinician's name and an explicit confirmation; shadow is one click back. */
export function RuleActions({ ruleId, mode, reviewers }: { ruleId: string; mode: 'production' | 'shadow'; reviewers: { id: string; name: string }[] }) {
  const { busy, run } = useRun()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [reviewerId, setReviewerId] = useState('')
  const [confirm, setConfirm] = useState(false)
  const close = () => { setOpen(false); setConfirm(false); setReviewerId('') }

  async function submit() {
    const r = await run(ruleId, () => postJson<{ itemsFlipped: number }>(`/api/admin/rules/${ruleId}`,
      mode === 'shadow' ? { mode: 'production', reviewerId, confirm } : { mode: 'shadow' }))
    if (r) {
      toast({ title: mode === 'shadow' ? 'Check switched on' : 'Check returned to review', description: `${r.itemsFlipped} existing item${r.itemsFlipped === 1 ? '' : 's'} ${mode === 'shadow' ? 'now shown to staff' : 'hidden again'}.`, tone: 'verified' })
      close()
    }
  }

  return (
    <>
      <Button size="sm" variant={mode === 'shadow' ? 'primary' : 'secondary'} onClick={() => setOpen(true)} aria-label={`${mode === 'shadow' ? 'Mark reviewed' : 'Return to review'}: ${ruleId}`}>
        {mode === 'shadow' ? 'Mark as reviewed by a clinician' : 'Return to review'}
      </Button>
      <Dialog open={open} onClose={close}
        title={mode === 'shadow' ? `Switch on ${ruleId}` : `Return ${ruleId} to review`}
        description={mode === 'shadow'
          ? 'Existing items for this rule become visible to staff. The reviewer and time are recorded on the rule and in the audit log.'
          : 'Existing items for this rule are hidden again (logged, not shown). Nothing is deleted.'}
        footer={<>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button onClick={submit} loading={busy === ruleId} disabled={mode === 'shadow' && (!reviewerId || !confirm)}>
            {mode === 'shadow' ? 'Record review and switch on' : 'Return to review'}
          </Button>
        </>}>
        {mode === 'shadow' ? (
          <div className="grid gap-4">
            {reviewers.length === 0 ? (
              <p className="text-madder-ink">No active clinician account exists in this organisation to name as reviewer. Add one under Staff first.</p>
            ) : (
              <Field label="Reviewing clinician" hint="Must be an active clinician of this organisation.">
                <Select value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
                  <option value="">Choose a clinician</option>
                  {reviewers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </Field>
            )}
            <Checkbox checked={confirm} onChange={(e) => setConfirm(e.target.checked)}
              label="I confirm this clinician reviewed the rule and its EN and HI wording"
              description="The wording must describe documents only: whether a document is in the file, never what care is needed." />
          </div>
        ) : (
          <p className="text-[15px]">The rule keeps running and logging; its items stop appearing on completeness lists.</p>
        )}
      </Dialog>
    </>
  )
}
