import { Check, Minus, PauseCircle, X } from 'lucide-react'
import { STAGE_LABELS } from './labels'

const IDENTITY = STAGE_LABELS.indexOf('Patient match')
/** Stages a stored-only file (scan, ECG, video) never goes through: nothing is read from it. */
const NOT_READ = new Set<string>(['Reading', 'Sorting', 'Facts', 'Quote check'])

/**
 * Pipeline stopped for a person (identity decision): the stages done, then where it waits. Server-safe.
 * `identityFailed`: the name and details did not match, so "Patient match" is shown as failed and held, not as done.
 * `storedOnly`: a scan or other file that is stored and never read, so the reading stages are shown as skipped, not done.
 */
export function HeldStages({ at, identityFailed = false, storedOnly = false }: { at: number; identityFailed?: boolean; storedOnly?: boolean }) {
  const stopAt = identityFailed ? IDENTITY : at
  const done = STAGE_LABELS.slice(0, stopAt)
  const rest = STAGE_LABELS.slice(stopAt + 1)
  return (
    <ol aria-label="Processing stages" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
      {done.map((s) => (
        storedOnly && NOT_READ.has(s)
          ? (
            <li key={s} className="inline-flex items-center gap-1.5 text-muted">
              <span aria-hidden className="grid size-5 place-items-center rounded-full border border-dashed border-control"><Minus className="size-3" /></span>
              {s}<span className="sr-only"> (not done: this file is stored, not read)</span>
            </li>
          )
          : (
            <li key={s} className="inline-flex items-center gap-1.5 text-ink">
              <span aria-hidden className="grid size-5 place-items-center rounded-full bg-sage text-white"><Check className="size-3" strokeWidth={3} /></span>
              {s}<span className="sr-only"> (done)</span>
            </li>
          )
      ))}
      <li className="inline-flex items-center gap-1.5 border border-madder/40 bg-madder-tint px-2 py-1 text-[13px] text-madder-ink font-medium rounded-full" data-testid="held-stage">
        {identityFailed ? <X aria-hidden className="size-3.5" /> : <PauseCircle aria-hidden className="size-3.5" />}
        {identityFailed ? `${STAGE_LABELS[stopAt]}: failed, held for a person` : `${STAGE_LABELS[stopAt]} · held for a person`}
      </li>
      {rest.length > 0 && <li className="text-faint">{storedOnly ? 'not done' : 'then'} {rest.join(' → ')}</li>}
    </ol>
  )
}
