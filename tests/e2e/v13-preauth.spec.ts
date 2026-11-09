// Pre-authorisation file check for PM-JAY oncology packages (src/core/preauth.ts): which documents a package asks for are
// in the file, and, for one that is not, the missing-papers item that is already chasing it.
import { registerPatient, uploadAndWait } from './helpers/api'
import { test, expect } from './helpers/fixtures'

test('V13-E2E-01 pre-auth file: the biopsy report is not in the file and points at the hospital to ask; desk staff cannot open it', async ({ staff, ui }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'hero' })
  await uploadAndWait(records, p.id, 'hero__01-discharge-summary.pdf')

  const page = await ui('records')
  await page.goto(`/patients/${p.id}/preauth?line=surgery`)
  await expect(page.getByRole('heading', { name: 'Pre-authorisation file' })).toBeVisible()
  await expect(page.getByTestId('preauth-count')).toHaveText('Surgery: 1 of 6 documents in the file')
  const biopsy = page.getByRole('listitem').filter({ hasText: 'FNAC or biopsy report' })
  await expect(biopsy).toContainText('Not in the file')
  await expect(biopsy).toContainText(/ask at Triveni Multispeciality Hospital/i) // as printed on the letterhead
  await expect(biopsy.getByRole('link', { name: 'missing-papers list' })).toHaveAttribute('href', `/patients/${p.id}/completeness`)
  await expect(page.getByRole('listitem').filter({ hasText: 'Detailed discharge summary' })).toContainText('In the file')
  await expect(page.getByRole('listitem').filter({ hasText: 'Oncology Treatment Plan Approval form' })).toContainText('Not a paper OncoSetu holds')

  const desk = await ui('desk')
  await desk.goto(`/patients/${p.id}/overview`)
  await expect(desk.getByRole('link', { name: 'Pre-auth file' })).toHaveCount(0)
  await desk.goto(`/patients/${p.id}/preauth`)
  await expect(desk.getByText('This page is for administrators, clinicians and records staff')).toBeVisible()
})
