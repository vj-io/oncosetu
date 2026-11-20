// Server-side decoders for the compressed DICOM pixel formats real hospital CDs use, so a preview can be drawn:
//   JPEG 2000 (OpenJPEG, WebAssembly)      1.2.840.10008.1.2.4.90 / .91
//   JPEG-LS (CharLS, WebAssembly)          1.2.840.10008.1.2.4.80 / .81
//   JPEG lossless (pure JavaScript)        1.2.840.10008.1.2.4.57 / .70
// Decode for DISPLAY only: the picture is drawn and thrown away, the stored file is never changed and nothing is read from it.
// No native binaries: the WebAssembly modules (MIT licence, @cornerstonejs/codec-*) run in plain Node on Vercel.

export const TS_J2K = new Set(['1.2.840.10008.1.2.4.90', '1.2.840.10008.1.2.4.91'])
export const TS_JLS = new Set(['1.2.840.10008.1.2.4.80', '1.2.840.10008.1.2.4.81'])
export const TS_JPEG_LOSSLESS = new Set(['1.2.840.10008.1.2.4.57', '1.2.840.10008.1.2.4.70'])

/** Decoded pixels: interleaved samples, little endian, 1 or 2 bytes per sample. Signedness and bits stored come from the DICOM header. */
export type Decoded = { data: Uint8Array; width: number; height: number; samples: number; bytesPerSample: 1 | 2 }
export type Size = { width: number; height: number }

type CodecModule = { J2KDecoder?: new () => CodecDecoder; JpegLSDecoder?: new () => CodecDecoder }
type CodecDecoder = {
  getEncodedBuffer(n: number): Uint8Array; getDecodedBuffer(): Uint8Array; decode(): void; delete(): void
  getFrameInfo(): { width: number; height: number; bitsPerSample: number; componentCount: number }
}

/** The picture size written in a JPEG-family (SOF) or JPEG 2000 (SIZ) codestream header, read without decoding. Null when not found. */
export function codestreamSize(b: Uint8Array): Size | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1], u32 = (i: number) => u16(i) * 65536 + u16(i + 2)
  if (b[0] === 0xff && b[1] === 0xd8) { // JPEG lossless and JPEG-LS: walk the marker segments to the frame header
    for (let p = 2; p + 9 <= b.length;) {
      if (b[p] !== 0xff) return null
      const m = b[p + 1]
      if (m === 0xff) { p++; continue }
      if ((m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) || m === 0xf7) return { height: u16(p + 5), width: u16(p + 7) }
      p += 2 + u16(p + 2)
    }
    return null
  }
  for (let i = 0; i + 24 <= Math.min(b.length, 4096); i++) { // JPEG 2000: start of codestream, then SIZ (a JP2 wrapper puts it a little later)
    if (b[i] === 0xff && b[i + 1] === 0x4f && b[i + 2] === 0xff && b[i + 3] === 0x51) return { width: u32(i + 8) - u32(i + 16), height: u32(i + 12) - u32(i + 20) }
  }
  return null
}

/** A decoder allocates for the size its codestream claims; that must be the size the DICOM header claims (already checked against MAX_PREVIEW_PIXELS). */
function assertSize(encoded: Uint8Array, want: Size) {
  const s = codestreamSize(encoded)
  if (!s || s.width !== want.width || s.height !== want.height) throw new Error('The compressed picture is not the size its header says')
}

// Loaded once per server process. Each loader finds its .wasm next to its own .js file (from __dirname, never the working directory);
// both are kept as external packages and traced into the API functions (next.config.ts). Decoder chatter is not logged.
const loaded: Record<string, Promise<CodecModule>> = {}
function load(which: 'j2k' | 'jls'): Promise<CodecModule> {
  return (loaded[which] ??= (async () => {
    const mod = (which === 'j2k'
      ? await import('@cornerstonejs/codec-openjpeg/decodewasmjs')
      : await import('@cornerstonejs/codec-charls/decodewasmjs')) as unknown as { default?: unknown }
    const make = (typeof mod === 'function' ? mod : mod.default ?? mod) as (o: object) => Promise<CodecModule>
    return make({ print: () => {}, printErr: () => {} })
  })().catch((e) => { delete loaded[which]; throw e }))
}

function run(Dec: new () => CodecDecoder, encoded: Uint8Array): Decoded {
  const d = new Dec()
  try {
    d.getEncodedBuffer(encoded.length).set(encoded)
    d.decode()
    const fi = d.getFrameInfo()
    const out = d.getDecodedBuffer()
    return { data: new Uint8Array(out), width: fi.width, height: fi.height, samples: fi.componentCount, bytesPerSample: fi.bitsPerSample > 8 ? 2 : 1 } // copied before delete()
  } finally { d.delete() }
}

export async function decodeJ2k(encoded: Uint8Array, want: Size): Promise<Decoded> {
  assertSize(encoded, want)
  return run((await load('j2k')).J2KDecoder!, encoded)
}

export async function decodeJpegLs(encoded: Uint8Array, want: Size): Promise<Decoded> {
  assertSize(encoded, want)
  return run((await load('jls')).JpegLSDecoder!, encoded)
}

/** Lossless JPEG (process 14, first-order prediction for .70): pure JavaScript. Precision comes from the JPEG header. */
export async function decodeJpegLossless(encoded: Uint8Array, want: Size, samples: number): Promise<Decoded> {
  assertSize(encoded, want)
  const { Decoder } = await import('jpeg-lossless-decoder-js')
  const ab = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
  const out = new Decoder().decode(ab, 0, ab.byteLength)
  const bytesPerSample = out.BYTES_PER_ELEMENT === 2 ? 2 : 1
  return { data: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), ...want, samples, bytesPerSample } // 16-bit values are little endian on every platform we run on
}
