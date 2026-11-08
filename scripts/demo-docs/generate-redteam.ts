/**
 * Generates the RED-TEAM evaluation documents into data/eval/redteam/ (never served, never seeded): the files,
 * manifest.json, patients.json, an empty ocr-truth.json (no image pages) and data/eval/gold-redteam.json.
 * Run from the repo root:  npx tsx scripts/demo-docs/generate-redteam.ts     Deterministic like generate.ts.
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initEngine, layout, SYNTH, toPdf } from './engine'
import { GOLD_ABOUT_REDTEAM, redDocs, redPatients, type RedDoc } from './redteam-docs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'data', 'eval', 'redteam')
const MAX_PDF = 200_000

const fileName = (d: RedDoc) => `${d.patientKey}__${String(d.n).padStart(2, '0')}-${d.slug}.${d.fmt}`

async function main() {
  await initEngine()
  await mkdir(OUT, { recursive: true })
  for (const f of await readdir(OUT)) await rm(join(OUT, f))
  const manifest = []
  const gold: Record<string, unknown> = {}
  const seen = new Set<string>()
  for (const d of redDocs) {
    const file = fileName(d)
    if (seen.has(file)) throw new Error(`duplicate file name ${file}`)
    seen.add(file)
    let bytes: Uint8Array
    let pages = 1
    if (d.fmt === 'pdf') {
      const ops = layout({ ...d, file }, { fs: 1, foot: 7 })
      ops.forEach((o, i) => { if (!o.some((x) => x.k === 'text' && x.s === SYNTH)) throw new Error(`${file} page ${i + 1} has no synthetic footer`) })
      pages = ops.length
      bytes = await toPdf({ title: d.title, author: d.inst.name }, ops)
      if (bytes.length > MAX_PDF) throw new Error(`${file}: ${bytes.length} bytes exceeds ${MAX_PDF}`)
    } else {
      if (!d.text.includes(SYNTH)) throw new Error(`${file} has no synthetic footer`)
      bytes = Buffer.from(d.text, 'utf8')
    }
    await writeFile(join(OUT, file), bytes)
    console.log(`${file.padEnd(54)} ${String(bytes.length).padStart(8)} B  ${pages}p`)
    manifest.push({ file, patientKey: d.patientKey, title: d.title, docType: d.docType, documentDate: d.date, pages, kind: d.fmt === 'pdf' ? 'pdf' : 'text', tests: d.tests })
    gold[file] = { patientKey: d.patientKey, docType: d.docType, ...d.gold }
  }
  const json = (x: unknown) => JSON.stringify(x, null, 2) + '\n'
  await writeFile(join(OUT, 'manifest.json'), json(manifest))
  await writeFile(join(OUT, 'patients.json'), json(redPatients))
  await writeFile(join(OUT, 'ocr-truth.json'), json({}))
  await writeFile(join(ROOT, 'data', 'eval', 'gold-redteam.json'), json({ version: 1, about: GOLD_ABOUT_REDTEAM, docs: gold }))
  console.log(`\n${manifest.length} documents + manifest.json + patients.json -> ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
