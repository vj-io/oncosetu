import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EmptyFrame, Placard } from '@/components/ui'
import { BUDGET_MS, countItems, median, verdictFor } from './probe'

describe('median', () => {
  it('takes the middle of an unsorted list', () => expect(median([9, 1, 5])).toBe(5))
  it('averages the two middle values of an even list', () => expect(median([4, 1, 3, 2])).toBe(2.5))
  it('is NaN for nothing measured', () => expect(median([])).toBeNaN())
  it('does not reorder its input', () => {
    const xs = [3, 1, 2]
    median(xs)
    expect(xs).toEqual([3, 1, 2])
  })
})

describe('verdictFor', () => {
  const ok = { totalMs: 1500, itemsFound: 500, httpOk: true }
  it('passes at or under the budget, fails over it', () => {
    expect(verdictFor(ok)).toBe('pass')
    expect(verdictFor({ ...ok, totalMs: BUDGET_MS })).toBe('pass')
    expect(verdictFor({ ...ok, totalMs: BUDGET_MS + 0.1 })).toBe('fail')
  })
  it('is invalid, never a pass, when items are missing, the response was bad or nothing was timed', () => {
    expect(verdictFor({ ...ok, itemsFound: 499 })).toBe('invalid')
    expect(verdictFor({ ...ok, itemsFound: 0, totalMs: 10 })).toBe('invalid')
    expect(verdictFor({ ...ok, httpOk: false })).toBe('invalid')
    expect(verdictFor({ ...ok, totalMs: Number.NaN })).toBe('invalid')
  })
  it('takes the budget as an argument', () => expect(verdictFor(ok, 1000)).toBe('fail'))
})

describe('countItems', () => {
  // The real components, so a change to the card markup breaks this test instead of silently turning the probe `invalid`.
  const card = (n: number) => renderToStaticMarkup(createElement(Placard, { title: `Item ${n}`, accession: `A${n}`, animate: true, delay: n }))
  const frame = renderToStaticMarkup(createElement(EmptyFrame, { title: 'Missing record' }))

  it('counts one per ledger card and ignores other articles on the page', () => {
    const html = `<main>${Array.from({ length: 500 }, (_, i) => card(i)).join('')}${frame}<article class="x">other</article></main>`
    expect(countItems(html)).toBe(500)
  })
  it('is zero for a page without cards', () => expect(countItems(`<main>${frame}<p>No access</p></main>`)).toBe(0))
})
