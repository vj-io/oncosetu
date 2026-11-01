import { redirect } from 'next/navigation'

export default async function PatientIndex({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/patients/${(await params).id}/overview`)
}
