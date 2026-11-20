import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HeldReveal } from './HeldReveal'
import { HeldStages } from './HeldStages'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('a file that may belong to another patient (RAD-06)', () => {
  it('marks Patient match as failed and held, never as done', () => {
    const out = html(createElement(HeldStages, { at: 6, identityFailed: true, storedOnly: true }))
    expect(out).toContain('Patient match: failed, held for a person')
    expect(out).not.toContain('Patient match</li>')
    expect(out).not.toMatch(/Patient match<span class="sr-only"> \(done\)/)
  })
  it('does not show the reading steps of a stored scan as done (DESK-09)', () => {
    const out = html(createElement(HeldStages, { at: 3, storedOnly: true }))
    expect(out).toContain('Reading<span class="sr-only"> (not done: this file is stored, not read)')
    expect(out).not.toMatch(/Reading<span class="sr-only"> \(done\)/)
    expect(out).toContain('Received<span class="sr-only"> (done)')
  })
  it('keeps the ordinary held strip unchanged for a written paper', () => {
    const out = html(createElement(HeldStages, { at: 3 }))
    expect(out).toContain('Reading<span class="sr-only"> (done)')
    expect(out).toContain('Patient match · held for a person')
  })
  it('keeps the picture small, blurred and unreachable until a person reveals it', () => {
    const out = html(createElement(HeldReveal, { nameOnFile: 'Sanjay Kulkarni, M, 63 Y' }, createElement('img', { src: '/x.png', alt: 'scan' })))
    expect(out).toContain('data-revealed="false"')
    expect(out).toContain('blur-xl')
    expect(out).toContain('max-h-40')
    expect(out).toContain('inert')
    expect(out).toContain('Show the file anyway')
    expect(out).toContain('Sanjay Kulkarni')
  })
})
