// The signed consent PDF. DRAFT wording, legal review pending. English text (the PDF is a record, the on-screen form is
// shown in the person's language). Synthetic demo data only.
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export const FORM_VERSION = 'consent-form-draft-v1'

export type ConsentPdfInput = {
  hospital: string
  patientName: string
  signerName: string
  relation: 'self' | 'guardian' | 'caregiver'
  method: 'drawn' | 'typed'
  signaturePng?: Uint8Array | null
  witnessName?: string | null
  signedAt: Date
  noticeVersion: string
  action: 'grant' | 'update' | 'withdraw'
  /** Plain-language purposes with whether each was agreed. */
  purposes: { label: string; on: boolean }[]
  language: string
}

const RELATION_TEXT = { self: 'The patient (self)', guardian: 'Parent or legal guardian of the patient', caregiver: 'Caregiver acting for the patient' } as const
const wrap = (text: string, font: PDFFont, size: number, width: number): string[] => {
  const out: string[] = []
  let line = ''
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w } else line = t
  }
  if (line) out.push(line)
  return out
}

export async function buildConsentPdf(i: ConsentPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage([595, 842])
  let y = 800
  const text = (s: string, o: { size?: number; b?: boolean; color?: [number, number, number]; indent?: number } = {}) => {
    const size = o.size ?? 10.5
    for (const l of wrap(s, o.b ? bold : font, size, 495 - (o.indent ?? 0))) {
      page.drawText(l, { x: 50 + (o.indent ?? 0), y, size, font: o.b ? bold : font, color: rgb(...(o.color ?? [0.1, 0.1, 0.1])) })
      y -= size + 5
    }
  }
  const gap = (n = 8) => { y -= n }
  watermark(page, bold)
  text(i.action === 'withdraw' ? 'Withdrawal of consent' : 'Consent to keep and use my records', { size: 17, b: true })
  text(`${i.hospital}`, { size: 11 })
  text('Draft form. Legal review pending. Synthetic demonstration data only.', { size: 9.5, b: true, color: [0.65, 0.15, 0.1] })
  gap()
  text(`Form version: ${FORM_VERSION}   Privacy notice version: ${i.noticeVersion}   Language shown on screen: ${i.language}`, { size: 9 })
  gap(12)
  text('Patient', { b: true })
  text(i.patientName)
  gap()
  if (i.action === 'withdraw') {
    text('I withdraw my consent for every purpose below. The hospital stops new use of my records from now. I may ask for my records to be erased once consent is withdrawn.')
  } else {
    text('I have read the privacy notice (Digital Personal Data Protection Act, 2023). I agree to the purposes ticked below. I can withdraw at any time.')
  }
  gap()
  for (const p of i.purposes) text(`${i.action === 'withdraw' ? '[ ]' : p.on ? '[x]' : '[ ]'}  ${p.label}`, { indent: 6 })
  gap(10)
  text('Signed by', { b: true })
  text(`${i.signerName}`)
  text(`Relationship to the patient: ${RELATION_TEXT[i.relation]}`)
  text(`Signature method: ${i.method === 'drawn' ? 'drawn on screen' : 'typed name'}`)
  gap(6)
  if (i.signaturePng?.length) {
    try {
      const img = await pdf.embedPng(i.signaturePng)
      const s = img.scaleToFit(220, 80)
      page.drawRectangle({ x: 50, y: y - s.height - 6, width: s.width + 12, height: s.height + 12, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.6 })
      page.drawImage(img, { x: 56, y: y - s.height, width: s.width, height: s.height })
      y -= s.height + 22
    } catch { text('(signature image could not be embedded)') }
  } else {
    page.drawText(i.signerName, { x: 56, y: y - 22, size: 22, font: await pdf.embedFont(StandardFonts.TimesRomanItalic), color: rgb(0.1, 0.1, 0.4) })
    y -= 40
  }
  text(`Witness at the hospital desk: ${i.witnessName ?? 'none (signed in the patient portal)'}`)
  text(`Signed on: ${i.signedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'long', timeStyle: 'short' })} IST`)
  gap(14)
  text('Grievance officer: [ ]   Contact: [ ]', { size: 9.5 })
  pdf.setTitle(i.action === 'withdraw' ? 'Withdrawal of consent (draft)' : 'Consent form (draft)')
  pdf.setCreationDate(i.signedAt); pdf.setModificationDate(i.signedAt)
  return pdf.save()
}

function watermark(page: PDFPage, font: PDFFont) {
  page.drawText('DRAFT - LEGAL REVIEW PENDING', { x: 70, y: 400, size: 40, font, color: rgb(0.9, 0.85, 0.85), rotate: degrees(30), opacity: 0.5 })
}

/** A minor is signed for by a guardian (never "self"); a caregiver cannot sign for a minor unless they are the guardian. */
export function checkSigner(a: { minor: boolean; relation: 'self' | 'guardian' | 'caregiver' }): { ok: true } | { ok: false; message: string } {
  if (a.minor && a.relation !== 'guardian') return { ok: false, message: 'A guardian signs for a patient under 18' }
  return { ok: true }
}
