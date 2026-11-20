import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import nextConfig from '../../../next.config'
import { codestreamSize, decodeJ2k, decodeJpegLossless, decodeJpegLs } from './codecs'
import { buildSyntheticDicom } from './dicom-synthetic'
import { J2K_GRADIENT_B64, j2kGradient } from './j2k-fixture'
import { renderDicomFrame } from './dicom'
import { BundleWriter, bundleSliceAt } from './study'
import { planZip } from './zip'

const J2K = new Uint8Array(Buffer.from(J2K_GRADIENT_B64, 'base64'))
const TS_J2K_LOSSLESS = '1.2.840.10008.1.2.4.90'
const TS_JLS = '1.2.840.10008.1.2.4.80'
const TS_JPEG_LOSSLESS = '1.2.840.10008.1.2.4.70'
const size = (n: number) => ({ width: n, height: n })
const nodeRequire = createRequire(join(process.cwd(), 'package.json'))

/** Grey value drawn at (x, y) of a preview PNG. */
async function greyAt(png: Buffer, x: number, y: number): Promise<number> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  return data[(y * info.width + x) * info.channels]
}

describe('JPEG 2000 DICOM preview (decoded for display only)', () => {
  it('decodes a lossless codestream from another encoder back to the exact pixels', async () => {
    const d = await decodeJ2k(J2K, size(48))
    expect([d.width, d.height, d.samples, d.bytesPerSample]).toEqual([48, 48, 1, 2])
    const dv = new DataView(d.data.buffer, d.data.byteOffset, d.data.byteLength)
    for (const [x, y] of [[0, 0], [47, 0], [0, 47], [47, 47], [20, 31]]) expect(dv.getUint16((y * 48 + x) * 2, true)).toBe(j2kGradient(x, y))
  })

  it('draws a PNG for a JPEG 2000 DICOM, and the picture follows the window in the header', async () => {
    const dcm = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.826.0.1.3680043.8.498.77', size: 48, encapsulated: { transferSyntax: TS_J2K_LOSSLESS, frames: [J2K] } })
    const r = await renderDicomFrame(dcm)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // header window: centre 2040, width 4080 -> value v maps to v / 4080 * 255
    expect(await greyAt(r.png, 0, 0)).toBe(0)
    for (const [x, y] of [[47, 47], [20, 31], [3, 40]]) expect(Math.abs((await greyAt(r.png, x, y)) - (j2kGradient(x, y) / 4080) * 255)).toBeLessThanOrEqual(1)
  })

  it('end to end: a JPEG 2000 slice inside a stored study bundle previews like the file on its own', async () => {
    const dcm = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.826.0.1.3680043.8.498.78', size: 48, encapsulated: { transferSyntax: TS_J2K_LOSSLESS, frames: [J2K] } })
    const w = new BundleWriter(1048576)
    for (let i = 1; i <= 3; i++) w.add(`000${i}-IM${i}`, dcm, false)
    const slice = bundleSliceAt(w.finish(), 1)
    expect(slice.count).toBe(3)
    const alone = await renderDicomFrame(dcm), inBundle = await renderDicomFrame(slice.data!, 0)
    expect(alone.ok && inBundle.ok).toBe(true)
    if (alone.ok && inBundle.ok) expect(inBundle.png.equals(alone.png)).toBe(true)
  })

  it('says so plainly (and does not throw) for a broken JPEG 2000 file, and the next good file still draws', async () => {
    const broken = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.3', size: 48, encapsulated: { transferSyntax: TS_J2K_LOSSLESS, frames: [new Uint8Array([1, 2, 3, 4])] } })
    expect(await renderDicomFrame(broken)).toMatchObject({ ok: false, reason: 'compression' })
    const truncated = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.3', size: 48, encapsulated: { transferSyntax: TS_J2K_LOSSLESS, frames: [J2K.subarray(0, 60)] } })
    expect(await renderDicomFrame(truncated)).toMatchObject({ ok: false, reason: 'compression' })
    const good = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.3', size: 48, encapsulated: { transferSyntax: TS_J2K_LOSSLESS, frames: [J2K] } })
    expect((await renderDicomFrame(good)).ok).toBe(true)
  })

  it('refuses a codestream whose own size differs from the header before the decoder allocates for it', async () => {
    expect(codestreamSize(J2K)).toEqual(size(48))
    await expect(decodeJ2k(J2K, size(32))).rejects.toThrow(/size/)
    const lying = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.3', size: 32, encapsulated: { transferSyntax: TS_J2K_LOSSLESS, frames: [J2K] } })
    expect(await renderDicomFrame(lying)).toMatchObject({ ok: false, reason: 'compression' })
  })

  it('takes signedness from the DICOM header, not the codestream (12 bits stored, signed)', async () => {
    // same unsigned codestream; the header now says signed 12-bit, so stored values of 2048 and up are negative
    const dcm = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.3', size: 48, pixelHeader: { signed: true, bitsStored: 12, window: [0, 4096] }, encapsulated: { transferSyntax: TS_J2K_LOSSLESS, frames: [J2K] } })
    const r = await renderDicomFrame(dcm)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const expected = (x: number, y: number) => { let v = j2kGradient(x, y) & 0xfff; if (v & 0x800) v -= 0x1000; return Math.min(255, Math.max(0, ((v + 2048) / 4096) * 255)) }
    for (const [x, y] of [[0, 0], [20, 31], [47, 47], [40, 30]]) expect(Math.abs((await greyAt(r.png, x, y)) - expected(x, y))).toBeLessThanOrEqual(1)
  })
})

