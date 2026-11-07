/**
 * Voice drug-name accuracy (FR-VOX-03): 50 synthetic spoken answers, one per formulary medicine, rotating English, Hindi
 * and Hinglish, spoken by Sarvam's TTS (Bulbul v3) and transcribed by Saaras v4 twice: without keyterms, and with the
 * keyterms the app sends (the patient's own medicine first, then the formulary). Reports word error rate (WER) and the
 * drug-name error rate separately, overall and per language, with every transcript.
 *
 * Synthetic, studio-clean speech is far easier than a patient on a phone in a clinic corridor: read the numbers as an
 * upper bound. Field accuracy needs the shadow-phase clips the PRD asks for (real voices, consented), not this set.
 *
 *   npx tsx --env-file=.env.local scripts/eval-asr.ts      # writes data/eval/asr-report.json (needs SARVAM_API_KEY)
 *   npx tsx scripts/eval-asr.ts --rescore                  # re-score the transcripts already in the report, no API calls
 * Audio is cached in .cache/asr-eval/ (gitignored), so a re-run only pays for the transcriptions.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_FORMULARY } from '../src/core/formulary'
import type { Lang } from '../src/core/types'
import { heard, wer } from '../src/core/eval/asr'
import { buildKeyterms } from '../src/server/voice/keyterms'
import { SARVAM_MODEL, TTS_MODEL, TTS_SPEAKER, speak, transcribe } from '../src/server/voice/sarvam'

const LANGS: Lang[] = ['en', 'hi', 'hinglish']
const SAY: Record<Lang, (drug: string) => string> = {
  en: (d) => `I am taking ${d} twice a day after food.`,
  hi: (d) => `मैं रोज़ सुबह ${d} लेती हूँ, डॉक्टर ने बताया था।`,
  hinglish: (d) => `Main roz subah ${d} leti hoon, doctor ne bataya tha.`,
}
const CACHE = '.cache/asr-eval'
const OUT = 'data/eval/asr-report.json'

type Row = { drug: string; lang: Lang; said: string; plain: string; withKeyterms: string }
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const round = (x: number) => Math.round(x * 1000) / 1000
function score(rows: Row[]) {
  const s = (k: 'plain' | 'withKeyterms') => ({
    wer: round(mean(rows.map((r) => wer(r[k], r.said)))),
    drugNameErrorRate: round(rows.filter((r) => !heard(r[k], r.drug)).length / rows.length),
    drugNamesHeard: rows.filter((r) => heard(r[k], r.drug)).length,
    // the worst miss: a different medicine from the list, which reads as plausible
    otherListedDrug: rows.filter((r) => !heard(r[k], r.drug) && DEFAULT_FORMULARY.some((d) => d !== r.drug && heard(r[k], d))).map((r) => `${r.drug} → ${r[k]}`),
  })
  return { clips: rows.length, plain: s('plain'), withKeyterms: s('withKeyterms') }
}

async function main() {
  if (process.argv.includes('--rescore')) return write(JSON.parse(readFileSync(OUT, 'utf8')).rows)
  if (!process.env.SARVAM_API_KEY) throw new Error('SARVAM_API_KEY is not set')
  mkdirSync(CACHE, { recursive: true })
  const drugs = DEFAULT_FORMULARY.slice(0, 50)
  const rows: Row[] = []
  for (const [i, drug] of drugs.entries()) {
    const lang = LANGS[i % LANGS.length]
    const said = SAY[lang](drug)
    const file = join(CACHE, `${lang}-${drug.replace(/\W+/g, '_')}.wav`)
    if (!existsSync(file)) writeFileSync(file, await speak(said, lang))
    const audio = new Blob([readFileSync(file)], { type: 'audio/wav' })
    const plain = await transcribe(audio, lang)
    const withKeyterms = await transcribe(audio, lang, buildKeyterms({ medicines: [drug], institutions: [] }))
    rows.push({ drug, lang, said, plain, withKeyterms })
    process.stdout.write(`${i + 1}/${drugs.length} ${lang} ${drug}: ${heard(plain, drug) ? 'heard' : 'missed'} → ${heard(withKeyterms, drug) ? 'heard' : 'missed'} with keyterms\n`)
  }
  write(rows)
}

function write(rows: Row[]) {
  const report = {
    generatedAt: new Date().toISOString(),
    setup: { tts: `Sarvam ${TTS_MODEL} (${TTS_SPEAKER})`, asr: `Sarvam ${SARVAM_MODEL}`, modes: { en: 'transcribe', hi: 'codemix', hinglish: 'translit' }, keyterms: "the patient's own medicine, then the 50-name formulary" },
    caveat: 'Synthetic TTS speech, one voice, no background noise: an upper bound, not field accuracy. Shadow-phase clips from real patients are still needed before voice is enabled for real patients (FR-VOX-03).',
    overall: score(rows),
    byLanguage: Object.fromEntries(LANGS.map((l) => [l, score(rows.filter((r) => r.lang === l))])),
    rows,
  }
  writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ overall: report.overall, byLanguage: report.byLanguage }, null, 2))
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
