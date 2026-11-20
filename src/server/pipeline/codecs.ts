// Server-side decoders for the compressed DICOM pixel formats real hospital CDs use, so a preview can be drawn:
//   JPEG 2000 (OpenJPEG, WebAssembly)      1.2.840.10008.1.2.4.90 / .91
//   JPEG-LS (CharLS, WebAssembly)          1.2.840.10008.1.2.4.80 / .81
//   JPEG lossless (pure JavaScript)        1.2.840.10008.1.2.4.57 / .70
// Decode for DISPLAY only: the picture is drawn and thrown away, the stored file is never changed and nothing is read from it.
// No native binaries: the WebAssembly modules (MIT licence, @cornerstonejs/codec-*) run in plain Node on Vercel.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const TS_J2K = new Set(['1.2.840.10008.1.2.4.90', '1.2.840.10008.1.2.4.91'])
export const TS_JLS = new Set(['1.2.840.10008.1.2.4.80', '1.2.840.10008.1.2.4.81'])
export const TS_JPEG_LOSSLESS = new Set(['1.2.840.10008.1.2.4.57', '1.2.840.10008.1.2.4.70'])
export const isCodecSyntax = (ts: string) => TS_J2K.has(ts) || TS_JLS.has(ts) || TS_JPEG_LOSSLESS.has(ts)

/** Decoded pixels: interleaved samples, little endian, 1 or 2 bytes per sample. */
export type Decoded = { data: Uint8Array; width: number; height: number; samples: number; bytesPerSample: 1 | 2; signed: boolean }

type CodecModule = { J2KDecoder?: new () => CodecDecoder; JpegLSDecoder?: new () => CodecDecoder }
type CodecDecoder = {
  getEncodedBuffer(n: number): Uint8Array; getDecodedBuffer(): Uint8Array; decode(): void; delete(): void
  getFrameInfo(): { width: number; height: number; bitsPerSample: number; componentCount: number; isSigned: boolean }
}

// Loaded once per server process. The .wasm file is read from node_modules (kept as an external package and traced into the
// API functions, next.config.ts) and handed to the loader, so nothing is fetched at run time.
const loaded: Record<string, Promise<CodecModule>> = {}
function load(pkg: '@cornerstonejs/codec-openjpeg' | '@cornerstonejs/codec-charls', file: string): Promise<CodecModule> {
  return (loaded[pkg] ??= (async () => {
    const factory = (pkg === '@cornerstonejs/codec-openjpeg'
      ? await import('@cornerstonejs/codec-openjpeg/decodewasmjs')
      : await import('@cornerstonejs/codec-charls/decodewasmjs')) as unknown as { default?: unknown }
    const make = (typeof factory === 'function' ? factory : factory.default ?? factory) as (o: { wasmBinary: Buffer }) => Promise<CodecModule>
    return make({ wasmBinary: readFileSync(join(process.cwd(), 'node_modules', pkg, 'dist', file)) })
  })().catch((e) => { delete loaded[pkg]; throw e }))
}

function run(Dec: new () => CodecDecoder, encoded: Uint8Array): Decoded {
  const d = new Dec()
  try {
    d.getEncodedBuffer(encoded.length).set(encoded)
    d.decode()
    const fi = d.getFrameInfo()
    const out = d.getDecodedBuffer()
    const bytesPerSample = fi.bitsPerSample > 8 ? 2 : 1
    return { data: new Uint8Array(out), width: fi.width, height: fi.height, samples: fi.componentCount, bytesPerSample, signed: fi.isSigned } // copied before delete()
  } finally { d.delete() }
}

export async function decodeJ2k(encoded: Uint8Array): Promise<Decoded> {
  const m = await load('@cornerstonejs/codec-openjpeg', 'openjpegwasm_decode.wasm')
  return run(m.J2KDecoder!, encoded)
}

export async function decodeJpegLs(encoded: Uint8Array): Promise<Decoded> {
  const m = await load('@cornerstonejs/codec-charls', 'charlswasm_decode.wasm')
  return run(m.JpegLSDecoder!, encoded)
}

/** Lossless JPEG (process 14, first-order prediction for .70): pure JavaScript. Precision comes from the JPEG header. */
export async function decodeJpegLossless(encoded: Uint8Array, rows: number, cols: number, samples: number, signed: boolean): Promise<Decoded> {
  const { Decoder } = await import('jpeg-lossless-decoder-js')
  const ab = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
  const out = new Decoder().decode(ab, 0, ab.byteLength)
  const bytesPerSample = out.BYTES_PER_ELEMENT === 2 ? 2 : 1
  return { data: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), width: cols, height: rows, samples, bytesPerSample, signed } // 16-bit values are little endian on every platform we run on
}
