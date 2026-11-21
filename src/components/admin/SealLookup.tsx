'use client'
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Field, Input } from '@/components/ui'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Takes a pasted /verify link or a bare seal id and opens its verdict page. */
export function SealLookup() {
  const router = useRouter()
  const [v, setV] = useState('')
  const [err, setErr] = useState<string | null>(null)
  function go(e: FormEvent) {
    e.preventDefault()
    const id = UUID.exec(v)?.[0]
    if (!id) { setErr('This does not look like a seal link or code. It has letters and numbers in groups, separated by dashes.'); return }
    router.push(`/verify/${id.toLowerCase()}`)
  }
  return (
    <form onSubmit={go} className="grid gap-4">
      <Field label="Seal link or code" error={err ?? undefined}>
        <Input value={v} onChange={(e) => { setV(e.target.value); setErr(null) }} autoComplete="off" spellCheck={false} className="" />
      </Field>
      <div><Button type="submit">Check this record</Button></div>
    </form>
  )
}
