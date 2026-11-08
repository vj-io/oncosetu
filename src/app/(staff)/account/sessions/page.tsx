import { EndOtherSessions } from '@/components/account/EndOtherSessions'
import { Badge, SectionHeader, Table } from '@/components/ui'
import { listOwnSessions } from '@/server/own-sessions'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Your sign-ins · OncoSetu' }

const when = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

/** ASVS 3.3.3 / 3.3.4: where this account is signed in, and a way to end the others (a lost phone, a shared desk computer). */
export default async function SessionsPage() {
  const session = await requireStaff()
  const rows = await listOwnSessions(session)
  return (
    <div className="grid grid-cols-1 gap-8">
      <SectionHeader as="h1" kicker="Your account" title="Where you are signed in"
        description="Each row is a browser or device signed in to your account. A sign-in ends after 30 minutes without use, and after 12 hours at most. If you see one you do not recognise, sign out everywhere else and tell your administrator." />
      <Table caption="Your sign-ins">
        <thead><tr><th scope="col">Signed in</th><th scope="col">Last used</th><th scope="col">Ends at the latest</th><th scope="col"><span className="sr-only">This one</span></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="font-mono tabular-nums">{when(r.createdAt)}</td>
              <td className="font-mono tabular-nums">{when(r.lastSeenAt)}</td>
              <td className="font-mono tabular-nums">{when(r.expiresAt)}</td>
              <td>{r.current && <Badge tone="verified">This browser</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div><EndOtherSessions others={rows.filter((r) => !r.current).length} /></div>
    </div>
  )
}
