import { RoleRestricted } from '@/components/shell/RoleRestricted'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BrassSeal, Button, EmptyState, EXPLAIN, Explainer, Frame, SectionHeader, Select } from '@/components/ui'
import { Corridor } from '@/components/timeline/Corridor'
import { now } from '@/server/clock'
import { loadTimeline } from '@/server/ledger/record'
import { withPatientAccess } from '@/server/registration/page'
import { requireStaff } from '@/server/session'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SOURCE: Record<string, string> = {
  external_document: 'Outside document', internal_document: 'This hospital', patient_reported: 'Patient said', caregiver_reported: 'Caregiver said',
  external_structured: 'Health record from ABDM', clinician_entered: 'Clinician entered',
}

export const metadata = { title: 'Timeline · OncoSetu' }

type SP = Promise<Record<string, string | string[] | undefined>>
const one = (v: string | string[] | undefined) => (typeof v === 'string' && v.length <= 200 ? v : undefined)

export default async function TimelinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const _s = await requireStaff()
  if (!['records', 'clinician'].includes(_s.role)) return <RoleRestricted roles={['records', 'clinician']} role={_s.role} backHref={`/patients/${id}/overview`} />
  const sp = await searchParams
  const filters = { type: one(sp.type), inst: one(sp.inst), source: one(sp.source), status: one(sp.status) }
  const asOf = one(sp.asOf) && UUID.test(one(sp.asOf)!) ? one(sp.asOf)! : null
  const data = await withPatientAccess(id, async (tx, s) => loadTimeline(tx, id, await now(s.orgId), asOf, filters))
  if (!data) return null
  const { view, snapshots } = data
  const filtered = Object.values(filters).some(Boolean)

  return (
    <div className="grid gap-10 py-8">
      <SectionHeader
        kicker={data.asOf ? 'As it was at a sealed visit' : 'Timeline · the record now'}
        title="The record, in date order"
        description="Every item sits on its date, with where it came from and whether it has been checked. Items whose source gives no date stay in their own lane: nothing is guessed."
      />
      <Explainer>{EXPLAIN.ledger.replace('What arrived after the last sealed visit.', 'Everything on file, laid out by date.')}</Explainer>

      {data.asOf && (
        <Frame className="flex flex-wrap items-center gap-5 border-l-[3px] border-l-brass px-5 py-4">
          <BrassSeal code={data.asOf.sha256} label="Sealed" size={72} />
          <div className="grid gap-1">
            <p className="text-[15px]">The record as it stood when the visit was sealed, {data.asOf.sealedLabel}{data.asOf.signerName && <> by {data.asOf.signerName}</>}. Read-only.</p>
            <p className="flex flex-wrap gap-x-4 text-sm">
              <Link href={`/patients/${id}/timeline`} className="text-setu-ink underline decoration-brass underline-offset-4">Back to the live record</Link>
              <Link href={`/verify/${data.asOf.id}`} className="text-setu-ink underline decoration-brass underline-offset-4">Check this seal</Link>
            </p>
          </div>
        </Frame>
      )}

      {/* keyed by the filters: after "Clear" (a client-side navigation) the selects must show the new values, not keep the old ones */}
      <form key={JSON.stringify([filters, data.asOf?.id ?? null])} method="get" className="grid gap-3 border border-rule bg-surface px-4 py-4 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end">
        <label className="grid gap-1.5"><span className="ds-kicker text-muted">Document type</span>
          <Select name="type" defaultValue={filters.type ?? ''}><option value="">All types</option>{view.facets.types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
        </label>
        <label className="grid gap-1.5"><span className="ds-kicker text-muted">Hospital or lab</span>
          <Select name="inst" defaultValue={filters.inst ?? ''}><option value="">All hospitals and labs</option>{view.facets.institutions.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
        </label>
        <label className="grid gap-1.5"><span className="ds-kicker text-muted">Where it came from</span>
          <Select name="source" defaultValue={filters.source ?? ''}><option value="">All sources</option>{view.facets.sources.map((t) => <option key={t} value={t}>{SOURCE[t] ?? t}</option>)}</Select>
        </label>
        <label className="grid gap-1.5"><span className="ds-kicker text-muted">Checked?</span>
          <Select name="status" defaultValue={filters.status ?? ''}><option value="">Any status</option>{view.facets.statuses.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
        </label>
        <label className="grid gap-1.5"><span className="ds-kicker text-muted">Show the record as of</span>
          <Select name="asOf" defaultValue={data.asOf?.id ?? ''}><option value="">Now</option>{snapshots.map((s) => <option key={s.id} value={s.id}>Sealed {s.sealedLabel}</option>)}</Select>
        </label>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">Apply</Button>
          {(filtered || data.asOf) && <Link href={`/patients/${id}/timeline`} className="inline-flex h-11 items-center px-2 text-sm text-muted underline underline-offset-4">Clear</Link>}
        </div>
      </form>

      <p className="font-mono text-[12px] tracking-[0.1em] text-faint uppercase">{view.shown} of {view.total} items{filtered ? ' · filtered' : ''}</p>

      {view.shown ? (
        <Corridor view={view} />
      ) : (
        <EmptyState title={view.total ? 'No items match these filters' : 'Nothing on the timeline yet'} description={view.total ? 'Clear a filter to see more.' : 'Items appear once documents are processed and attached.'} />
      )}
    </div>
  )
}
