'use client'
import { useState, type FormEvent } from 'react'
import { friendlyError, postJson } from '@/components/admin/client'
import { Button, Field, PasswordInput } from '@/components/ui'

/** The form's own check before sending: the two new entries match. The server checks the rest (own-password.ts). */
export const confirmProblem = (next: string, again: string) => (again && next !== again ? 'The two new passwords are not the same' : null)

/** ASVS 2.1.5: change your own password: the current one, then the new one twice. Other sign-ins end afterwards. */
export function ChangePassword({ min }: { min: number }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const mismatch = confirmProblem(next, again)
  const ready = !!current && next.length >= min && next === again

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await postJson<{ ended: number }>('/api/auth/staff/password', { current, next })
      setCurrent(''); setNext(''); setAgain('')
      setMsg({ ok: true, text: `Password changed.${r.ended ? ` ${r.ended === 1 ? 'Your other sign-in was' : `Your ${r.ended} other sign-ins were`} ended.` : ''} Use the new password next time you sign in.` })
    } catch (err) {
      setMsg({ ok: false, text: friendlyError(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form method="post" onSubmit={submit} className="grid max-w-md gap-4">
      <Field label="Current password">
        <PasswordInput autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </Field>
      <Field label="New password" hint={`At least ${min} characters. A short sentence you can remember is easiest.`}>
        <PasswordInput autoComplete="new-password" minLength={min} value={next} onChange={(e) => setNext(e.target.value)} required />
      </Field>
      <Field label="New password again" error={mismatch}>
        <PasswordInput autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
      </Field>
      <div><Button type="submit" loading={busy} disabled={!ready}>Change password</Button></div>
      {msg && <p role="status" className={msg.ok ? 'text-sm text-sage-ink' : 'text-sm text-madder-ink'}>{msg.text}</p>}
    </form>
  )
}
