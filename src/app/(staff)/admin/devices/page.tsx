import { Badge, EmptyState, SectionHeader, Table } from '@/components/ui'
import { RevokeDevice } from '@/components/admin/RevokeDevice'
import { withOrg } from '@/db'
import { istDateTime } from '@/server/admin/format'
import { listDevices } from '@/server/admin/ops'
import { sectionRoles } from '@/server/admin/sections'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Devices · Admin · OncoSetu' }

const STATE = {
  active: { tone: 'verified', label: 'Active' },
  revoked_awaiting_wipe: { tone: 'unverified', label: 'Revoked · wipe pending' },
  wiped: { tone: 'shadow', label: 'Revoked · wipe ordered' },
} as const

export default async function DevicesPage() {
  const s = await requireStaff(sectionRoles('devices'))
  const rows = await withOrg(s.orgId, (tx) => listDevices(tx, s.orgId))
  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionHeader as="h1" kicker="Admin · Offline capture" title="Capture devices"
        description="Registered desk devices. Revoking one refuses its next upload; on its next contact it wipes its encrypted offline queue." />
      {rows.length === 0 ? <EmptyState title="No devices registered" description="A capture device registers itself the first time staff set it up." /> : (
        <Table caption="Registered devices">
          <thead><tr><th>Device</th><th>Registered</th><th>Last seen</th><th>Status</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>{d.label}<span className="block font-mono text-[12px] text-faint">{d.id.slice(0, 8)}</span></td>
                <td className="text-sm">{istDateTime(d.registeredAt)}<span className="block text-muted">{d.registeredBy ? `by ${d.registeredBy}` : ''}</span></td>
                <td className="font-mono text-[13px] whitespace-nowrap">{d.lastSeenAt ? istDateTime(d.lastSeenAt) : 'Never'}</td>
                <td><Badge tone={STATE[d.state].tone}>{STATE[d.state].label}</Badge>{d.revokedAt && <span className="mt-1 block font-mono text-[12px] text-muted">{istDateTime(d.revokedAt)}</span>}</td>
                <td className="text-right">{d.state === 'active' && <RevokeDevice id={d.id} label={d.label} />}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
