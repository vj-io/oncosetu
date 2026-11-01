'use client'
import { useState } from 'react'
import { Plus, RotateCcw, UserCheck, UserX } from 'lucide-react'
import { Badge, Button, Checkbox, Dialog, Field, Input, Select, Table } from '@/components/ui'
import { postJson, useRun } from './client'

export type StaffItem = {
  id: string; name: string; email: string; role: string; active: boolean; totpEnabled: boolean; locked: boolean; isDemo: boolean
  lastLogin: string | null
}
type Enrollment = { secret: string; uri: string; qrDataUrl: string }
const ROLES: [string, string][] = [['desk', 'Desk'], ['records', 'Records'], ['clinician', 'Clinician'], ['org_admin', 'Administrator'], ['auditor', 'Auditor']]

function randomPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

/** Shown once: nothing here is stored client-side, and the server never returns the secret again. */
function EnrollmentDialog({ who, enrollment, onClose }: { who: string; enrollment: Enrollment | null; onClose: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false)
  return (
    <Dialog
      open={!!enrollment}
      onClose={onClose}
      title="Authenticator enrolment"
      description={`Scan this with an authenticator app for ${who}. It is shown once and cannot be retrieved later.`}
      footer={<Button disabled={!acknowledged} onClick={onClose}>Done</Button>}
    >
      {enrollment && (
        <div className="grid gap-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrollment.qrDataUrl} alt={`QR code for the authenticator secret of ${who}`} width={224} height={224} className="mx-auto border border-rule bg-matte p-2" />
          <div className="grid gap-1.5">
            <p className="ds-kicker">Or enter the secret by hand</p>
            <p className="font-mono text-base tracking-[0.12em] break-all select-all" data-testid="totp-secret">{enrollment.secret.match(/.{1,4}/g)?.join(' ')}</p>
          </div>
          <Checkbox label="The staff member has scanned or saved this" description="Closing this window removes the secret from the screen for good." checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
        </div>
      )}
    </Dialog>
  )
}

