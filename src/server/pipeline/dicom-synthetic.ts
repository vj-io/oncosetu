// Builds SYNTHETIC DICOM files (simple generated shapes, never real scans) for the demo documents and the tests.
// Explicit VR little endian, optionally RLE-compressed. Every file says SYNTHETIC in the header and in the picture.
import sharp from 'sharp'

const LONG_VR = new Set(['OB', 'OW', 'SQ', 'UN', 'UT', 'OF'])

type Val = string | number | number[] | Buffer

function enc(tag: [number, number], vr: string, v: Val): Buffer {
  let body: Buffer
  if (Buffer.isBuffer(v)) body = v
  else if (vr === 'US') { const a = Array.isArray(v) ? v : [Number(v)]; body = Buffer.alloc(a.length * 2); a.forEach((x, i) => body.writeUInt16LE(x, i * 2)) }
  else if (vr === 'UL') { body = Buffer.alloc(4); body.writeUInt32LE(Number(v)) }
  else body = Buffer.from(String(v), 'latin1')
  if (!Buffer.isBuffer(v) && !['US', 'UL'].includes(vr) && body.length % 2) body = Buffer.concat([body, Buffer.from(vr === 'UI' ? '\0' : ' ')])
  if (Buffer.isBuffer(v) && body.length % 2) body = Buffer.concat([body, Buffer.from([0])])
  const head = Buffer.alloc(LONG_VR.has(vr) ? 12 : 8)
  head.writeUInt16LE(tag[0], 0); head.writeUInt16LE(tag[1], 2); head.write(vr, 4, 'latin1')
  if (LONG_VR.has(vr)) head.writeUInt32LE(body.length, 8); else head.writeUInt16LE(body.length, 6)
  return Buffer.concat([head, body])
}

export type SyntheticOpts = {
  modality: 'CT' | 'MR' | 'PT' | 'CR' | 'DX' | 'MG' | 'US' | 'NM'
  patientName: string // "Last^First"
  patientId?: string
  sex?: 'F' | 'M'
  age?: string // "051Y"
  studyDate?: string // YYYYMMDD
  bodyPart?: string
  institution?: string
  description?: string
  studyUid: string
  seriesUid?: string
  instance?: number
  frames?: number
  size?: number
  rle?: boolean
  /** Test only: label the file with another transfer syntax (the pixels stay uncompressed). */
  transferSyntax?: string
  /** Slice position 0..1, moves the shapes a little so a series looks like a series. */
  slice?: number
}

