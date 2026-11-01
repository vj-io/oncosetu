// When erased records may actually be deleted (PRD §10.5): never before the org's retention period has run from the
// request, and never within 3 years of the patient's last encounter (the Indian Medical Council minimum for indoor records).
export const MIN_YEARS_AFTER_LAST_ENCOUNTER = 3

export function erasureEligibleAfter(i: { requestedAt: Date; retentionDays: number; lastEncounterAt: Date | null }): Date {
  const byRetention = new Date(i.requestedAt.getTime() + i.retentionDays * 86_400_000)
  if (!i.lastEncounterAt) return byRetention
  const floor = new Date(i.lastEncounterAt)
  floor.setUTCFullYear(floor.getUTCFullYear() + MIN_YEARS_AFTER_LAST_ENCOUNTER)
  return floor > byRetention ? floor : byRetention
}
