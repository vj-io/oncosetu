import { describe, expect, it } from 'vitest'
import { accessPhrase } from './access-words'

describe('access log wording', () => {
  it('turns raw action codes into plain sentences', () => {
    expect(accessPhrase('document.view', 'document')).toBe('Opened a document')
    expect(accessPhrase('share.payload', 'patient')).toBe('Prepared a share link')
    expect(accessPhrase('event.source_viewed', 'event')).toBe('Looked at a fact and its source')
    expect(accessPhrase('consent.sign', 'signed_consent')).toBe('The consent form was signed')
  })
  it('never shows a raw dotted code for an unknown action', () => {
    expect(accessPhrase('something.new_thing', 'patient')).toBe('New thing (patient)')
    expect(accessPhrase('weird', null)).toBe('Weird (the file)')
  })
})
