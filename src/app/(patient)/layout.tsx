import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { eq } from 'drizzle-orm'
import { withOrg } from '@/db'
import { patients } from '@/db/schema'
import { getSession } from '@/server/session'

// The root title says "OncoSetu". On /p/** the tab must never show "Onco" to a patient who has not been told (FR-CON-07),
// so the title is "Setu Records" for everyone, and "OncoSetu" only for a signed-in patient whose disclosure is cleared.
// The root description ("... cancer care ...") is replaced too: it is in the page head of every /p page.
// (A layout cannot read ?lang=, so the page frame lives in components/portal/PortalFrame.tsx.)
export async function generateMetadata(): Promise<Metadata> {
  let title = 'Setu Records'
  try {
    const s = await getSession()
    if (s && s.kind !== 'staff') {
      const cleared = await withOrg(s.orgId, async (tx) =>
        (await tx.select({ d: patients.disclosureStatus }).from(patients).where(eq(patients.id, s.patientId)))[0]?.d === 'cleared')
      if (cleared) title = 'OncoSetu'
    }
  } catch { /* any failure keeps the neutral title */ }
  return { title, description: 'Your documents from the clinic, in one place.', robots: { index: false, follow: false } }
}

export default function PatientLayout({ children }: { children: ReactNode }) {
  return children
}
