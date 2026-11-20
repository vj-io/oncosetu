import { describe, expect, it } from 'vitest'
import { friendlyError, NETWORK_MESSAGE } from './client'

describe('admin error text', () => {
  it('says what a failed fetch means', () => {
    expect(friendlyError(new TypeError('Failed to fetch'))).toBe(NETWORK_MESSAGE)
  })
  it('keeps the server message and a fallback', () => {
    expect(friendlyError(new Error('You cannot review your own emergency access.'))).toBe('You cannot review your own emergency access.')
    expect(friendlyError('x')).toBe('Something went wrong')
  })
})
