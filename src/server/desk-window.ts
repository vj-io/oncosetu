// Decision 19: a desk session may reopen a record only when the patient was verified TODAY (SMS code or witnessed in
// person), until the end of that day in IST. An earlier encounter needs a fresh code or witness.
const IST_MS = 330 * 60_000
const DAY_MS = 86_400_000

/** Midnight at the start of the IST day that contains `t`. */
export function startOfIstDay(t: Date): Date {
  return new Date(Math.floor((t.getTime() + IST_MS) / DAY_MS) * DAY_MS - IST_MS)
}

/** True while `startedAt` falls on the same IST calendar day as `at`. */
export function verifiedToday(startedAt: Date, at: Date = new Date()): boolean {
  return startedAt.getTime() >= startOfIstDay(at).getTime() && startedAt.getTime() <= at.getTime()
}
