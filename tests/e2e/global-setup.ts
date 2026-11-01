// Once per run: the Ganga organisation starts from a known state (clock at real time, Radar rules reviewed except one).
import { RADAR_RULES } from '../../src/core/radar/rules'
import { Api } from './helpers/api'
import { closeDb } from '../../src/db'
import { setClockDays, staffId } from './helpers/db'
import { EMAIL } from './helpers/env'

/** Left unreviewed on purpose: V04-E2E-08 proves its items never reach clinicians. It fires on the hero discharge summary ("IHC to follow"). */
export const SHADOW_RULE = 'RAD-HPE-IHC-01'

export default async function globalSetup() {
  await setClockDays(0)
  const admin = await Api.login('admin')
  const reviewerId = await staffId(EMAIL.clinician)
  for (const rule of RADAR_RULES) {
    const body = rule.id === SHADOW_RULE ? { mode: 'shadow' } : { mode: 'production', reviewerId, confirm: true }
    const r = await admin.post(`/api/admin/rules/${rule.id}`, body)
    if (!r.ok) throw new Error(`rule ${rule.id}: ${r.status} ${JSON.stringify(r.body)}`)
  }
  await admin.dispose()
  await closeDb()
}