async function encodeJpegLs(w: number, h: number, value: (i: number) => number, isSigned = false): Promise<Uint8Array> {
  const factory = nodeRequire('@cornerstonejs/codec-charls/wasmjs') as (o?: object) => Promise<{ JpegLSEncoder: new () => { getDecodedBuffer(fi: object): Uint8Array; setNearLossless(n: number): void; encode(): void; getEncodedBuffer(): Uint8Array } }>
  const m = await factory()
  const e = new m.JpegLSEncoder()
  const b = e.getDecodedBuffer({ width: w, height: h, bitsPerSample: 12, componentCount: 1, isSigned })
  const u = new Uint16Array(b.buffer, b.byteOffset, w * h)
  for (let i = 0; i < w * h; i++) u[i] = value(i)
  e.setNearLossless(0); e.encode()
  return new Uint8Array(e.getEncodedBuffer())
}

describe('JPEG-LS DICOM preview', () => {
  it('round-trips a lossless JPEG-LS picture and draws it', async () => {
    const enc = await encodeJpegLs(32, 32, (i) => (i * 7) % 4000)
    expect(codestreamSize(enc)).toEqual(size(32))
    await expect(decodeJpegLs(enc, size(16))).rejects.toThrow(/size/)
    const d = await decodeJpegLs(enc, size(32))
    const dv = new DataView(d.data.buffer, d.data.byteOffset, d.data.byteLength)
    for (const i of [0, 5, 500, 1023]) expect(dv.getUint16(i * 2, true)).toBe((i * 7) % 4000)
    const dcm = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.3', size: 32, encapsulated: { transferSyntax: TS_JLS, frames: [enc] } })
    expect((await renderDicomFrame(dcm)).ok).toBe(true)
  })

  it('reads a signed CT (pixel representation 1) as negative numbers, then applies the rescale and the window', async () => {
    // stored -1000 as 12-bit two's complement (0xC18); rescale slope 1, intercept 24 -> -976 HU; window centre -976, width 100 -> mid grey
    const enc = await encodeJpegLs(16, 16, () => 0xc18, true)
    const dcm = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.3', size: 16, pixelHeader: { signed: true, bitsStored: 12, rescale: [1, 24], window: [-976, 100] }, encapsulated: { transferSyntax: TS_JLS, frames: [enc] } })
    const r = await renderDicomFrame(dcm)
    expect(r.ok).toBe(true)
    if (r.ok) expect(Math.abs((await greyAt(r.png, 8, 8)) - 128)).toBeLessThanOrEqual(1)
  })

  it('rejects a codestream that is not JPEG-LS without throwing the whole preview', async () => {
    await expect(decodeJpegLs(new Uint8Array([0, 1, 2, 3]), size(2))).rejects.toBeTruthy()
    const dcm = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.3', size: 48, encapsulated: { transferSyntax: TS_JLS, frames: [new Uint8Array([1, 2, 3, 4])] } })
    expect(await renderDicomFrame(dcm)).toMatchObject({ ok: false })
  })
})