export function StaffManager({ rows, meId }: { rows: StaffItem[]; meId: string }) {
  const { busy, run } = useRun()
  const [adding, setAdding] = useState(false)
  const [confirm, setConfirm] = useState<{ kind: 'deactivate' | 'reset_totp'; row: StaffItem } | null>(null)
  const [enrollment, setEnrollment] = useState<{ who: string; data: Enrollment } | null>(null)
  const [form, setForm] = useState({ name: '', email: '', role: 'desk', password: '' })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const activeAdmins = rows.filter((r) => r.role === 'org_admin' && r.active).length

  async function create() {
    const r = await run('create', () => postJson<{ id: string; enrollment: Enrollment }>('/api/admin/staff', form), 'Staff member created')
    if (r) {
      setAdding(false)
      setEnrollment({ who: form.name, data: r.enrollment })
      setForm({ name: '', email: '', role: 'desk', password: '' })
    }
  }
  async function confirmed() {
    if (!confirm) return
    const { kind, row } = confirm
    const r = await run(`${kind}:${row.id}`, () => postJson<{ enrollment?: Enrollment }>(`/api/admin/staff/${row.id}`, { action: kind }),
      kind === 'deactivate' ? 'Account deactivated; sessions revoked' : 'Authenticator reset; sessions revoked')
    setConfirm(null)
    if (r?.enrollment) setEnrollment({ who: row.name, data: r.enrollment })
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setAdding(true)} icon={<Plus aria-hidden />}>Add staff member</Button>
      </div>
      <Table caption="Staff of this organisation">
        <thead>
          <tr><th>Person</th><th>Role</th><th>Status</th><th>Last sign-in</th><th aria-label="Actions" /></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const lastAdmin = r.role === 'org_admin' && r.active && activeAdmins <= 1
            return (
              <tr key={r.id} className={r.active ? undefined : 'text-faint'}>
                <td>
                  <span className="block">{r.name}{r.id === meId && <span className="ml-2 font-mono text-[11px] tracking-[0.12em] text-faint uppercase">You</span>}</span>
                  <span className="font-mono text-[13px] text-muted">{r.email}</span>
                  {r.isDemo && <Badge tone="shadow" className="ml-2">Demo</Badge>}
                </td>
                <td>
                  <Select aria-label={`Role of ${r.name}`} value={r.role} disabled={busy !== null || lastAdmin} className="min-w-40"
                    onChange={(e) => run(`role:${r.id}`, () => postJson(`/api/admin/staff/${r.id}`, { action: 'set_role', role: e.target.value }), 'Role changed')}>
                    {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                  {lastAdmin && <span className="mt-1 block text-xs text-faint">Last administrator</span>}
                </td>
                <td>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={r.active ? 'verified' : 'shadow'}>{r.active ? 'Active' : 'Deactivated'}</Badge>
                    {r.locked && <Badge tone="unverified">Locked</Badge>}
                    {!r.totpEnabled && <Badge tone="conflict">No authenticator</Badge>}
                  </div>
                </td>
                <td className="font-mono text-[13px] whitespace-nowrap">{r.lastLogin ?? 'Never'}</td>
                <td>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {r.active ? (
                      <Button size="sm" variant="secondary" icon={<UserX aria-hidden />} disabled={r.id === meId || lastAdmin || busy !== null} onClick={() => setConfirm({ kind: 'deactivate', row: r })}>Deactivate</Button>
                    ) : (
                      <Button size="sm" variant="secondary" icon={<UserCheck aria-hidden />} loading={busy === `reactivate:${r.id}`} disabled={busy !== null}
                        onClick={() => run(`reactivate:${r.id}`, () => postJson(`/api/admin/staff/${r.id}`, { action: 'reactivate' }), 'Account reactivated')}>Reactivate</Button>
                    )}
                    <Button size="sm" variant="ghost" icon={<RotateCcw aria-hidden />} disabled={busy !== null} onClick={() => setConfirm({ kind: 'reset_totp', row: r })}>Reset authenticator</Button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>

      <Dialog open={adding} onClose={() => setAdding(false)} title="Add a staff member" description="They sign in with email, this temporary password and an authenticator code."
        footer={<>
          <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          <Button onClick={create} loading={busy === 'create'} disabled={!form.name.trim() || !form.email.includes('@') || form.password.length < 12}>Create account</Button>
        </>}>
        <div className="grid grid-cols-1 gap-4">
          <Field label="Full name"><Input value={form.name} onChange={set('name')} autoComplete="off" maxLength={100} /></Field>
          <Field label="Work email"><Input type="email" value={form.email} onChange={set('email')} autoComplete="off" /></Field>
          <Field label="Role"><Select value={form.role} onChange={set('role')}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Temporary password" hint="At least 12 characters. Give it to them in person; they should change it after first sign-in.">
            <div className="flex gap-2">
              <Input value={form.password} onChange={set('password')} autoComplete="off" spellCheck={false} className="font-mono" />
              <Button variant="secondary" onClick={() => setForm((f) => ({ ...f, password: randomPassword() }))}>Generate</Button>
            </div>
          </Field>
        </div>
      </Dialog>

      <Dialog open={!!confirm} onClose={() => setConfirm(null)}
        title={confirm?.kind === 'deactivate' ? `Deactivate ${confirm.row.name}?` : `Reset the authenticator of ${confirm?.row.name}?`}
        description={confirm?.kind === 'deactivate' ? 'They are signed out immediately and cannot sign in until reactivated.' : 'The old authenticator stops working and every live session is revoked. A new QR code is shown once.'}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant={confirm?.kind === 'deactivate' ? 'danger' : 'primary'} onClick={confirmed} loading={busy !== null}>{confirm?.kind === 'deactivate' ? 'Deactivate' : 'Reset authenticator'}</Button>
        </>} />

      <EnrollmentDialog key={enrollment?.data.secret ?? 'none'} who={enrollment?.who ?? ''} enrollment={enrollment?.data ?? null} onClose={() => setEnrollment(null)} />
    </div>
  )
}
