import type { Metadata } from 'next'
import { CaptureApp } from '@/components/capture/CaptureApp'
import { requireStaff } from '@/server/session'

// The manifest is linked here (not in the root layout) so only the capture app is installable.
// This page renders no patient data: the service worker caches its HTML for offline use.
export const metadata: Metadata = {
  title: 'Capture · OncoSetu',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icons/icon-192.png' }, // a page-level icons object replaces the app icon, so name both
  appleWebApp: { capable: true, title: 'OncoSetu', statusBarStyle: 'default' },
}

export default async function CapturePage() {
  await requireStaff(['desk', 'records', 'clinician'])
  return <CaptureApp />
}
