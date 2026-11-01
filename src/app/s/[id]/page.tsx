// Public share viewer (J5): no account, no server-side read of the record. The title never says "Onco" (FR-CON-07);
// the decryption key stays in the URL fragment, which the browser never sends to this server.
import type { Metadata } from 'next'
import { ShareViewer } from '@/components/shares/ShareViewer'

export const metadata: Metadata = { title: 'Setu Records', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ShareViewer id={id} />
}
