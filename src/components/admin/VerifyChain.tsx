'use client'
import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import { postJson } from './client'

type Result = { ok: boolean; brokenAt?: number; checked: number }

export function VerifyChain() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | { error: string } | null>(null)
  async function verify() {
    setBusy(true)
    try { setResult(await postJson<Result>('/api/admin/audit/verify')) }
    catch (e) { setResult({ error: e instanceof Error ? e.message : 'Verification failed' }) }
    finally { setBusy(false) }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" onClick={verify} loading={busy} icon={<ShieldCheck aria-hidden />}>Verify chain</Button>
      <p role="status" aria-live="polite" className="text-sm">
        {result && 'error' in result && <Badge tone="conflict">{result.error}</Badge>}
        {result && 'ok' in result && (result.ok
          ? <Badge tone="verified">Intact · {result.checked} entries verified</Badge>
          : <Badge tone="conflict">Broken at seq {result.brokenAt} · {result.checked} entries read</Badge>)}
      </p>
    </div>
  )
}
