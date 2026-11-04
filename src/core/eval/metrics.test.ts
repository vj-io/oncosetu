import { describe, expect, it } from 'vitest'
import { cer, levenshtein, macroF1, normaliseOcr } from './metrics'

describe('levenshtein', () => {
  it('counts insert, delete and substitute as 1 each', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('abc', '')).toBe(3)
    expect(levenshtein('same', 'same')).toBe(0)
  })
  it('works on code points, so a Devanagari conjunct is not split by UTF-16 units', () => {
    expect(levenshtein('सुनीता', 'सुनीता')).toBe(0)
    expect(levenshtein('सुनीता', 'सुनिता')).toBe(1)
    expect(levenshtein('😀a', 'a')).toBe(1)
  })
})

describe('cer', () => {
  it('ignores whitespace differences only', () => {
    expect(normaliseOcr('  a \n\t b  c ')).toBe('a b c')
    expect(cer('Hb   10.8\ng/dL', 'Hb 10.8 g/dL')).toBe(0)
    expect(cer('hb 10.8 g/dl', 'Hb 10.8 g/dL')).toBeCloseTo(2 / 12, 10) // case is NOT folded (H, L)
  })
  it('is edits over truth length', () => {
    expect(cer('Hb 10.B g/dL', 'Hb 10.8 g/dL')).toBeCloseTo(1 / 12, 10)
    expect(cer('', 'abcd')).toBe(1)
    expect(cer('abcdabcd', 'abcd')).toBe(1) // not capped
    expect(cer('x'.repeat(10), 'abcd')).toBe(2.5)
  })
  it('refuses an empty truth instead of dividing by zero', () => {
    expect(() => cer('abc', ' \n ')).toThrow()
  })
})

describe('macroF1', () => {
  it('is 1 when every class is right', () => {
    const r = macroF1([{ expected: 'a', got: 'a' }, { expected: 'b', got: 'b' }])
    expect(r.macroF1).toBe(1)
  })
  it('averages per-class F1 (a: tp1 fn1 -> 2/3, b: tp2 fp1 -> 4/5)', () => {
    const r = macroF1([
      { expected: 'a', got: 'a' },
      { expected: 'a', got: 'b' },
      { expected: 'b', got: 'b' },
      { expected: 'b', got: 'b' },
    ])
    expect(r.perClass.a).toMatchObject({ precision: 1, recall: 0.5, support: 2, predicted: 1 })
    expect(r.perClass.b.f1).toBeCloseTo(0.8, 10)
    expect(r.macroF1).toBeCloseTo((2 / 3 + 0.8) / 2, 10)
  })
  it('scores a predicted-but-never-expected class as 0 and leaves unused classes out', () => {
    const r = macroF1([{ expected: 'a', got: 'a' }, { expected: 'a', got: 'z' }])
    expect(r.perClass.z).toMatchObject({ precision: 0, recall: null, f1: 0, support: 0 })
    expect(Object.keys(r.perClass).sort()).toEqual(['a', 'z'])
    expect(r.macroF1).toBeCloseTo((2 / 3 + 0) / 2, 10) // a: tp 1, support 2, predicted 1 -> F1 2/3
  })
  it('is 0 for no documents', () => {
    expect(macroF1([]).macroF1).toBe(0)
  })
})
