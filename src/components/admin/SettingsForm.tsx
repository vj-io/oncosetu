'use client'
import { useState } from 'react'
import { FastForward, RotateCcw } from 'lucide-react'
import { Badge, Button, Field, Input, Switch } from '@/components/ui'
import { postJson, useRun } from './client'

type Flags = { voice: boolean; tts: boolean; ai_extraction: boolean }

export function SettingsForm({ flags: initial, retentionDays: initialDays, minRetentionDays, demo, demoOffsetDays }: {
  flags: Flags; retentionDays: number; minRetentionDays: number; demo: boolean; demoOffsetDays: number
}) {
  const { busy, run } = useRun()
  const [flags, setFlags] = useState(initial)
  const [days, setDays] = useState(String(initialDays))
  const n = Number(days)
  const daysValid = Number.isInteger(n) && n >= minRetentionDays && n <= 36_500
  const toggle = (k: keyof Flags) => (e: { target: { checked: boolean } }) => setFlags((f) => ({ ...f, [k]: e.target.checked }))
  const dirtyFlags = (Object.keys(flags) as (keyof Flags)[]).some((k) => flags[k] !== initial[k])

  return (
    <div className="grid grid-cols-1 gap-10">
      <section aria-labelledby="flags-h" className="grid gap-3 bg-matte p-5 shadow-frame sm:p-6">
        <h2 id="flags-h" className="text-xl tracking-[-0.02em]">Feature flags</h2>
        <p className="max-w-prose text-sm text-muted">Each flag applies to this organisation only. Spoken read-back is still withheld from anyone whose disclosure is not cleared.</p>
        <div className="divide-y divide-rule">
          <Switch label="Voice input" description="Patients and desk staff can answer pre-visit questions by voice." checked={flags.voice} onChange={toggle('voice')} />
          <Switch label="Spoken read-back" description="Read the confirmed answers aloud (text read-back is always available)." checked={flags.tts} onChange={toggle('tts')} />
          <Switch label="AI extraction" description="Use the language model for extraction. Off: rule-based extraction only. Every result passes the same evidence gate." checked={flags.ai_extraction} onChange={toggle('ai_extraction')} />
        </div>
        <div><Button disabled={!dirtyFlags} loading={busy === 'flags'} onClick={() => run('flags', () => postJson('/api/admin/settings', { flags }), 'Feature flags saved')}>Save flags</Button></div>
      </section>

      <section aria-labelledby="ret-h" className="grid gap-3 bg-matte p-5 shadow-frame sm:p-6">
        <h2 id="ret-h" className="text-xl tracking-[-0.02em]">Retention</h2>
        <p className="max-w-prose text-sm text-muted">How long records are kept after the last encounter before erasure requests are actioned (PRD §10.5). Never shorter than 3 years ({minRetentionDays} days), the Indian Medical Council minimum for indoor records. The audit trail is kept as legally required.</p>
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