/** 8-bit greyscale picture of simple shapes with the word SYNTHETIC. */
export async function syntheticPicture(modality: string, size: number, slice = 0.5, caption = ''): Promise<Uint8Array> {
  const c = size / 2
  const shapes = modality === 'CR' || modality === 'DX'
    ? `<ellipse cx="${c * 0.62}" cy="${c}" rx="${size * 0.17}" ry="${size * 0.3}" fill="#222"/><ellipse cx="${c * 1.38}" cy="${c}" rx="${size * 0.17}" ry="${size * 0.3}" fill="#222"/><rect x="${c - 6}" y="${size * 0.1}" width="12" height="${size * 0.8}" fill="#ddd"/>`
    : modality === 'MG'
      ? `<path d="M0,0 L${size * 0.7},0 Q${size * 0.95},${c} ${size * 0.5},${size} L0,${size} Z" fill="#999"/><circle cx="${size * 0.45}" cy="${c}" r="${size * 0.05}" fill="#eee"/>`
      : modality === 'PT' || modality === 'NM'
        ? `<rect x="0" y="0" width="${size}" height="${size}" fill="#eee"/><ellipse cx="${c}" cy="${c}" rx="${size * 0.28}" ry="${size * 0.4}" fill="#aaa"/><circle cx="${c + (slice - 0.5) * size * 0.4}" cy="${c * 0.8}" r="${size * 0.05}" fill="#111"/><circle cx="${c}" cy="${c * 1.4}" r="${size * 0.07}" fill="#222"/>`
        : modality === 'MR'
          ? `<circle cx="${c}" cy="${c}" r="${size * 0.4}" fill="#bbb"/><circle cx="${c}" cy="${c}" r="${size * 0.3}" fill="#777"/><circle cx="${c - size * 0.08}" cy="${c}" r="${size * 0.04 + slice * 6}" fill="#eee"/>`
          : modality === 'US'
            ? `<path d="M${c},0 L${size * 0.95},${size * 0.9} L${size * 0.05},${size * 0.9} Z" fill="#555"/><circle cx="${c}" cy="${size * 0.5 + (slice - 0.5) * 30}" r="${size * 0.08}" fill="#bbb"/>`
            : `<ellipse cx="${c}" cy="${c}" rx="${size * 0.42}" ry="${size * 0.32}" fill="#888"/><ellipse cx="${c * 0.7}" cy="${c}" rx="${size * 0.13}" ry="${size * 0.2}" fill="#111"/><ellipse cx="${c * 1.3}" cy="${c}" rx="${size * 0.13}" ry="${size * 0.2}" fill="#111"/><rect x="${c - 8}" y="${c * 1.3}" width="16" height="${size * 0.12}" fill="#eee"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#000"/>${shapes}<text x="${c}" y="${size * 0.07}" font-family="sans-serif" font-size="${size * 0.07}" fill="#fff" text-anchor="middle">SYNTHETIC</text><text x="${c}" y="${size * 0.97}" font-family="sans-serif" font-size="${size * 0.04}" fill="#fff" text-anchor="middle">${caption}</text></svg>`
  return sharp(Buffer.from(svg)).greyscale().raw().toBuffer()
}

function rleEncode(pixels: Uint8Array, bytesPerSample: number): Buffer {
  const count = pixels.length / bytesPerSample
  const segs: Buffer[] = []
  for (let s = 0; s < bytesPerSample; s++) {
    const plane = new Uint8Array(count)
    for (let i = 0; i < count; i++) plane[i] = pixels[i * bytesPerSample + (bytesPerSample - 1 - s)]
    const out: number[] = []
    for (let i = 0; i < count;) { // literal runs of up to 128 bytes keep the encoder simple and valid
      const n = Math.min(128, count - i)
      out.push(n - 1); for (let k = 0; k < n; k++) out.push(plane[i + k]); i += n
    }
    if (out.length % 2) out.push(0)
    segs.push(Buffer.from(out))
  }
  const head = Buffer.alloc(64); head.writeUInt32LE(segs.length, 0)
  let off = 64; segs.forEach((sg, i) => { head.writeUInt32LE(off, 4 + i * 4); off += sg.length })
  return Buffer.concat([head, ...segs])
}

