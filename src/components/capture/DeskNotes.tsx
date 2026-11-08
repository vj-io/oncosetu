import { Mic } from 'lucide-react'
import { Frame } from '@/components/ui'
import { formatDateTimeIN } from '@/server/portal/summary'

export type DeskNote = { id: string; encounterId: string | null; seconds: number; createdAt: Date }

/** Audio notes recorded at the desk with a capture (V05-E2E-01). Shown to Records and Clinicians only; each play is audited. */
export function DeskNotes({ patientId, notes }: { patientId: string; notes: DeskNote[] }) {
  if (!notes.length) return null
  return (
    <section aria-labelledby="desk-notes" className="grid gap-3">
      <h2 id="desk-notes" className="flex items-center gap-2 text-xl"><Mic aria-hidden className="size-5" />Audio notes from the desk</h2>
      <ul className="grid gap-3">
        {notes.map((n) => (
          <li key={n.id}>
            <Frame className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <span className="font-mono text-[13px]">{formatDateTimeIN(n.createdAt, 'en')}</span>
              <audio controls preload="none" src={`/api/patients/${patientId}/audio-notes/${n.id}`} className="h-9" aria-label={`Desk audio note, ${n.seconds} seconds`} />
              <span className="text-sm text-muted">{n.seconds} s · recorded with the pages of this visit</span>
            </Frame>
          </li>
        ))}
      </ul>
    </section>
  )
}
