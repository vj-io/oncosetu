// Shared by the staff/patient components (RequestList, CreateShareForm): the patient and caregiver side gets 44px
// targets (36px is the dense staff size) and, in Hindi, plain Devanagari type: the design system's tracked mono
// capitals break conjuncts and read badly.
import type { ReactNode } from 'react'
import type { Lang } from '@/core/types'

export function sideStyle(actor: 'staff' | 'patient', lang: Lang) {
  const deva = lang === 'hi'
  return {
    size: actor === 'patient' ? ('md' as const) : ('sm' as const),
    /** Extra classes for a design-system Button/ButtonLink (`!` beats its own font/tracking/case utilities). */
    btn: deva ? 'font-deva! normal-case! tracking-normal! text-[15px]!' : undefined,
    /** Extra classes for a `ds-kicker`. */
    kicker: deva ? 'font-deva normal-case tracking-normal text-[15px]' : undefined,
    /** Wraps text that sits inside a tracked, uppercase container (Field label, StatusBadge). */
    plain: (node: ReactNode) => (deva ? <span className="font-deva text-[15px] tracking-normal normal-case">{node}</span> : node),
  }
}
