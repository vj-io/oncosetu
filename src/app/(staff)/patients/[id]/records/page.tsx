import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RoleRestricted } from '@/components/shell/RoleRestricted'
import { RecordsBrowser } from '@/components/records/RecordsBrowser'
import { SectionHeader } from '@/components/ui'
import { MODALITY_LABEL, type ModalityKey, type RecordKind } from '@/server/records/core'
import { loadPatient } from '@/server/patients'
import { loadRecords } from '@/server/records/queries'
import { withPatientAccess } from '@/server/registration/page'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'All records · OncoSetu' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KINDS = ['report', 'scan', 'lab', 'rx', 'other'] as const
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined)

/** Every paper on this patient's record in date order: reports, scans, labs, prescriptions, the rest. A list of papers, not a clinical summary. */
export default async function RecordsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  if (!UUID.test(id)) notFound()
  const s = await requireStaff()
  if (s.role !== 'records' && s.role !== 'clinician') return <RoleRestricted roles={['records', 'clinician']} role={s.role} backHref={`/patients/${id}/overview`} />
  const data = await withPatientAccess(id, async (tx) => {
    const [recs, patient] = await Promise.all([loadRecords(tx, id), loadPatient(tx, id)])
    return patient ? { recs, patient } : null
  })
  if (!data) return null // denied or missing: the workspace layout shows why
  const kind = (KINDS as readonly string[]).includes(one(sp.kind) ?? '') ? (one(sp.kind) as RecordKind) : 'all'
  const mod = one(sp.mod)
  const modality = mod && mod in MODALITY_LABEL ? (mod as ModalityKey) : 'any'
  return (
    <div className="grid gap-5 py-8">
      <SectionHeader
        kicker="All records"
        title="All records"
        description="Every report, scan, lab result and prescription on this record, in date order. Scans are stored and shown, not read. This is a list of papers, not a clinical summary."
        actions={<Link href={`/patients/${id}/documents`} className="inline-flex min-h-10 items-center border border-rule bg-matte px-3 text-sm hover:bg-spotlight rounded-md">Group by kind, add papers</Link>}
      />
      <RecordsBrowser
        patientId={id} rows={data.recs.rows} pairs={data.recs.pairs} rejected={data.recs.rejected} held={data.recs.held} heldScans={data.recs.heldScans} canDecide
        identity={{ name: data.patient.name, line: [data.patient.ageYears != null ? `${data.patient.ageYears} y` : null, data.patient.sex].filter(Boolean).join(' ') || null, code: `OS·${id.replace(/-/g, '').slice(-6).toUpperCase()}` }} initial={{ kind, modality, order: one(sp.order) === 'old' ? 'old' : 'new' }} />
    </div>
  )
}
