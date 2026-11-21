import { ChangePassword } from '@/components/account/ChangePassword'
import { SectionHeader } from '@/components/ui'
import { MIN_PASSWORD } from '@/server/own-password'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Change password · OncoSetu' }

/** ASVS 2.1.5: every staff member can change their own password, starting with the temporary one from the admin. */
export default async function ChangePasswordPage() {
  await requireStaff()
  return (
    <div className="grid grid-cols-1 gap-8">
      <SectionHeader feature as="h1" kicker="Your account" title="Change password"
        description="Replace the temporary password from your administrator with one only you know. Your authenticator app and its 6-digit codes stay the same. Every other place you are signed in is signed out." />
      <ChangePassword min={MIN_PASSWORD} />
    </div>
  )
}
