// Speech-to-text behind one interface (FR-VOX-03, docs/adr). The server provider is Sarvam; the browser's own Web Speech
// recogniser (VisitFlow, no server call) is the fallback when no key is set and is recorded as BROWSER_ASR.
// Another provider is a new AsrProvider assigned to `asr`; statements and recordings record whichever one heard them.
import type { Lang } from '@/core/types'
import { SARVAM_MODEL, transcribe } from './sarvam'

export type AsrProvider = {
  name: string
  model: string
  transcribe(audio: Blob, lang: Lang, keyterms?: readonly string[]): Promise<string>
}

export const asr: AsrProvider = { name: 'sarvam', model: SARVAM_MODEL, transcribe }
export const BROWSER_ASR = 'browser-webspeech'
