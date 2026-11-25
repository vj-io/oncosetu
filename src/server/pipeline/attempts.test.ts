// MAX_ATTEMPTS caps runs in a row that saved no new page; a run that saved pages (and was then killed for memory or time)
// never uses one up. The claim itself is an integration test (tests/integration/pipeline-lock.test.ts).
import { describe, expect, it } from 'vitest'
import { attemptsSpent, MAX_ATTEMPTS } from './process'

describe('attemptsSpent', () => {
  it('runs that saved no new page are counted', () => {
    expect(attemptsSpent(0, 0, undefined)).toEqual({ base: 0, spent: 0 })
    expect(attemptsSpent(2, 0, { pages: 0, base: 0 })).toEqual({ base: 0, spent: 2 })
    expect(attemptsSpent(MAX_ATTEMPTS, 5, { pages: 5, base: 0 }).spent).toBe(MAX_ATTEMPTS)
  })

  it('more pages in the read cache than at the last claim start the count again', () => {
    expect(attemptsSpent(2, 10, { pages: 4, base: 0 })).toEqual({ base: 2, spent: 0 })
    expect(attemptsSpent(4, 10, { pages: 10, base: 2 })).toEqual({ base: 2, spent: 2 })
  })

  it('a document stuck before this rule (attempts used up, pages cached, no mark) can be claimed again', () => {
    expect(attemptsSpent(MAX_ATTEMPTS, 33, null)).toEqual({ base: MAX_ATTEMPTS, spent: 0 })
  })

  it('a reprocess that resets attempts to 0 (and clears the cache) is not held back by an old mark', () => {
    expect(attemptsSpent(0, 0, { pages: 36, base: 5 })).toEqual({ base: 0, spent: 0 })
  })
})
