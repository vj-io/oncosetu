'use client'
import { useState } from 'react'
import { Button, Dialog } from '@/components/ui'
import { postJson, useRun } from './client'

/** FR-OFF-06: uses the Offline agent's POST /api/devices/[id]/revoke. */
export function RevokeDevice({ id, label }: { id: string; label: string }) {
  const { busy, run } = useRun()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} aria-label={`Revoke ${label}`}>Revoke</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Revoke “${label}”?`}
        description="Its next contact with the server is refused and the device wipes its offline queue. Captures not yet synced are lost."
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="danger" loading={busy === id} onClick={async () => { await run(id, () => postJson(`/api/devices/${id}/revoke`), 'Device revoked'); setOpen(false) }}>Revoke device</Button>
        </>} />
    </>
  )
}