/**
 * A tiny lossless JPEG (process 14, first-order prediction) built by hand: P bits, one component, each row a ramp
 * value(x, y) = 2^(P-1) + x. Huffman table: difference category 0 = "0", category 1 = "10" (then one bit, 1 = +1).
 */
function losslessJpegRamp(w: number, h: number, p = 12): Uint8Array {
  const bits: number[] = []
  for (let y = 0; y < h; y++) { bits.push(0); for (let x = 1; x < w; x++) bits.push(1, 0, 1) }
  while (bits.length % 8) bits.push(0)
  const scan: number[] = []
  for (let i = 0; i < bits.length; i += 8) scan.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))
  const seg = (m: number, body: number[]) => [0xff, m, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]
  return new Uint8Array([
    0xff, 0xd8,
    ...seg(0xc4, [0x00, 1, 1, ...new Array(14).fill(0), 0, 1]), // DHT: one code of length 1, one of length 2; symbols 0, 1
    ...seg(0xc3, [p, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0]), // SOF3
    ...seg(0xda, [1, 1, 0x00, 1, 0, 0]), // SOS: predictor 1 (left)
    ...scan, 0xff, 0xd9,
  ])
}

describe('JPEG lossless DICOM preview', () => {
  it('decodes a lossless JPEG back to its exact values and draws it', async () => {
    const lj = losslessJpegRamp(16, 8)
    expect(codestreamSize(lj)).toEqual({ width: 16, height: 8 })
    const d = await decodeJpegLossless(lj, { width: 16, height: 8 }, 1)
    const dv = new DataView(d.data.buffer, d.data.byteOffset, d.data.byteLength)
    for (const [x, y] of [[0, 0], [15, 0], [7, 7]]) expect(dv.getUint16((y * 16 + x) * 2, true)).toBe(2048 + x)
    await expect(decodeJpegLossless(lj, size(16), 1)).rejects.toThrow(/size/)
    const lying = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.3', size: 16, encapsulated: { transferSyntax: TS_JPEG_LOSSLESS, frames: [lj] } })
    expect(await renderDicomFrame(lying)).toMatchObject({ ok: false, reason: 'compression' }) // the header says 16 x 16, the picture is 16 x 8
    const dcm = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.3', size: 16, pixelHeader: { window: [2056, 16] }, encapsulated: { transferSyntax: TS_JPEG_LOSSLESS, frames: [losslessJpegRamp(16, 16)] } })
    const r = await renderDicomFrame(dcm)
    expect(r.ok).toBe(true)
    if (r.ok) expect([await greyAt(r.png, 0, 5), await greyAt(r.png, 8, 5), await greyAt(r.png, 15, 5)]).toEqual([0, 128, 239]) // window 2048..2064
  })
})

describe('uncompressed pixels: bits stored, signedness and rescale from the header', () => {
  const frame = (v: number, n = 16 * 16) => { const b = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) b.writeUInt16LE(v, i * 2); return b }
  it('ignores bits above bits stored (overlay or junk in the high bits)', async () => {
    const dcm = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.3', size: 16, rawFrames: [frame(0xf000 | 1024)], pixelHeader: { bitsStored: 12, window: [2048, 4096] } })
    const r = await renderDicomFrame(dcm)
    expect(r.ok && (await greyAt(r.png, 3, 3))).toBe(64) // 1024 -> a quarter of the way up, not white
  })
  it('extends the sign of a signed 12-bit value stored without its high bits', async () => {
    const dcm = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.3', size: 16, rawFrames: [frame(0x0c18)], pixelHeader: { signed: true, bitsStored: 12, window: [-1000, 100] } })
    const r = await renderDicomFrame(dcm)
    expect(r.ok && (await greyAt(r.png, 3, 3))).toBe(128) // -1000 at the window centre
  })
  it('applies the rescale slope and intercept before the window', async () => {
    const dcm = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.3', size: 16, rawFrames: [frame(12)], pixelHeader: { rescale: [2, -1024], window: [-1000, 100] } })
    const r = await renderDicomFrame(dcm)
    expect(r.ok && (await greyAt(r.png, 3, 3))).toBe(128) // 12 * 2 - 1024 = -1000
  })
})

