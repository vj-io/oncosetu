// SMS/WhatsApp outbox. The row is the record in every case (masked number + HMAC, never the number) and is written first,
// inside the caller's transaction. With a provider configured (src/server/sms/provider.ts) the message is then delivered
// AFTER that transaction commits, so a slow provider never holds a pooled DB connection (POOL RULE, src/db/index.ts), and
// the row's `delivery` is updated in a short withOrg(). Without one the row stays `simulated` and nothing leaves the server.
// Bodies must come from src/i18n/* (FR-CON-07: neutral copy unless disclosure is cleared).
import { eq } from 'drizzle-orm'
import { after } from 'next/server'
import { withOrg, type Tx } from '@/db'
import { outbox } from '@/db/schema'
import { maskPhone, normalizePhone, phoneHmac } from './crypto'
import { log } from './log'
import { SmsError, smsProvider, type SmsProvider } from './sms/provider'
import type { Lang } from '@/core/types'

export type OutboxMessage = {
  orgId: string; patientId?: string | null; toPhone: string; channel: 'sms' | 'whatsapp'
  templateKey: string; body: string; lang: Lang
}

export const RETRY_DELAY_MS = 1000
const COMMIT_WAIT_MS = 250
const COMMIT_WAIT_TRIES = 4
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Must run inside withOrg(orgId). The plaintext number is used for delivery only: held in memory, never stored or logged. */
export async function sendMessage(tx: Tx, m: OutboxMessage): Promise<{ id: string; toMasked: string; delivery: 'simulated' | 'queued' }> {
  const toHmac = phoneHmac(m.toPhone)
  if (!toHmac) throw new Error('sendMessage: invalid phone number')
  const to = normalizePhone(m.toPhone)!
  const toMasked = maskPhone(to)
  const provider = smsProvider(m.channel)
  const delivery = provider ? 'queued' : 'simulated'
  const [row] = await tx.insert(outbox).values({
    orgId: m.orgId, patientId: m.patientId ?? null, channel: m.channel, toMasked, toHmac,
    templateKey: m.templateKey, body: m.body, lang: m.lang, delivery,
  }).returning({ id: outbox.id })
  log.info('outbox.queued', { outboxId: row.id, channel: m.channel, templateKey: m.templateKey, delivery })
  if (provider) afterCommit(() => deliver({ id: row.id, orgId: m.orgId, channel: m.channel, to, body: m.body, provider }))
  return { id: row.id, toMasked, delivery }
}

/**
 * Next's after() runs once the response is finished, i.e. after withOrg() has committed. Outside a request (scripts,
 * tests) after() throws; there is no response to wait for, so the delivery step starts at once and waits for the row.
 */
function afterCommit(fn: () => Promise<void>): void {
  try {
    after(fn)
  } catch {
    void fn()
  }
}

type Delivery = { id: string; orgId: string; channel: 'sms' | 'whatsapp'; to: string; body: string; provider: SmsProvider }

/** True when the outbox row exists and still waits for delivery. after() also runs when the request failed and rolled back. */
async function waitingForDelivery(orgId: string, id: string): Promise<boolean> {
  for (let i = 0; i < COMMIT_WAIT_TRIES; i++) {
    const [r] = await withOrg(orgId, (tx) => tx.select({ delivery: outbox.delivery }).from(outbox).where(eq(outbox.id, id)))
    if (r) return r.delivery === 'queued'
    if (i < COMMIT_WAIT_TRIES - 1) await sleep(COMMIT_WAIT_MS) // outside a request the caller's transaction may not have committed yet
  }
  return false
}

/** The delivery step. Never throws; a failure is recorded on the row as a short code. */
export async function deliver(d: Delivery): Promise<void> {
  try {
    if (!(await waitingForDelivery(d.orgId, d.id))) {
      log.warn('outbox.delivery_skipped', { outboxId: d.id, channel: d.channel })
      return
    }
    let providerMessageId: string | null = null
    let errCode: string | null = null
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        providerMessageId = (await d.provider.send({ to: d.to, body: d.body })).providerMessageId
        break
      } catch (e) {
        const err = e instanceof SmsError ? e : new SmsError('unknown', null)
        errCode = err.code
        if (attempt === 2 || !err.retryable) break // one retry, on 5xx only
        await sleep(RETRY_DELAY_MS)
      }
    }
    const patch = providerMessageId
      ? { delivery: 'sent' as const, providerMessageId, deliveryError: null, deliveryUpdatedAt: new Date() }
      : { delivery: 'failed' as const, deliveryError: errCode, deliveryUpdatedAt: new Date() }
    await withOrg(d.orgId, (tx) => tx.update(outbox).set(patch).where(eq(outbox.id, d.id)))
    if (providerMessageId) log.info('outbox.delivered', { outboxId: d.id, channel: d.channel })
    else log.warn('outbox.delivery_failed', { outboxId: d.id, channel: d.channel, errCode })
  } catch (e) {
    log.error('outbox.delivery_error', { outboxId: d.id, channel: d.channel, err: e }) // the row stays `queued`; ids only
  }
}
