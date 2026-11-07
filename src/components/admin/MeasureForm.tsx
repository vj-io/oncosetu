'use client'
import { useState } from 'react'
import { Send } from 'lucide-react'
import { Button, Checkbox, Field, Input, Select, Switch } from '@/components/ui'
import { staffDocLabel } from '@/core/copy'
import { DOC_TYPES, type DocType } from '@/core/types'
import { postJson, useRun } from './client'

export type EncounterOption = { id: string; type: string; label: string }

const IMPACTS: [string, string][] = [
  ['none', 'No impact'], ['delayed_decision', 'Decision delayed'], ['repeat_test_ordered', 'Repeat test ordered'], ['visit_rescheduled', 'Visit rescheduled'],
]
const REASONS: [string, string][] = [['unavailable', 'Earlier result unavailable'], ['quality', 'Earlier result of poor quality'], ['clinical_need', 'Clinical need']]

/** The 60-second consultation form (§16.4). It holds no patient field: the only link is an encounter id. */
export function MeasureForm({ encounters, today }: { encounters: EncounterOption[]; today: string }) {
  const { busy, run } = useRun()
  const [encounterId, setEncounterId] = useState('')
  const [date, setDate] = useState(today)
  const [phase, setPhase] = useState('baseline')
  const [firstVisit, setFirstVisit] = useState(true)
  const [missing, setMissing] = useState<'no' | 'yes'>('no')
  const [count, setCount] = useState('1')
  const [types, setTypes] = useState<DocType[]>([])
  const [impact, setImpact] = useState('none')
  const [repeat, setRepeat] = useState(false)
  const [reason, setReason] = useState('')
  const [prep, setPrep] = useState('')

  const present = missing === 'yes'
  const effectiveImpact = impact
  const ready = !!date && (!present || (Number(count) >= 1)) && (!repeat || !!reason) && (effectiveImpact !== 'repeat_test_ordered' || repeat)

  function pickEncounter(id: string) {
    setEncounterId(id)
    const e = encounters.find((x) => x.id === id)
    if (e) setFirstVisit(e.type === 'onboarding')
  }

  async function submit() {
    const r = await run('submit', () => postJson('/api/measure/forms', {
      encounterId: encounterId || null, consultationDate: date, phase, firstVisit, missingRecordPresent: present,
      missingRecordCount: present ? Number(count) : 0, missingTypes: present ? types : [], impact, repeatTestOrdered: repeat,
      repeatTestReason: repeat ? reason : null, prepMinutes: prep === '' ? null : Number(prep),
    }), 'Consultation recorded')
    if (r) { setEncounterId(''); setMissing('no'); setTypes([]); setImpact('none'); setRepeat(false); setReason(''); setPrep(''); setCount('1') }
  }

  return (
    <form className="grid gap-6" onSubmit={(e) => { e.preventDefault(); if (ready) submit() }}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Consultation date"><Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label="Study phase"><Select value={phase} onChange={(e) => setPhase(e.target.value)}><option value="baseline">Baseline</option><option value="shadow">Trial run</option><option value="live">Live</option></Select></Field>
        <Field label="Encounter" hint="Link by id only. No patient details are stored on this form." optional>
          <Select value={encounterId} onChange={(e) => pickEncounter(e.target.value)}>
            <option value="">Not linked</option>
            {encounters.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </Select>
        </Field>
      </div>

      <Switch label="First visit at this centre" checked={firstVisit} onChange={(e) => setFirstVisit(e.target.checked)} />

      <fieldset className="grid gap-4 border border-rule p-4">
        <legend className="ds-kicker px-2">Referenced but absent</legend>
        <Field label="Was at least one referenced document missing from the file?">
          <Select value={missing} onChange={(e) => setMissing(e.target.value as 'no' | 'yes')}><option value="no">No, nothing missing</option><option value="yes">Yes, at least one</option></Select>
        </Field>
        {present && (
          <>
            <Field label="How many documents"><Input type="number" min={1} max={50} value={count} onChange={(e) => setCount(e.target.value)} className="w-32" /></Field>
            <div className="grid gap-1">
              <p className="ds-kicker text-muted">Which types (any that apply)</p>
              <div className="grid gap-x-6 sm:grid-cols-2">
                {DOC_TYPES.map((t) => (
                  <Checkbox key={t} label={staffDocLabel(t)} checked={types.includes(t)}
                    onChange={(e) => setTypes((xs) => (e.target.checked ? [...xs, t] : xs.filter((x) => x !== t)))} />
                ))}
              </div>
            </div>
          </>
        )}
      </fieldset>

      <fieldset className="grid gap-4 border border-rule p-4">
        <legend className="ds-kicker px-2">Impact</legend>
        <Field label="Impact of missing records on this consultation"><Select value={impact} onChange={(e) => setImpact(e.target.value)}>{IMPACTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Checkbox label="A test was re-ordered that the patient reports having had elsewhere" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
        {repeat && <Field label="Reason for the repeat test"><Select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Choose a reason</option>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>}
        {impact === 'repeat_test_ordered' && !repeat && <p className="text-sm text-madder-ink">Tick the re-ordered test box above to record this impact.</p>}
      </fieldset>

      <Field label="Preparation time (minutes)" hint="Arrival to ready for clinician, if known." optional>
        <Input type="number" min={0} max={600} value={prep} onChange={(e) => setPrep(e.target.value)} className="w-32" />
      </Field>

      <div><Button type="submit" size="lg" loading={busy === 'submit'} disabled={!ready} icon={<Send aria-hidden />}>Record consultation</Button></div>
    </form>
  )
}
