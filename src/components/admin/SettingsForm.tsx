'use client'
import { useState } from 'react'
import { ArrowDown, ArrowUp, FastForward, RotateCcw } from 'lucide-react'
import { Badge, Button, Field, Input, Switch } from '@/components/ui'
import { postJson, useRun } from './client'

type Flags = { voice: boolean; tts: boolean; ai_extraction: boolean; voice_shadow: boolean }
type Question = { id: string; label: string; on: boolean }

export function SettingsForm({ flags: initial, questions: initialQuestions, retentionDays: initialDays, minRetentionDays, demo, demoOffsetDays }: {
  flags: Flags; questions: Question[]; retentionDays: number; minRetentionDays: number; demo: boolean; demoOffsetDays: number
}) {
  const { busy, run } = useRun()
  const [flags, setFlags] = useState(initial)
  const [days, setDays] = useState(String(initialDays))
  const n = Number(days)
  const daysValid = Number.isInteger(n) && n >= minRetentionDays && n <= 36_500
  const toggle = (k: keyof Flags) => (e: { target: { checked: boolean } }) => setFlags((f) => ({ ...f, [k]: e.target.checked }))
  const dirtyFlags = (Object.keys(flags) as (keyof Flags)[]).some((k) => flags[k] !== initial[k])
  const [questions, setQuestions] = useState(initialQuestions)
  const dirtyQuestions = questions.some((q, i) => q.id !== initialQuestions[i].id || q.on !== initialQuestions[i].on)
  const move = (i: number, by: -1 | 1) => setQuestions((qs) => { const next = [...qs]; [next[i], next[i + by]] = [next[i + by], next[i]]; return next })
  const switchQ = (i: number) => (e: { target: { checked: boolean } }) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, on: e.target.checked } : q)))

  return (
    <div className="grid grid-cols-1 gap-10">
      <section aria-labelledby="flags-h" className="grid gap-3 bg-matte p-5 shadow-frame sm:p-6">
        <h2 id="flags-h" className="text-xl tracking-[-0.02em]">Feature flags</h2>
        <p className="max-w-prose text-sm text-muted">Each flag applies to this organisation only. Spoken read-back is still withheld from anyone whose disclosure is not cleared.</p>
        <div className="divide-y divide-rule">
          <Switch label="Voice input" description="Patients and desk staff can answer pre-visit questions by voice." checked={flags.voice} onChange={toggle('voice')} />
          <Switch label="Voice shadow mode" description="Patients may record an answer; it is transcribed and kept for staff to compare with what they typed (statements tab). The transcript never fills the answer. For measuring drug-name accuracy before voice input goes live." checked={flags.voice_shadow} onChange={toggle('voice_shadow')} />
          <Switch label="Spoken read-back" description="Read the confirmed answers aloud (text read-back is always available)." checked={flags.tts} onChange={toggle('tts')} />
          <Switch label="AI-assisted reading (only for patients who consented)" description="Off: documents are read by fixed rules only. Every result passes the same evidence check." checked={flags.ai_extraction} onChange={toggle('ai_extraction')} />
        </div>
        <div><Button disabled={!dirtyFlags} loading={busy === 'flags'} onClick={() => run('flags', () => postJson('/api/admin/settings', { flags }), 'Feature flags saved')}>Save flags</Button></div>
      </section>

      <section aria-labelledby="questions-h" className="grid gap-3 bg-matte p-5 shadow-frame sm:p-6">
        <h2 id="questions-h" className="text-xl tracking-[-0.02em]">Pre-visit questions</h2>
        <p className="max-w-prose text-sm text-muted">The questions patients answer before a visit, in the order asked. A question that is on must be answered (the last one, anything else, is always optional). Switched-off questions are not asked; answers already given stay on file.</p>
        <ol className="divide-y divide-rule">
          {questions.map((q, i) => (
            <li key={q.id} className="flex items-center gap-3">
              <span className="w-5 font-mono text-sm text-faint">{i + 1}</span>
              <Switch className="flex-1" label={q.label} description={q.id === 'anything_else' ? 'Optional for the patient' : 'Required when on'} checked={q.on} onChange={switchQ(i)} />
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" aria-label={`Move up: ${q.label}`} disabled={i === 0} onClick={() => move(i, -1)} icon={<ArrowUp aria-hidden />} />
                <Button size="sm" variant="ghost" aria-label={`Move down: ${q.label}`} disabled={i === questions.length - 1} onClick={() => move(i, 1)} icon={<ArrowDown aria-hidden />} />
              </span>
            </li>
          ))}
        </ol>
        {!questions.some((q) => q.on) && <p role="alert" className="text-sm text-madder-ink">Keep at least one question on.</p>}
        <div><Button disabled={!dirtyQuestions || !questions.some((q) => q.on)} loading={busy === 'questions'} onClick={() => run('questions', () => postJson('/api/admin/settings', { questions: questions.map(({ id, on }) => ({ id, on })) }), 'Questions saved')}>Save questions</Button></div>
      </section>

      <section aria-labelledby="ret-h" className="grid gap-3 bg-matte p-5 shadow-frame sm:p-6">
        <h2 id="ret-h" className="text-xl tracking-[-0.02em]">Retention</h2>
        <p className="max-w-prose text-sm text-muted">How long records are kept after the last encounter before erasure requests are actioned. Never shorter than 3 years ({minRetentionDays} days), the Indian Medical Council minimum for indoor records. The audit trail is kept as legally required.</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Retention (days)" error={days && !daysValid ? `Enter a whole number from ${minRetentionDays} to 36500.` : undefined}>
            <Input type="number" inputMode="numeric" min={minRetentionDays} max={36500} value={days} onChange={(e) => setDays(e.target.value)} className="w-40 font-mono" />
          </Field>
          <Button disabled={!daysValid || n === initialDays} loading={busy === 'ret'} onClick={() => run('ret', () => postJson('/api/admin/settings', { retentionDays: n }), 'Retention saved')}>Save retention</Button>
          {daysValid && <p className="pb-3 font-mono text-sm text-muted">≈ {(n / 365).toFixed(1)} years</p>}
        </div>
      </section>

      {demo && (
        <section aria-labelledby="clock-h" className="grid gap-3 border border-l-[3px] border-rule border-l-brass bg-brass-tint p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="clock-h" className="text-xl tracking-[-0.02em]">Demo clock</h2>
            <Badge tone="brass">Demo only</Badge>
          </div>
          <p className="max-w-prose text-sm">Sets the organisation&apos;s clock to real time plus N days. Request reminders (day 7) and the open-at-day-21 state follow this clock. Sessions use real time and are not affected.</p>
          <p className="font-mono text-sm" role="status">Clock is running {demoOffsetDays === 0 ? 'on real time' : `${demoOffsetDays} days ahead`}.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<FastForward aria-hidden />} loading={busy === 'plus7'} disabled={busy !== null} onClick={() => run('plus7', () => postJson('/api/admin/settings/demo-clock', { preset: 'plus7' }), 'Demo clock: +7 days')}>+7 days</Button>
            <Button variant="secondary" icon={<FastForward aria-hidden />} loading={busy === 'plus21'} disabled={busy !== null} onClick={() => run('plus21', () => postJson('/api/admin/settings/demo-clock', { preset: 'plus21' }), 'Demo clock: +21 days')}>+21 days</Button>
            <Button variant="ghost" icon={<RotateCcw aria-hidden />} loading={busy === 'reset'} disabled={busy !== null || demoOffsetDays === 0} onClick={() => run('reset', () => postJson('/api/admin/settings/demo-clock', { preset: 'reset' }), 'Demo clock reset')}>Reset</Button>
          </div>
        </section>
      )}
    </div>
  )
}
