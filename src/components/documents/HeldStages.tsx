import { Check, PauseCircle } from 'lucide-react'
import { STAGE_LABELS } from './labels'

/** Pipeline stopped for a person (identity decision): the stages done, then where it waits. Server-safe. */
export function HeldStages({ at }: { at: number }) {
  return (
    <ol aria-label="Processing stages" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
      {STAGE_LABELS.slice(0, at).map((s) => (
        <li key={s} className="inline-flex items-center gap-1.5 text-ink">
          <span aria-hidden className="grid size-5 place-items-center rounded-full bg-sage text-white"><Check className="size-3" strokeWidth={3} /></span>
          {s}<span className="sr-only"> (done)</span>
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5 border border-madder bg-madder-tint px-2 py-1 font-mono text-[11px] tracking-[0.12em] text-madder-ink uppercase">
        <PauseCircle aria-hidden className="size-3.5" /> {STAGE_LABELS[at]} · held for a person
      </li>
      <li className="text-faint">then {STAGE_LABELS.slice(at + 1).join(' → ')}</li>
    </ol>
  )
}
