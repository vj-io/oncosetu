'use client'

// FR-VER-03 for structured sources: opening an event's FHIR resource is logged (once per event per visit), like a quote.
import { useEffect } from 'react'
import { Crosshair } from 'lucide-react'

const logged = new Set<string>()
function markViewed(eventId: string) {
  if (logged.has(eventId)) return
  logged.add(eventId)
  void fetch(`/api/events/${eventId}/viewed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
}

/** The deep-linked event (?event=): its resource is on screen, so it counts as viewed. */
export function ViewedOnMount({ eventId }: { eventId: string }) {
  useEffect(() => {
    markViewed(eventId)
    document.getElementById(`ev-${eventId}`)?.scrollIntoView({ block: 'start' })
  }, [eventId])
  return null
}

export function ShowResource({ eventId }: { eventId: string }) {
  return (
    <a
      href={`#r-${eventId}`}
      onClick={() => markViewed(eventId)}
      className="ml-auto inline-flex min-h-9 items-center gap-1 px-2 text-sm underline underline-offset-4 hover:bg-spotlight"
    >
      <Crosshair aria-hidden className="size-4" /> Show FHIR resource
    </a>
  )
}
