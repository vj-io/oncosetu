// A test must never leave the Ganga clock moved.
import { closeDb } from '../../src/db'
import { setClockDays } from './helpers/db'

export default async function globalTeardown() {
  await setClockDays(0)
  await closeDb()
}
