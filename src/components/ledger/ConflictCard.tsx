import { GitCompare, Lock } from 'lucide-react'
import { Chip, Frame, StatusBadge } from '@/components/ui'
import type { ConflictView, SideView } from '@/server/ledger/core'
import { Sources } from './LedgerItem'
import { ResolveConflict } from './ResolveConflict'

function Side({ s, label }: { s: SideView; label: string }) {
  return (
    <div className="grid content-start gap-3 bg-surface px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="ds-kicker">{label} · {s.title}</p>
        {s.status && <StatusBadge status={s.status} />}
      </div>
      <p className="font-display text-2xl leading-tight tracking-[-0.02em]">{s.value}</p>
      {s.kind === 'statement' ? (
        <div className="grid gap-2">
          <Chip kicker="Patient said" tone="patient">Not yet supported by a document</Chip>
          {s.transcript && <blockquote className="border-l-2 border-violet pl-3 text-[15px] italic">“{s.transcript}”</blockquote>}
        </div>
      ) : (
        <Sources sources={s.sources} compact />
      )}
    </div>
  )
}

/** E-LED-03/04: both sources side by side; a clinician resolves. */
export function ConflictCard({ c }: { c: ConflictView }) {
  const [a, b] = c.sides
  const eventSide = c.sides.find((s) => s.kind === 'event')!
  return (
    <Frame animate className="border-l-[3px] border-l-madder">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3 sm:px-5">
        <p className="flex items-center gap-2 text-[15px] font-medium text-madder-ink"><GitCompare aria-hidden className="size-4" />{c.label}</p>
        {c.resolve === true ? (
          <ResolveConflict eventId={eventSide.id} sides={c.sides.map((s) => ({ id: s.id, kind: s.kind, label: `${s.title}: ${s.value}` }))} />
        ) : (
          <span className="flex items-center gap-1.5 text-sm text-muted"><Lock aria-hidden className="size-3.5" />{c.resolve}</span>
        )}
      </div>
      <div className="grid gap-px bg-rule md:grid-cols-2">
        <Side s={a} label="A" />
        <Side s={b} label="B" />
      </div>
    </Frame>
  )
}
