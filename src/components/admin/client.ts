'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useToast } from '@/components/ui'

export const NETWORK_MESSAGE = 'Could not reach the server. Nothing was changed. Try again.'

/** Browser fetch failures read "Failed to fetch"; say what it means instead. */
export const friendlyError = (e: unknown) => (e instanceof TypeError && /fetch|network/i.test(e.message) ? NETWORK_MESSAGE : e instanceof Error ? e.message : 'Something went wrong')

/** POST JSON to an admin route; throws Error(message) with the server's message on failure. */
export async function postJson<T = Record<string, unknown>>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {
    throw new Error(NETWORK_MESSAGE)
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error?.message ?? `Request failed (${res.status})`)
  return json as T
}

/** `run(key, fn, successMessage)`: tracks which action is busy, toasts failures, refreshes server data on success. */
export function useRun() {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  async function run<T>(key: string, fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
    setBusy(key)
    try {
      const r = await fn()
      if (ok) toast({ title: ok, tone: 'verified' })
      router.refresh()
      return r
    } catch (e) {
      toast({ title: friendlyError(e), tone: 'conflict' })
    } finally {
      setBusy(null)
    }
  }
  return { busy, run }
}
