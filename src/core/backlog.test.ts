import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backlogRank, inBacklogOrder, ONBOARDING_PRIORITY, typeHint } from './backlog'

describe('FR-ONB-01 backlog order from file names', () => {
  it('guesses the type from the demo backlog file names', () => {
    expect(typeHint('hero__10-histopathology-later.pdf')).toBe('pathology_report')
    expect(typeHint('returning__07-histopathology-addendum.pdf')).toBe('pathology_report')
    expect(typeHint('hero__11-ihc-later.pdf')).toBe('ihc_molecular_report')
    expect(typeHint('hero__03-ct-thorax-abdomen.jpg')).toBe('imaging_report')
    expect(typeHint('hero__09-mammography-2024.pdf')).toBe('imaging_report')
    expect(typeHint('hero__12-chest-xray.dcm')).toBe('imaging_report')
    expect(typeHint('hero__01-discharge-summary.pdf')).toBe('discharge_summary')
    expect(typeHint('hero__02-chemo-daycare-cycle4.pdf')).toBe('chemo_daycare_record')
    expect(typeHint('hero__04-prescription-printed.pdf')).toBe('prescription_printed')
    expect(typeHint('returning__04-lab-cbc-lft.jpg')).toBe('lab_report')
    expect(typeHint('hero__06-cbc-hindi.jpg')).toBe('lab_report')
    expect(typeHint('IMG_20260412_101500.jpg')).toBeNull()
    expect(typeHint('hero__16-report-photo.heic')).toBeNull()
    expect(typeHint('scanned-copy.pdf')).toBeNull() // "scan" alone is what phone scanner apps call everything
  })

  it('orders a batch pathology/molecular → imaging → discharge → treatment → prescriptions → labs → unknown, stable within a rank', () => {
    const files = ['IMG_1.jpg', 'cbc.jpg', 'prescription.pdf', 'chemo-cycle1.pdf', 'discharge.pdf', 'ct-chest.jpg', 'ihc.pdf', 'histopathology.pdf', 'IMG_2.jpg']
    expect(inBacklogOrder(files, (f) => f)).toEqual([
      'histopathology.pdf', 'ihc.pdf', 'ct-chest.jpg', 'discharge.pdf', 'chemo-cycle1.pdf', 'prescription.pdf', 'cbc.jpg', 'IMG_1.jpg', 'IMG_2.jpg',
    ])
  })

  it('every hint ranks before `other`, and an unknown type ranks with `other`', () => {
    const other = backlogRank('other')
    expect(other).toBe(ONBOARDING_PRIORITY.length - 1)
    expect(backlogRank(null)).toBe(other)
    expect(backlogRank('not_a_type')).toBe(other)
    const demo = readdirSync(join(process.cwd(), 'public', 'demo-docs')).filter((f) => !f.endsWith('.json'))
    const hinted = demo.filter((f) => typeHint(f))
    expect(hinted.length).toBeGreaterThan(demo.length / 2)
    for (const f of hinted) expect(backlogRank(typeHint(f))).toBeLessThan(other)
  })
})
