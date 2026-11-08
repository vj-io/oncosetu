import { AbdmPanel } from '@/components/abdm/AbdmPanel'
import { DeskNotes } from '@/components/capture/DeskNotes'
import { DocumentsBoard } from '@/components/documents/DocumentsBoard'
import { SectionHeader } from '@/components/ui'
import { isDemo } from '@/server/demo'
import { loadPatient } from '@/server/patients'
import { listDocuments } from '@/server/pipeline/queries'
import { withPatientAccess } from '@/server/registration/page'
import { listDeskNotes } from '@/server/voice/clips'

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ demo?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const data = await withPatientAccess(id, async (tx, session) => {
    const [patient, docs] = await Promise.all([loadPatient(tx, id), listDocuments(tx, id)])
    const player = session.role === 'records' || session.role === 'clinician' // the desk records notes, it does not play them
    return { patient, docs, role: session.role, notes: player ? await listDeskNotes(tx, id) : [] }
  })
  if (!data?.patient) return null // denied or missing: the workspace layout explains why
  return (
    <div className="grid gap-8 py-8">
      <SectionHeader
        kicker="Documents"
        title="Documents"
        description="Everything sent for this patient. Facts on the record come from the written reports, each with the exact words they were taken from. Scans, ECGs and videos are kept and shown, not read."
      />
      <DocumentsBoard
        patientId={id}
        patientName={data.patient.name}
        demo={isDemo() && sp.demo === '1'} // sample-document tools: demo mode and ?demo=1 only, never for a doctor browsing normally
        initial={data.docs}
        canDecide={data.role === 'records' || data.role === 'clinician'}
      />
      <DeskNotes patientId={id} notes={data.notes} />
      {(data.role === 'records' || data.role === 'clinician') && <AbdmPanel patientId={id} />}
    </div>
  )
}
