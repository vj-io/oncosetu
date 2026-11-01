/**
 * Generates the synthetic demo documents, public/demo-docs/manifest.json and patients.json.
 * Run from the repo root:  npx tsx scripts/demo-docs/generate.ts
 * Deterministic: same input -> same files (fixed PDF dates, seeded noise).
 * Every institution and person is fictional; every page carries "SYNTHETIC DOCUMENT - FOR DEMONSTRATION ONLY".
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { docs } from './docs'
import type { Doc } from './docs'
import { initEngine, layout, photograph, toPdf, toSvg } from './engine'

const ROOT = resolve(dirname(process.argv[1] ?? '.'), '..', '..')
const OUT = join(ROOT, 'public', 'demo-docs')
const MAX_PDF = 1_000_000
const MAX_JPG = 1_500_000

const fileName = (d: Doc) => `${d.patientKey}__${String(d.n).padStart(2, '0')}-${d.slug}.${d.fmt}`
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[^a-z'])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase())
const by = (key: string, ...n: number[]) => n.map((i) => fileName(docs.find((d) => d.patientKey === key && d.n === i) as Doc))

const patients = [
  {
    patientKey: 'hero',
    fullName: 'Sunita Deshmukh',
    aliases: ['Mrs. Sunita Deshmukh', 'SUNITA DESHMUKH', 'सुनीता देशमुख'],
    sex: 'female',
    dob: '1974-08-14',
    phone: '+91 98220 41736',
    preferredLanguage: 'hi',
    caregiver: { name: 'Rohan Deshmukh', relation: 'son', phone: '+91 98230 55102' },
    disclosureStatus: 'not_cleared',
    primaryContact: 'caregiver',
    registeringOrg: 'Narmada Regional Cancer Centre',
    visit: 'first visit (journey J1): outside records only',
    demo: {
      backlog: by('hero', 1, 2, 3, 4, 5, 6, 7, 8),
      expectBlockedByIdentity: by('hero', 7),
      expectSanitised: by('hero', 8),
      expectHandwrittenNoEvents: by('hero', 5),
      newlyReceivedOlder: by('hero', 9),
      laterArrival: by('hero', 10, 11),
    },
    note: 'Disclosure not_cleared with the son as primary contact is a demo choice: it exercises the strictest patient-facing copy rules (FR-CON-07).',
  },
  {
    patientKey: 'returning',
    fullName: 'Mohd. Abdul Rahim Khan',
    aliases: ['Mohammed Abdul Rahim', 'Md. A. Rahim Khan', 'मोहम्मद अब्दुल रहीम'],
    sex: 'male',
    dob: '1962-01-02',
    phone: '+91 99870 12345',
    preferredLanguage: 'hi',
    caregiver: null,
    disclosureStatus: 'cleared',
    primaryContact: 'patient',
    registeringOrg: 'Narmada Regional Cancer Centre',
    visit: 'returning visit (journey J2): last sealed snapshot S1 already contains the previous-visit set',
    demo: {
      lastSealedSnapshot: by('returning', 1, 2, 3),
      newSinceLastVisit: by('returning', 4, 5, 6),
      amendedAfterSnapshot: by('returning', 7),
      preVisitAnswerForConflict:
        "Patient says he was given a different medicine at another hospital than 'Cap. Capecitabine 500 mg' (prescription of 12/05/2026) -> conflict item.",
    },
    note: 'Name variants appear across documents on purpose (transliteration-aware identity match).',
  },
  {
    patientKey: 'fulfilled',
    fullName: 'Lakshmi Narayanan',
    aliases: ['Smt. Lakshmi Narayanan', 'LAKSHMI NARAYANAN', 'Lakshmi N.'],
    sex: 'female',
    dob: '1980-09-23',
    phone: '+91 94440 67821',
    preferredLanguage: 'en',
    caregiver: { name: 'K. Narayanan', relation: 'husband', phone: '+91 94440 67890' },
    disclosureStatus: 'unknown',
    primaryContact: 'caregiver',
    registeringOrg: 'Narmada Regional Cancer Centre',
    visit: 'records request fulfilled (journey J4)',
    demo: { backlog: by('fulfilled', 1), laterArrival: by('fulfilled', 2) },
    note: 'Disclosure unknown (the registration default) with the husband as primary contact: patient-facing copy must stay administrative.',
  },
]

// optional: --only=<substring> rebuilds just the matching files (dev loop); manifest/patients always cover everything
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7)

async function main() {
  await initEngine()
  await mkdir(OUT, { recursive: true })
  if (!only)
    for (const f of await readdir(OUT)) if (/^(hero|returning|fulfilled)__/.test(f) || f === 'manifest.json' || f === 'patients.json') await rm(join(OUT, f))

  const manifest = []
  for (const d of docs) {
    const file = fileName(d)
    const skip = only !== undefined && !file.includes(only)
    const pages = d.pages ? d.pages() : layout({ ...d, file }, { fs: d.fs ?? 1, foot: d.fmt === 'jpg' ? 9.6 : 7 })
    let bytes: Uint8Array = new Uint8Array(0)
    if (skip) {
      // metadata only
    } else if (d.fmt === 'pdf') {
      bytes = await toPdf({ title: d.title, author: titleCase(d.institution ?? d.inst.name) }, pages)
      if (bytes.length > MAX_PDF) throw new Error(`${file}: ${bytes.length} bytes exceeds ${MAX_PDF}`)
    } else {
      if (pages.length !== 1 || !d.photo) throw new Error(`${file}: photographed documents are single page and need photo options`)
      bytes = await photograph(toSvg(pages[0], d.photo.paper, d.photo.seed), d.photo, MAX_JPG)
    }
    if (!skip) await writeFile(join(OUT, file), bytes)
    manifest.push({
      file,
      patientKey: d.patientKey,
      title: d.title,
      docType: d.docType,
      documentDate: d.date,
      institution: d.institution ?? titleCase(d.inst.name),
      pages: pages.length,
      kind: d.fmt === 'pdf' ? 'pdf' : 'image',
      demoStep: d.demoStep,
      expect: d.expect,
    })
    if (!skip) console.log(`${file.padEnd(52)} ${String(bytes.length).padStart(8)} B  ${pages.length}p`)
  }
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(join(OUT, 'patients.json'), JSON.stringify(patients, null, 2) + '\n')
  console.log(`\n${manifest.length} documents + manifest.json + patients.json -> ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
