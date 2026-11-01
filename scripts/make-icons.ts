// Generates the PWA icons from the OncoSetu arch mark (same paths as src/app/icon.svg):
//   npx tsx scripts/make-icons.ts
// Colours are the design tokens: gallery #f5f4f0 (wall) and setu #0f6e6a (brand stroke).
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const OUT = join(process.cwd(), 'public', 'icons')
const GALLERY = '#f5f4f0'
const SETU = '#0f6e6a'

// `scale` shrinks the mark around the centre; maskable icons keep it inside the central 80 % safe zone.
const svg = (scale: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" fill="${GALLERY}"/>
<g transform="translate(16 16) scale(${scale}) translate(-16 -16)" fill="none" stroke="${SETU}" stroke-width="2.2" stroke-linecap="square">
<path d="M4 27h24"/><path d="M6 27V16a10 10 0 0 1 20 0v11"/><path d="M11.5 27v-8a4.5 4.5 0 0 1 9 0v8"/></g></svg>`

async function main() {
  await mkdir(OUT, { recursive: true })
  await writeFile(join(OUT, 'mark.svg'), svg(0.9))
  const png = (name: string, size: number, scale: number) =>
    sharp(Buffer.from(svg(scale)), { density: 384 }).resize(size, size).png().toFile(join(OUT, name))
  await png('icon-192.png', 192, 0.9)
  await png('icon-512.png', 512, 0.9)
  await png('icon-maskable-512.png', 512, 0.62)
  console.log('wrote mark.svg, icon-192.png, icon-512.png, icon-maskable-512.png')
}
main().catch((e) => { console.error(e); process.exit(1) })
