import type { Tx } from '@/db'
import { recomputeRadar } from '../pipeline/radar'

/**
 * After a rule changes mode or two records merge: re-run Radar for the affected patients so item modes and keys follow
 * rule_states and the survivor. Inside the caller's transaction.
 * ponytail: sequential, one patient at a time; move to the background queue if a rule ever flips for thousands of patients.
 */
export async function recomputeAffected(tx: Tx, orgId: string, patientIds: string[]): Promise<void> {
  for (const id of patientIds) await recomputeRadar(tx, orgId, id)
}
