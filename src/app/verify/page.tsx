import type { Metadata } from 'next'
import Link from 'next/link'
import { SealLookup } from '@/components/admin/SealLookup'
import { Frame, Spotlight, Wordmark } from '@/components/ui'

export const metadata: Metadata = { title: 'Check a sealed record · Setu Records', robots: { index: false } }

/** Public front door for /verify/<seal id>: paste the link or id a hospital gave you. No patient data on this page. */
export default function VerifyIndexPage() {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <Spotlight />
      <main id="main" className="relative mx-auto grid max-w-2xl gap-6 px-4 py-10 sm:py-16">
        <Link href="/" aria-label="Home"><Wordmark brand="Setu Records" /></Link>
        <div className="grid gap-3">
          <h1 className="text-3xl leading-tight tracking-[-0.025em] sm:text-4xl">Check a sealed record</h1>
          <p className="text-muted">When a doctor seals a visit, the record is locked. Paste the seal link or code you were given and we will tell you whether anything has changed since. No personal details are shown.</p>
        </div>
        <Frame className="px-5 py-5 sm:px-6"><SealLookup /></Frame>
      </main>
    </div>
  )
}
