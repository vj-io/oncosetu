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

test('V13-E2E-02 blood tests are checked panel by panel, and the insurance desk sees every file on one worklist', async ({ staff, ui }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'hero' })
  await uploadAndWait(records, p.id, 'hero__08-lab-report-injection.pdf') // liver and kidney tests, no blood count

  const page = await ui('records')
  await page.goto(`/patients/${p.id}/preauth?line=chemotherapy`)
  const blood = page.getByRole('listitem').filter({ hasText: 'Blood tests: CBC, LFT, RFT' })
  await expect(blood).toContainText('Partly in the file')
  await expect(blood.getByTestId('preauth-missing-panels')).toHaveText(/No lab report here names CBC\./)

  await page.goto('/preauth')
  await expect(page.getByRole('heading', { name: 'Pre-authorisation files' })).toBeVisible()
  const mine = page.locator(`a[href="/patients/${p.id}/preauth?line=chemotherapy"]`)
  for (let n = 2; !(await mine.count()); n++) { // 100 files a page; the test org holds hundreds, so page on to this patient
    await page.getByRole('link', { name: /^Next \d+$/ }).click()
    await page.waitForURL(new RegExp(`/preauth\\?page=${n}$`))
  }
  const row = page.getByTestId('preauth-row').filter({ has: page.getByRole('link', { name: /^Chemotherapy: / }) }).filter({ has: mine })
  await expect(row).toContainText('Blood tests: CBC, LFT, RFT')
  await expect(row.getByRole('link', { name: /^Surgery: 0 of 3 in the file$/ })).toBeVisible()

  const clinician = await ui('clinician')
  await clinician.goto('/preauth')
  await expect(clinician.getByRole('heading', { name: 'Pre-authorisation files' })).toHaveCount(0)
})
