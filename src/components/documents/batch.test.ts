import { describe, expect, it } from 'vitest'
import { MB } from '@/core/limits'
import { batchProblem } from './batch'

describe('upload batch limits (FR-ING-02)', () => {
  it('accepts up to 50 files and 200 MB, refuses more, and says what to do', () => {
    expect(batchProblem(50, 200 * MB)).toBeNull()
    expect(batchProblem(3, null)).toBeNull()
    expect(batchProblem(51, 10 * MB)).toMatch(/^You chose 51 files \(10 MB\)\. One upload takes up to 50 files and 200 MB in all, so nothing was uploaded\./)
    expect(batchProblem(4, 200 * MB + 1)).toMatch(/You chose 4 files \(201 MB\)/)
    expect(batchProblem(60, null)).toMatch(/^You chose 60 files\. /)
  })
})
