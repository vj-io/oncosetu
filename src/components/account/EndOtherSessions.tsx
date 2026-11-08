'use client'
import { postJson, useRun } from '@/components/admin/client'
import { Button } from '@/components/ui'

/** ASVS 3.3.3: ends every other sign-in of this account; this one stays. */
export function EndOtherSessions({ others }: { others: number }) {
  const { busy, run } = useRun()
  return (
    <Button variant="secondary" disabled={!others} loading={busy === 'end'}
      onClick={() => run('end', () => postJson('/api/auth/sessions/revoke-others'), 'Signed out everywhere else')}>
      Sign out everywhere else
    </Button>
  )
}
