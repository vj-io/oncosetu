import { describe, expect, it } from 'vitest'
import { locateSlice, previewTarget, type StudyPart } from './study-parts'

describe('stepping through a study that came in several uploads', () => {
  const parts = [{ id: 'a', mime: 'application/x-dicom-study', slices: 700 }, { id: 'b', mime: 'application/x-dicom-study', slices: 10 }, { id: 'c', mime: 'application/dicom', slices: 1 }]
  it('finds the part that holds picture N and the position inside it, oldest part first', () => {
    expect(locateSlice(parts, 0)).toMatchObject({ id: 'a', index: 0 })
    expect(locateSlice(parts, 699)).toMatchObject({ id: 'a', index: 699 })
    expect(locateSlice(parts, 700)).toMatchObject({ id: 'b', index: 0 })
    expect(locateSlice(parts, 709)).toMatchObject({ id: 'b', index: 9 })
    expect(locateSlice(parts, 710)).toMatchObject({ id: 'c', index: 0, mime: 'application/dicom' })
  })
  it('keeps a number past either end inside the study', () => {
    expect(locateSlice(parts, 5000)).toMatchObject({ id: 'c', index: 0 })
    expect(locateSlice(parts, -3)).toMatchObject({ id: 'a', index: 0 })
  })
})

describe('what the preview draws', () => {
  const at = new Date('2026-11-01')
  const parts: StudyPart[] = [{ id: 'a', mime: 'application/x-dicom-study', slices: 4, receivedAt: at }, { id: 'b', mime: 'application/x-dicom-study', slices: 3, receivedAt: at }, { id: 'c', mime: 'application/dicom', slices: 1, receivedAt: at }]
  it('the part that stands for the study steps through every part; picture 5 is the second picture of the second part', () => {
    expect(previewTarget({ id: 'a', mime: 'application/x-dicom-study' }, parts, 5)).toMatchObject({ id: 'b', index: 1 })
    expect(previewTarget({ id: 'a', mime: 'application/x-dicom-study' }, parts)).toMatchObject({ id: 'b', index: 0 }) // the middle of 8 pictures
  })
  it('a later part opened on its own, a study in one part, or a single file shows itself', () => {
    expect(previewTarget({ id: 'b', mime: 'application/x-dicom-study' }, parts, 2)).toEqual({ id: 'b', mime: 'application/x-dicom-study', index: 2 })
    expect(previewTarget({ id: 'a', mime: 'application/x-dicom-study' }, parts.slice(0, 1), 2)).toEqual({ id: 'a', mime: 'application/x-dicom-study', index: 2 })
    expect(previewTarget({ id: 'x', mime: 'application/dicom' }, [])).toEqual({ id: 'x', mime: 'application/dicom', index: undefined })
  })
})