describe('where the decoders come from on the server', () => {
  it('opens only codec files that next.config.ts traces into the API functions, wherever the server was started from', async () => {
    const home = process.cwd()
    const traced = new Set((nextConfig.outputFileTracingIncludes?.['/api/**/*'] ?? []).map((p) => p.replace(/^\.\//, '')))
    // what the loader really opens: the modules codecs.ts imports, the .wasm each of them locates next to itself, and their package.json
    const specs = [...readFileSync(join(home, 'src/server/pipeline/codecs.ts'), 'utf8').matchAll(/import\('([^']+)'\)/g)].map((m) => m[1])
    expect(specs).toHaveLength(3)
    const code = specs.map((s) => nodeRequire.resolve(s))
    const wasm = code.flatMap((js) => { const m = /findWasmBinary\(\)\{var f="([^"]+)"/.exec(readFileSync(js, 'utf8')); return m ? [join(dirname(js), m[1])] : [] })
    expect(wasm).toHaveLength(2)
    const pkgs = specs.map((s) => join(home, 'node_modules', s.split('/').slice(0, s.startsWith('@') ? 2 : 1).join('/'), 'package.json'))
    const opened = [...code, ...wasm, ...pkgs].map((f) => relative(home, f))
    for (const f of opened) {
      expect(traced, `${f} is opened at run time but not traced`).toContain(f)
      expect(existsSync(join(home, f))).toBe(true)
    }
    expect([...traced].filter((p) => /codec-openjpeg|codec-charls|jpeg-lossless/.test(p)).sort()).toEqual(opened.sort()) // exactly these, no globs
    expect(nextConfig.serverExternalPackages).toEqual(expect.arrayContaining(['@cornerstonejs/codec-openjpeg', '@cornerstonejs/codec-charls', 'jpeg-lossless-decoder-js']))
    // and they are found from the module's own folder: a server started from anywhere else still decodes
    const jls = await encodeJpegLs(8, 8, (i) => i)
    process.chdir(tmpdir())
    try {
      vi.resetModules()
      const fresh = await import('./codecs')
      expect((await fresh.decodeJ2k(J2K, size(48))).width).toBe(48)
      expect((await fresh.decodeJpegLs(jls, size(8))).width).toBe(8)
      expect((await fresh.decodeJpegLossless(losslessJpegRamp(4, 4), size(4), 1)).width).toBe(4)
    } finally { process.chdir(home) }
  })
})

describe('the demo scans keep previewing', () => {
  const DOCS = join(process.cwd(), 'public/demo-docs')
  it('every synthetic demo DICOM file, and every slice in the demo study ZIPs, still draws', async () => {
    let drawn = 0
    for (const f of readdirSync(DOCS)) {
      if (f.endsWith('.dcm')) { expect(await renderDicomFrame(new Uint8Array(readFileSync(join(DOCS, f)))), f).toMatchObject({ ok: true }); drawn++ }
      if (f.endsWith('.zip')) {
        const plan = planZip(new Uint8Array(readFileSync(join(DOCS, f))))
        expect(plan.ok).toBe(true)
        if (plan.ok) for (const e of plan.entries) { expect(await renderDicomFrame(e.data), `${f}/${e.name}`).toMatchObject({ ok: true }); drawn++ }
      }
    }
    expect(drawn).toBeGreaterThan(10)
  })
})
