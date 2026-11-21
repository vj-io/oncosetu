import { describe, expect, it } from 'vitest'
import { confirmProblem } from '@/components/account/ChangePassword'
import { STAFF_ROLES, menuFor } from '@/lib/staff-nav'
import { MIN_PASSWORD, newPasswordProblem } from './own-password'

describe('new password rules', () => {
  it('needs at least 12 characters and must differ from the current one', () => {
    expect(MIN_PASSWORD).toBe(12)
    expect(newPasswordProblem('old-password-123', 'short-pass1')).toMatch(/at least 12/) // 11 characters
    expect(newPasswordProblem('old-password-123', 'twelve-chars')).toBeNull()
    expect(newPasswordProblem('same-password-123', 'same-password-123')).toMatch(/different/)
  })
  it('the form flags a confirmation that does not match, and says nothing while it is empty', () => {
    expect(confirmProblem('abcdefghijklm', '')).toBeNull()
    expect(confirmProblem('abcdefghijklm', 'abcdefghijklx')).toMatch(/not the same/)
    expect(confirmProblem('abcdefghijklm', 'abcdefghijklm')).toBeNull()
  })
  it('every staff role finds Change password in the account menu', () => {
    for (const role of STAFF_ROLES) expect(menuFor(role).map((m) => m.href)).toContain('/account/password')
  })
})
