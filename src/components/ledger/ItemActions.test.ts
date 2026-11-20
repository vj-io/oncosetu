import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { permitsFor } from '@/server/ledger/core'
import { ToastProvider } from '@/components/ui'
import { ItemActions } from './ItemActions'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

const item = (role: string, tier: 'records' | 'clinician') => ({
  id: 'e1', rowVersion: 1, status: 'unverified' as never, permits: permitsFor(role, tier), editable: [], readings: [], typeLabel: 'Diagnosis', viewedSource: null,
  sources: [{ href: '/patients/p/documents/d?page=1', label: 'Discharge summary p1' }] as never,
})
const html = (role: string, tier: 'records' | 'clinician') => renderToStaticMarkup(createElement(ToastProvider, null, createElement(ItemActions, { item: item(role, tier) })))

describe('REC-03: records staff on a clinician-tier line', () => {
  it('see who checks it and keep the way to the source', () => {
    const out = html('records', 'clinician')
    expect(out).toContain('A clinician checks this line')
    expect(out).toContain('Open source')
    expect(out).toContain('/patients/p/documents/d?page=1')
    expect(out).not.toContain('Verify')
  })
  it('still get the full actions on a records-tier line, and the desk keeps the headline note', () => {
    expect(html('records', 'records')).toContain('Verify')
    expect(html('desk', 'records')).toContain('Headline view')
  })
})
