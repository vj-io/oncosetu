/**
 * Writes the synthetic test photos of a ruled two-block header table (src/server/pipeline/table.test.ts) to
 * data/fixtures/ruled-table/. The tests read these files rather than rendering the table themselves, because SVG text
 * renders with whatever fonts the machine has (CoreText on macOS, fontconfig on Linux CI), and the same picture must reach
 * OCR everywhere. Synthetic names and values only.
 *
 *   npx tsx scripts/test-fixtures/ruled-table.ts               (on macOS: every fixture but full-liberation.jpg)
 *   npx tsx scripts/test-fixtures/ruled-table.ts <file>...     (only the named ones)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

export type TableOptions = { name?: string; id?: string; age?: string; sex?: string; ruled?: boolean; font?: string }

/** A ruled two-block header table on a phone photo: grey paper, tilted, slightly soft. Empty strings leave a cell blank. */
export async function tablePhoto(o: TableOptions = {}): Promise<Buffer> {
  const rows = [70, 110, 150, 190, 270], L = [150, 350, 740, 930, 1110], font = o.font ?? 'Arial'
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1650"><rect width="100%" height="100%" fill="#fff"/>'
  svg += `<text x="620" y="40" font-family="${font}" font-size="34" font-weight="bold" text-anchor="middle">CITY IMAGING CENTRE</text>`
  if (o.ruled !== false) {
    for (const y of rows) svg += `<rect x="${L[0]}" y="${y}" width="${L[4] - L[0]}" height="3"/>`
    for (const x of L) svg += `<rect x="${x}" y="${rows[0]}" width="3" height="${rows.at(-1)! - rows[0] + 3}"/>`
  }
  const put = (x: number, y: number, t: string) => { if (t) svg += `<text x="${x + 10}" y="${y}" font-family="${font}" font-size="26">${t}</text>` }
  const left: [string, string][] = [['Patient Name', o.name ?? 'Mrs. Asha Testkar'], ['Patient ID', o.id ?? 'PET/2026/0412'], ['Referral Dr', 'Dr. A. Rao']]
  left.forEach(([l, v], i) => { put(L[0], rows[i] + 30, l); put(L[1], rows[i] + 30, v) })
  put(L[0], rows[3] + 32, 'Study Date'); put(L[0], rows[3] + 70, 'Time'); put(L[1], rows[3] + 32, '03 Mar 2026'); put(L[1], rows[3] + 70, '10:15am')
  put(L[2], rows[1] + 30, 'Age'); put(L[3], rows[1] + 30, o.age ?? '47Yr'); put(L[2], rows[2] + 30, 'Sex'); put(L[3], rows[2] + 30, o.sex ?? 'Female')
  put(L[2], rows[3] + 32, 'Report Date'); put(L[2], rows[3] + 70, 'Time'); put(L[3], rows[3] + 32, '05 Mar 2026'); put(L[3], rows[3] + 70, '6:20pm')
  for (const [i, l] of ['WHOLE BODY 18F-FDG PET/CT SCAN', 'Clinical history: Known case of carcinoma breast, post chemotherapy.', 'Findings: No abnormal FDG avid lesion is seen.', 'Impression: Complete metabolic response to therapy.'].entries()) {
    svg += `<text x="150" y="${360 + i * 44}" font-family="${font}" font-size="26">${l}</text>`
  }
  const flat = await sharp(Buffer.from(`${svg}</svg>`)).flatten({ background: '#fff' }).jpeg({ quality: 92 }).toBuffer()
  return sharp(flat).rotate(1.2, { background: '#a49c90' }).modulate({ brightness: 0.82 }).blur(0.6).jpeg({ quality: 80 }).toBuffer()
}

/**
 * The fixtures the tests read, by file name, made on macOS (its Arial and Georgia), except full-liberation.jpg: full.jpg's
 * table drawn on Linux (Debian with fonts-liberation, where Arial is Liberation Sans: the setup that reproduced CI's first
 * failure of these tests).
 */
export const FIXTURES: Record<string, TableOptions> = {
  'full.jpg': {}, 'full-serif.jpg': { font: 'Georgia' }, 'full-liberation.jpg': {}, 'age-52.jpg': { age: '52Yr' }, 'sex-male.jpg': { sex: 'Male' },
  'name-only.jpg': { age: '', sex: '', id: '' }, 'age-blank.jpg': { age: '' }, 'unruled.jpg': { ruled: false },
}

async function main() {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../../data/fixtures/ruled-table')
  mkdirSync(dir, { recursive: true })
  const only = process.argv.slice(2)
  const files = Object.keys(FIXTURES).filter((f) => (only.length ? only.includes(f) : f !== 'full-liberation.jpg'))
  for (const file of files) writeFileSync(join(dir, file), await tablePhoto(FIXTURES[file]))
  console.log(`wrote ${files.join(', ')} to ${dir}`)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1) })
