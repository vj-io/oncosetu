// A long synthetic paper trail for V03-E2E-01 ("40-page backlog"): one typed PDF of monthly blood counts for the hero
// patient, one report per page, so the backlog reaches 40 pages without adding OCR time (a text layer reads in
// milliseconds). Everything is fictional; every page carries the synthetic-document footer.
import { PDFDocument, StandardFonts } from 'pdf-lib'

export async function bloodCountBundle(pages: number, patient = { name: 'Mrs. SUNITA DESHMUKH', dob: '1974-08-14', sex: 'Female' }): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  for (let i = 0; i < pages; i++) {
    const d = new Date(Date.UTC(2023, 11 + i, 10)) // monthly, Dec 2023 onwards
    const date = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
    const page = doc.addPage([595, 842])
    const line = (s: string, y: number, o: { size?: number; b?: boolean } = {}) => page.drawText(s, { x: 48, y, size: o.size ?? 10, font: o.b ? bold : font })
    line('GODAVARI PATHOLOGY LABORATORY', 790, { size: 15, b: true })
    line('Haematology  |  Biochemistry  |  14, College Road, Nashik 422 005  |  Tel: 0253-257 3310', 772, { size: 8 })
    line('COMPLETE BLOOD COUNT', 740, { size: 12, b: true })
    line(`Patient Name: ${patient.name}`, 712)
    const age = d.getUTCFullYear() - Number(patient.dob.slice(0, 4)) - (d.toISOString().slice(5, 10) < patient.dob.slice(5) ? 1 : 0)
    line(`Age / Sex: ${age} Years / ${patient.sex}`, 696)
    line(`Report Date: ${date}`, 680)
    line(`Lab No.: GPL/${d.getUTCFullYear()}/${String(4100 + i)}`, 664)
    const rows = [['Haemoglobin', (10.4 + (i % 7) * 0.2).toFixed(1), 'g/dL', '12.0 - 15.0'], ['Total leucocyte count', String(5200 + i * 40), '/cu mm', '4,000 - 11,000'], ['Platelet count', String(180000 + i * 1500), '/cu mm', '1,50,000 - 4,10,000']]
    rows.forEach((r, j) => r.forEach((c, k) => page.drawText(c, { x: 48 + [0, 200, 290, 380][k], y: 630 - j * 18, size: 10, font })))
    line('Dr. Rekha Pawar, M.D. (Pathology)', 520)
    line(`Page ${i + 1} of ${pages}`, 60, { size: 8 })
    line('SYNTHETIC DOCUMENT - FOR DEMONSTRATION ONLY', 44, { size: 8, b: true })
  }
  doc.setTitle('Blood counts, monthly (synthetic)')
  return Buffer.from(await doc.save())
}
