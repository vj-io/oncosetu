// A password-protected PDF (Standard security handler R2, RC4-40) built by hand for FR-ING-07, like the one in
// src/server/pipeline/text.test.ts, with a typed lab report of the hero patient on its page. Synthetic content only.
import { createHash, randomBytes } from 'node:crypto'

const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex')
const md5 = (...b: Buffer[]) => createHash('md5').update(Buffer.concat(b)).digest()
const padPw = (pw: string) => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32)
function rc4(key: Buffer, data: Buffer): Buffer {
  const s = [...Array(256).keys()]
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]] }
  const out = Buffer.alloc(data.length)
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]]
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255]
  }
  return out
}

export function passwordPdf(userPw: string, lines: string[]): Buffer {
  const id = randomBytes(16)
  const O = rc4(md5(padPw('owner-secret')).subarray(0, 5), padPw(userPw))
  const P = Buffer.alloc(4)
  P.writeInt32LE(-4)
  const key = md5(padPw(userPw), O, P, id).subarray(0, 5)
  const U = rc4(key, PAD)
  const objKey = (n: number) => md5(key, Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, 0, 0])).subarray(0, 10)
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => '\\' + c)
  const text = `BT /F1 11 Tf 40 780 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`
  const content = rc4(objKey(4), Buffer.from(text, 'latin1'))
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Filter /Standard /V 1 /R 2 /O <${O.toString('hex')}> /U <${U.toString('hex')}> /P -4 >>`,
  ]
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')]
  const offsets: number[] = []
  let len = parts[0].length
  objs.forEach((o, i) => {
    offsets.push(len)
    const b = o === null
      ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream\nendobj\n')])
      : Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')
    parts.push(b)
    len += b.length
  })
  const xref = `xref\n0 7\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  parts.push(Buffer.from(`${xref}trailer\n<< /Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>] >>\nstartxref\n${len}\n%%EOF\n`))
  return Buffer.concat(parts)
}
