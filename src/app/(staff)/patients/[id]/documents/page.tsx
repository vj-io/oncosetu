import { AbdmPanel } from '@/components/abdm/AbdmPanel'
import { DocumentsBoard } from '@/components/documents/DocumentsBoard'
import { SectionHeader } from '@/components/ui'
import { isDemo } from '@/server/demo'
import { llmStatus, orgAiFlag } from '@/server/ai/provider'
import { loadPatient } from '@/server/patients'
import { listDocuments } from '@/server/pipeline/queries'
import { withPatientAccess } from '@/server/registration/page'

export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await withPatientAccess(id, async (tx, session) => {
    const [patient, docs, aiFlag] = await Promise.all([loadPatient(tx, id), listDocuments(tx, id), orgAiFlag(tx, session.orgId)])
    return { patient, docs, aiFlag, role: session.role }
  })
  if (!data?.patient) return null // denied or missing: the workspace layout explains why
  const llm = llmStatus(data.aiFlag)
  return (
    <div className="grid gap-8 py-8">
      <SectionHeader
        kicker="Documents · intake and evidence"
        title="Document index"
        description="Every fact on this record comes from a document and carries the exact quote that supports it. Files are checked, read, matched to the patient and gated before anything reaches the timeline."
      />
      <DocumentsBoard
        patientId={id}
        patientName={data.patient.name}
        demo={isDemo()}
        initial={data.docs}
        llm={{ on: llm.on, label: llm.label }}
        canDecide={data.role === 'records' || data.role === 'clinician'}
      />
      {(data.role === 'records' || data.role === 'clinician') && <AbdmPanel patientId={id} />}
    </div>
  )
}
