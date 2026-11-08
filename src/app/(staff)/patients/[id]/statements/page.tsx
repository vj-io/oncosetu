import Link from 'next/link'
import { forbidden, notFound } from 'next/navigation'
import { MessageCircle } from 'lucide-react'
import { SendVisitLink } from '@/components/portal/SendVisitLink'
import { Badge, EmptyState, Frame, SectionHeader, StatusBadge } from '@/components/ui'
import { withOrg } from '@/db'
import { en } from '@/i18n/patient'
import { writeAudit } from '@/server/audit'
import { HttpError } from '@/server/http'
import { assertPatientAccess, loadPatient } from '@/server/patients'
import { formatDateTimeIN } from '@/server/portal/summary'
import { loadStatementGroups } from '@/server/portal/statements'
import { requireStaff } from '@/server/session'

const CONFIRMATION = {
  confirmed: { label: 'Confirmed by patient', tone: 'verified' },
  corrected: { label: 'Confirmed after changes', tone: 'verified' },
  pending: { label: 'Not confirmed', tone: 'unverified' },
  declined: { label: 'Declined', tone: 'shadow' },
} as const

const BY = { patient: 'Patient', caregiver: 'Caregiver', staff: 'Staff', system: 'System' } as const

export default async function StatementsTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireStaff()
  // desk: sees that statements arrived and how, not the words (PRD §6.1: no clinical content beyond headlines)
  const showWords = session.role !== 'desk'
  const data = await withOrg(session.orgId, async (tx) => {
    try {
      await assertPatientAccess({ db: tx, session }, id)
    } catch (e) {
      if (e instanceof HttpError && (e.status === 403 || e.status === 410)) return 'forbidden' as const
      if (e instanceof HttpError && e.status === 404) return null
      throw e
    }
    const patient = await loadPatient(tx, id)
    if (!patient) return null
    const groups = await loadStatementGroups(tx, id)
    await writeAudit(tx, {
      orgId: session.orgId, actorId: session.staffId, actorRole: session.role, action: 'statements.view',
      targetType: 'patient', targetId: id, details: { groups: groups.length, words: showWords },
    })
    return { patient, groups }
  })
  if (data === 'forbidden') forbidden()
  if (!data) notFound()
  const { patient, groups } = data
  const cg = patient.caregivers.find((c) => c.active && c.isGuardian) ?? patient.caregivers.find((c) => c.active)
  const toCaregiver = patient.primaryContact === 'caregiver' || patient.minor
  const recipient = toCaregiver ? (cg ? `the caregiver ${cg.name} (${cg.phoneMasked})` : 'the caregiver (none on file)') : patient.phoneMasked ? `the patient (${patient.phoneMasked})` : 'the patient (no phone on file)'
  const canSend = session.role !== 'org_admin'

  return (
    <div className="mt-8 grid gap-8">
      <SectionHeader
        title="The patient’s own answers"
        description="What the patient or a family member told us before the visit, in their own words. It always stays marked “patient said”: it is never treated as backed by a document."
      />
      {canSend && <SendVisitLink patientId={id} recipient={recipient} />}
      {canSend && (
        <p className="text-sm text-muted">
          Or at the desk: open the <a href="/p/login?station=1" target="_blank" rel="noopener" className="text-ink underline decoration-brass underline-offset-4">desk station</a> on the clinic tablet (not on this computer: signing a patient in signs staff out of that browser). The patient signs in with the code sent to their phone, answers, and the tablet signs out by itself.
        </p>
      )}

      {groups.length === 0 ? (
        <EmptyState icon={<MessageCircle />} title="No answers yet" description="Send the pre-visit link, or ask the patient to open it on their phone." />
      ) : (
        <ol className="grid gap-6">
          {groups.map((g) => (
            <li key={g.key}>
              <Frame className="grid gap-4 px-5 py-5">
                <header className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <p className="font-display text-xl tracking-[-0.02em]">{formatDateTimeIN(g.at, 'en')}</p>
                  <Badge tone="patient" icon={<MessageCircle />}>{BY[g.by]}</Badge>
                  <span className="font-mono text-xs text-muted">{g.encounterId ? 'Linked to an encounter' : 'Not linked to an encounter yet'}</span>
                </header>
                <ul className="grid gap-5">
                  {g.items.map((it) => {
                    const c = CONFIRMATION[it.confirmation]
                    return (
                      <li key={it.id} className="grid gap-2 border-t border-rule pt-4 first:border-t-0 first:pt-0">
                        <p className="ds-kicker">{en[`q_${it.questionId}` as keyof typeof en] ?? it.questionId}</p>
                        {showWords ? (
                          <>
                            <blockquote className="border-l-[3px] border-violet pl-3 text-[15px] whitespace-pre-wrap">{it.transcript || '—'}</blockquote>
                            {it.readback && <p className="text-sm text-muted"><span className="font-medium">Read-back shown to the patient:</span> {it.readback}</p>}
                            {it.audioId && (
                              <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
                                <audio controls preload="none" src={`/api/patients/${id}/statements/${it.id}/audio`} className="h-9" aria-label="The patient's recording" />
                                <span>Their own voice, kept beside the words{it.asr ? ` · transcribed by ${it.asr}` : ''}</span>
                              </div>
                            )}
                            {it.shadow.length > 0 && (
                              <div className="grid gap-2 border border-dashed border-control bg-alcove px-3 py-3" data-testid="voice-shadow">
                                <p className="text-sm"><span className="ds-kicker mr-2">Voice trial</span>Recorded in shadow mode: what the speech service heard, kept to compare with the typed answer above. It is not part of the answer.</p>
                                {it.shadow.map((c) => (
                                  <div key={c.clipId} className="grid gap-1.5">
                                    <blockquote className="border-l-2 border-control pl-3 font-mono text-[13.5px] whitespace-pre-wrap">{c.text || '—'}</blockquote>
                                    <audio controls preload="none" src={`/api/patients/${id}/statements/${it.id}/audio?clip=${c.clipId}`} className="h-9" aria-label="Voice trial recording" />
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-sm text-muted">The patient&rsquo;s words are visible to the Records and Clinician roles.</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status="patient_said" />
                          <Badge tone={c.tone}>{c.label}</Badge>
                          <Badge>{it.voice ? 'Voice typing' : 'Tap / typed'}</Badge>
                          {it.language && <Badge>{it.language.toUpperCase()}</Badge>}
                          {it.conflict && it.eventId && (
                            <Link href={`/patients/${id}/ledger?event=${it.eventId}`} className="inline-flex min-h-6 items-center text-sm text-madder-ink underline underline-offset-4">
                              Conflict in the ledger
                            </Link>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </Frame>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
