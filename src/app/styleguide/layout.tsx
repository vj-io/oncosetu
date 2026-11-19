import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { isDemo } from '@/server/demo'

// The style guide shows synthetic patients and design internals: it exists only while DEMO_MODE is on.
export default async function StyleguideLayout({ children }: { children: ReactNode }) {
  await connection() // read DEMO_MODE per request, not at build time
  if (!isDemo()) notFound()
  return children
}
