'use client'
// Switch a share link off (E-PAS-03). The next open answers 410.
import { Ban } from 'lucide-react'
import { postJson, useRun } from '@/components/admin/client'
import { Button } from '@/components/ui'

export function RevokeShareButton({ id }: { id: string }) {
  const { busy, run } = useRun()
  return (
    <Button size="sm" variant="ghost" icon={<Ban />} loading={busy === id} onClick={() => run(id, () => postJson(`/api/shares/${id}/revoke`), 'Link switched off')}>
      Switch off
    </Button>
  )
}
