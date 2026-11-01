// `test` with signed-in clients: staff('records') is an API session; ui('clinician') a page signed in as that role.
import { test as base, expect, type Page } from '@playwright/test'
import { Api, anonymous } from './api'
import type { RoleKey } from './env'

type Fixtures = {
  staff: (role: RoleKey) => Promise<Api>
  ui: (role: RoleKey) => Promise<Page>
  anon: () => ReturnType<typeof anonymous>
}

export const test = base.extend<Fixtures>({
  staff: async ({}, use) => {
    const cache = new Map<RoleKey, Api>()
    await use(async (role) => {
      let a = cache.get(role)
      if (!a) cache.set(role, (a = await Api.login(role)))
      return a
    })
    await Promise.all([...cache.values()].map((a) => a.dispose()))
  },
  ui: async ({ browser, staff }, use) => {
    const contexts: Awaited<ReturnType<Api['browserContext']>>[] = []
    await use(async (role) => {
      const c = await (await staff(role)).browserContext(browser)
      contexts.push(c)
      return c.newPage()
    })
    await Promise.all(contexts.map((c) => c.close()))
  },
  anon: async ({}, use) => {
    const made: Awaited<ReturnType<typeof anonymous>>[] = []
    await use(async () => { const c = await anonymous(); made.push(c); return c })
    await Promise.all(made.map((c) => c.dispose()))
  },
})
export { expect }
