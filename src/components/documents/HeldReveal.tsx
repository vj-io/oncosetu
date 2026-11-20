'use client'

import { useState, type ReactNode } from 'react'
import { Eye, EyeOff } from 'lucide-react'

/**
 * A file that may belong to another patient is kept small and blurred until a person chooses to look at it, so a stranger's
 * scan is never shown at full size under this patient's name by accident. Nothing is read from the picture.
 */
export function HeldReveal({ nameOnFile, children }: { nameOnFile: string | null; children?: ReactNode }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="grid gap-3" data-testid="held-reveal" data-revealed={shown ? 'true' : 'false'}>
      <div
        className={shown ? '' : 'pointer-events-none max-h-40 overflow-hidden blur-xl select-none'}
        aria-hidden={shown ? undefined : true}
        inert={shown ? undefined : true}
        data-testid="held-reveal-content"
      >
        {children}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setShown((s) => !s)} aria-pressed={shown} className="inline-flex min-h-10 items-center gap-2 border border-obsidian px-3 text-sm hover:bg-spotlight">
          {shown ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          {shown ? 'Hide the file again' : 'Show the file anyway'}
        </button>
        <span className="text-[13px] text-muted">{shown ? 'Shown because a person asked. ' : 'Hidden until a person asks to see it. '}It may be another patient{nameOnFile ? `, ${nameOnFile}` : ''}.</span>
      </div>
    </div>
  )
}

/** True when a paper may belong to another patient: the identity check failed or a person has not yet decided. */
export const isHeldFile = (r: { attachState?: string | null; identity?: string | null }) => r.attachState === 'pending_decision' || r.identity === 'mismatch'

/** The small picture beside a list row. A held file is blurred, unreachable and labelled, the same as the large viewer. */
export function ThumbPicture({ src, alt, held }: { src: string; alt: string; held: boolean }) {
  return (
    <div className="grid justify-items-start gap-1" data-testid="thumb" data-held={held ? 'true' : 'false'}>
      <div className={held ? 'pointer-events-none size-24 overflow-hidden select-none' : 'size-24'} aria-hidden={held ? true : undefined} inert={held ? true : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={held ? '' : alt} width={96} height={96} loading="lazy" draggable={false} className={`size-24 border border-rule bg-obsidian object-contain ${held ? 'blur-xl' : ''}`} />
      </div>
      {held && <span className="text-[12px] font-medium text-madder-ink" data-testid="thumb-held-label">Held: may be another patient</span>}
    </div>
  )
}
