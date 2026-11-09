/**
 * Generates the THIRD HELD-OUT (blind) evaluation documents into data/eval/heldout3/ (NOT public/: never served, never
 * seeded): the files, manifest.json, patients.json, ocr-truth.json (ground-truth text of every image page) and
 * data/eval/gold-heldout3.json. Mirrors generate-heldout2.ts. Run from the repo root:
 *   npx tsx scripts/demo-docs/generate-heldout3.ts
 * Deterministic. --only=<substring> rebuilds just the matching files (the layout and gold checks still run for all).
 * Extra check: every gold `match` string must appear in the document's own text.
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { initEngine, layout, photograph, SYNTH, toPdf, toSvg } from './engine'
import { GOLD_ABOUT, heldDocs, heldPatients, type HeldDoc } from './heldout3-docs'
import { pageTruth, type OcrTruth } from './truth'

const ROOT = resolve(dirname(process.argv[1] ?? '.'), '..', '..')
const OUT = join(ROOT, 'data', 'eval', 'heldout3')
const MAX_PDF = 1_000_000
const MAX_JPG = 1_500_000

const fileName = (d: HeldDoc) => `${d.patientKey}__${String(d.n).padStart(2, '0')}-${d.slug}.${d.fmt}`
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7)
const flat = (s: string) => s.replace(/\s+/g, ' ').toLowerCase()

async function main() {
  await initEngine()
  await mkdir(OUT, { recursive: true })
  if (!only) for (const f of await readdir(OUT)) await rm(join(OUT, f))

  const manifest = []
  const gold: Record<string, unknown> = {}
  const truth: OcrTruth = {}
  const seen = new Set<string>()
  for (const d of heldDocs) {
    const file = fileName(d)
    if (seen.has(file)) throw new Error(`duplicate file name ${file}`)
    seen.add(file)
    if (!heldPatients.some((p) => p.patientKey === d.patientKey)) throw new Error(`${file}: unknown patient`)
    const pages = d.pages ? d.pages() : layout({ ...d, file }, { fs: d.fs ?? 1, foot: d.fmt === 'jpg' ? 9.6 : 7 })
    pages.forEach((ops, i) => {
      if (!ops.some((o) => o.k === 'text' && o.s === SYNTH)) throw new Error(`${file} page ${i + 1} has no synthetic footer`)
    })
    const text = flat(pages.map(pageTruth).join('\n'))
    for (const e of d.gold.events) if (e.match && !text.includes(flat(e.match))) throw new Error(`${file}: gold match "${e.match}" not in the document text`)
    if (d.fmt === 'jpg') truth[file] = Object.fromEntries(pages.map((ops, i) => [String(i + 1), { handwritten: d.docType === 'prescription_handwritten', text: pageTruth(ops) }]))
    let bytes: Uint8Array = new Uint8Array(0)
    if (only === undefined || file.includes(only)) {
      if (d.fmt === 'pdf') {
        bytes = await toPdf({ title: d.title, author: d.institution ?? d.inst.name }, pages)
        if (bytes.length > MAX_PDF) throw new Error(`${file}: ${bytes.length} bytes exceeds ${MAX_PDF}`)
      } else {
        if (pages.length !== 1 || !d.photo) throw new Error(`${file}: photographed documents are single page and need photo options`)
        bytes = await photograph(toSvg(pages[0], d.photo.paper, d.photo.seed), d.photo, MAX_JPG)
      }
      await writeFile(join(OUT, file), bytes)
      console.log(`${file.padEnd(58)} ${String(bytes.length).padStart(8)} B  ${pages.length}p`)
    }
    manifest.push({ file, patientKey: d.patientKey, title: d.title, docType: d.docType, documentDate: d.date, institution: d.institution ?? d.inst.name, pages: pages.length, kind: d.fmt === 'pdf' ? 'pdf' : 'image', tests: d.tests })
    gold[file] = { patientKey: d.patientKey, docType: d.docType, ...d.gold }
  }
  const json = (x: unknown) => JSON.stringify(x, null, 2) + '\n'
  await writeFile(join(OUT, 'manifest.json'), json(manifest))
  await writeFile(join(OUT, 'patients.json'), json(heldPatients))
  await writeFile(join(OUT, 'ocr-truth.json'), json(truth))
  await writeFile(join(ROOT, 'data', 'eval', 'gold-heldout3.json'), json({ version: 1, about: GOLD_ABOUT, docs: gold }))
  console.log(`\n${manifest.length} documents + manifest.json + patients.json + ocr-truth.json -> ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
