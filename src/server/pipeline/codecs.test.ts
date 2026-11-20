import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { decodeJ2k, decodeJpegLs } from './codecs'
import { buildSyntheticDicom } from './dicom-synthetic'
import { J2K_GRADIENT_B64, j2kGradient } from './j2k-fixture'
import { renderDicomFrame } from './dicom'

const J2K = new Uint8Array(Buffer.from(J2K_GRADIENT_B64, 'base64'))
const TS_J2K_LOSSLESS = '1.2.840.10008.1.2.4.90'

describe('JPEG 2000 DICOM preview (decoded for display only)', () => {
  it('decodes a lossless codestream from another encoder back to the exact pixels', async () => {
    const d = await decodeJ2k(J2K)
    expect([d.width, d.height, d.samples, d.bytesPerSample]).toEqual([48, 48, 1, 2])
    const dv = new DataView(d.data.buffer, d.data.byteOffset, d.data.byteLength)
    for (const [x, y] of [[0, 0], [47, 0], [0, 47], [47, 47], [20, 31]]) expect(dv.getUint16((y * 48 + x) * 2, true)).toBe(j2kGradient(x, y))
  })

  it('draws a PNG for a JPEG 2000 DICOM, and the picture follows the window in the header', async () => {
    const dcm = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.826.0.1.3680043.8.498.77', size: 48, encapsulated: { transferSyntax: TS_J2K_LOSSLESS, frames: [J2K] } })
    const r = await renderDicomFrame(dcm)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { data, info } = await sharp(r.png).raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([48, 48])
    // header window: centre 2040, width 4080 -> value v maps to v / 4080 * 255
    const at = (x: number, y: number) => data[(y * 48 + x) * info.channels]
    expect(at(0, 0)).toBe(0)
    for (const [x, y] of [[47, 47], [20, 31], [3, 40]]) expect(Math.abs(at(x, y) - (j2kGradient(x, y) / 4080) * 255)).toBeLessThanOrEqual(1)
  })

  it('says so plainly (and does not throw) for a broken JPEG 2000 file', async () => {
    const dcm = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.3', size: 48, encapsulated: { transferSyntax: TS_J2K_LOSSLESS, frames: [new Uint8Array([1, 2, 3, 4])] } })
    expect(await renderDicomFrame(dcm)).toMatchObject({ ok: false })
  })
})

async function encodeJpegLs(w: number, h: number, value: (i: number) => number): Promise<Uint8Array> {
  const factory = (await import('@cornerstonejs/codec-charls/wasmjs' as string)) as { default: (o: { wasmBinary: Buffer }) => Promise<{ JpegLSEncoder: new () => { getDecodedBuffer(fi: object): Uint8Array; setNearLossless(n: number): void; encode(): void; getEncodedBuffer(): Uint8Array } }> }
  const { readFileSync } = await import('node:fs')
  const m = await factory.default({ wasmBinary: readFileSync(`${process.cwd()}/node_modules/@cornerstonejs/codec-charls/dist/charlswasm.wasm`) })
  const e = new m.JpegLSEncoder()
  const b = e.getDecodedBuffer({ width: w, height: h, bitsPerSample: 12, componentCount: 1, isSigned: false })
  const u = new Uint16Array(b.buffer, b.byteOffset, w * h)
  for (let i = 0; i < w * h; i++) u[i] = value(i)
  e.setNearLossless(0); e.encode()
  return new Uint8Array(e.getEncodedBuffer())
}

describe('JPEG-LS DICOM preview', () => {
  it('round-trips a lossless JPEG-LS picture and draws it', async () => {
    const enc = await encodeJpegLs(32, 32, (i) => (i * 7) % 4000)
    const d = await decodeJpegLs(enc)
    const dv = new DataView(d.data.buffer, d.data.byteOffset, d.data.byteLength)
    for (const i of [0, 5, 500, 1023]) expect(dv.getUint16(i * 2, true)).toBe((i * 7) % 4000)
    const dcm = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.3', size: 32, encapsulated: { transferSyntax: '1.2.840.10008.1.2.4.80', frames: [enc] } })
    expect((await renderDicomFrame(dcm)).ok).toBe(true)
  })

  it('rejects a codestream that is not JPEG-LS without throwing the whole preview', async () => {
    await expect(decodeJpegLs(new Uint8Array([0, 1, 2, 3]))).rejects.toBeTruthy()
    const dcm = await buildSyntheticDicom({ modality: 'CT', patientName: 'Test^Synthetic', studyUid: '1.2.3', size: 48, encapsulated: { transferSyntax: '1.2.840.10008.1.2.4.80', frames: [new Uint8Array([1, 2, 3, 4])] } })
    expect(await renderDicomFrame(dcm)).toMatchObject({ ok: false })
  })
})
