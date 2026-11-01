// FR-ADM-01 guard: the org must always keep at least one active org_admin. Pure.
export type StaffLite = { id: string; role: string; active: boolean }

/** True if applying `change` to `targetId` would leave the org with no active org_admin. */
export function wouldRemoveLastAdmin(staff: readonly StaffLite[], targetId: string, change: { role?: string; active?: boolean }): boolean {
  const after = staff.map((s) => (s.id === targetId ? { ...s, ...change } : s))
  const before = staff.some((s) => s.role === 'org_admin' && s.active)
  return before && !after.some((s) => s.role === 'org_admin' && s.active)
}