export async function buildSyntheticDicom(o: SyntheticOpts): Promise<Buffer> {
  const size = o.size ?? 192
  const frames = o.frames ?? 1
  const sixteen = ['CT', 'PT', 'MR', 'CR', 'DX', 'MG', 'NM'].includes(o.modality)
  const frameBuffers: Buffer[] = []
  for (let f = 0; f < frames; f++) {
    const grey = await syntheticPicture(o.modality, size, frames > 1 ? f / (frames - 1) : o.slice ?? 0.5, `${o.description ?? o.modality} · synthetic sample`)
    if (sixteen) { const b = Buffer.alloc(grey.length * 2); grey.forEach((g, i) => b.writeUInt16LE(g * 16, i * 2)); frameBuffers.push(b) } else frameBuffers.push(Buffer.from(grey))
  }
  const ts = o.transferSyntax ?? (o.rle ? '1.2.840.10008.1.2.5' : '1.2.840.10008.1.2.1')
  const sop = ({ CT: '1.2.840.10008.5.1.4.1.1.2', MR: '1.2.840.10008.5.1.4.1.1.4', PT: '1.2.840.10008.5.1.4.1.1.128', CR: '1.2.840.10008.5.1.4.1.1.1', DX: '1.2.840.10008.5.1.4.1.1.1.1', MG: '1.2.840.10008.5.1.4.1.1.1.2', US: '1.2.840.10008.5.1.4.1.1.6.1', NM: '1.2.840.10008.5.1.4.1.1.20' } as const)[o.modality]
  const sopInstance = `${o.studyUid}.${o.instance ?? 1}`
  const meta = Buffer.concat([
    enc([2, 1], 'OB', Buffer.from([0, 1])), enc([2, 2], 'UI', sop), enc([2, 3], 'UI', sopInstance), enc([2, 0x10], 'UI', ts), enc([2, 0x12], 'UI', '1.2.826.0.1.3680043.8.498.1'),
  ])
  const groupLen = enc([2, 0], 'UL', meta.length)
  const set: Buffer[] = [
    enc([8, 0x16], 'UI', sop), enc([8, 0x18], 'UI', sopInstance), enc([8, 0x20], 'DA', o.studyDate ?? '20260210'), enc([8, 0x60], 'CS', o.modality),
    enc([8, 0x80], 'LO', o.institution ?? 'Synthetic Demo Imaging Centre'), enc([8, 0x1030], 'LO', `${o.description ?? o.modality} SYNTHETIC`),
    enc([0x10, 0x10], 'PN', o.patientName), enc([0x10, 0x20], 'LO', o.patientId ?? 'SYN-0001'), enc([0x10, 0x40], 'CS', o.sex ?? 'F'), enc([0x10, 0x1010], 'AS', o.age ?? '051Y'),
    enc([0x18, 0x15], 'CS', o.bodyPart ?? 'CHEST'),
    enc([0x20, 0xd], 'UI', o.studyUid), enc([0x20, 0xe], 'UI', o.seriesUid ?? `${o.studyUid}.9`), enc([0x20, 0x13], 'IS', String(o.instance ?? 1)),
    enc([0x28, 2], 'US', 1), enc([0x28, 4], 'CS', 'MONOCHROME2'), ...(frames > 1 ? [enc([0x28, 8], 'IS', String(frames))] : []),
    enc([0x28, 0x10], 'US', size), enc([0x28, 0x11], 'US', size),
    enc([0x28, 0x100], 'US', sixteen ? 16 : 8), enc([0x28, 0x101], 'US', sixteen ? 12 : 8), enc([0x28, 0x102], 'US', sixteen ? 11 : 7), enc([0x28, 0x103], 'US', 0),
    ...(sixteen ? [enc([0x28, 0x1050], 'DS', '2040'), enc([0x28, 0x1051], 'DS', '4080')] : []),
  ]
  let pixel: Buffer
  if (o.rle) {
    // encapsulated: empty basic offset table, one fragment per frame, then the sequence delimiter
    const parts: Buffer[] = [Buffer.from([0xfe, 0xff, 0x00, 0xe0, 0, 0, 0, 0])]
    for (const fb of frameBuffers) {
      const data = rleEncode(fb, sixteen ? 2 : 1)
      const h = Buffer.alloc(8); h.writeUInt16LE(0xfffe, 0); h.writeUInt16LE(0xe000, 2); h.writeUInt32LE(data.length, 4)
      parts.push(h, data)
    }
    parts.push(Buffer.from([0xfe, 0xff, 0xdd, 0xe0, 0, 0, 0, 0]))
    const h = Buffer.alloc(12); h.writeUInt16LE(0x7fe0, 0); h.writeUInt16LE(0x0010, 2); h.write('OB', 4, 'latin1'); h.writeUInt32LE(0xffffffff, 8)
    pixel = Buffer.concat([h, ...parts])
  } else {
    pixel = enc([0x7fe0, 0x10], sixteen ? 'OW' : 'OB', Buffer.concat(frameBuffers))
  }
  return Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), groupLen, meta, ...set, pixel])
}
