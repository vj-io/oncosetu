import { describe, expect, it } from 'vitest'
import { passwordProblem } from './password'

describe('passwordProblem (portal password rules)', () => {
  const phone = '+91 98765 43210'
  it('accepts an ordinary 8+ character password', () => {
    for (const ok of ['mango-tree-42', 'Sunita@1975', 'blue river', 'छोटा घर 12']) expect(passwordProblem(ok, phone)).toBeNull()
  })
  it('needs at least 8 characters and at most 128', () => {
    expect(passwordProblem('abc12', phone)).toBe('too_short')
    expect(passwordProblem('x'.repeat(7), phone)).toBe('too_short')
    expect(passwordProblem('ab'.repeat(65), phone)).toBe('too_long')
  })
  it('refuses the mobile number itself, written any way', () => {
    for (const bad of ['9876543210', '+919876543210', '98765 43210', '09876543210']) expect(passwordProblem(bad, phone)).toBe('is_phone')
    expect(passwordProblem('9876543210', null)).toBeNull() // no phone on file: nothing to compare (10 digits, not simple)
    expect(passwordProblem('98765432', phone)).toBeNull() // digits that are not the end of the number
  })
  it('refuses the obvious guesses', () => {
    for (const bad of ['12345678', '123456789', '0123456789', 'password', 'Password1', 'qwertyui', 'aaaaaaaa', 'abababab']) {
      expect(passwordProblem(bad, phone)).toBe('too_simple')
    }
  })
})
