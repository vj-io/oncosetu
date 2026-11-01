import { RegistrationWizard } from '@/components/registration/RegistrationWizard'
import { SectionHeader } from '@/components/ui'
import { requireStaff } from '@/server/session'

export default async function NewPatientPage() {
  const s = await requireStaff(['desk', 'records', 'clinician'])
  return (
    <section className="grid gap-8">
      <SectionHeader
        as="h1" kicker="Registration" title="Register a patient"
        description="Identity, contacts and disclosure, then the consent notice. The patient's choices are recorded separately for each purpose."
      />
      <RegistrationWizard role={s.role as 'desk' | 'records' | 'clinician'} />
    </section>
  )
}
