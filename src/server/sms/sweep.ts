// Outbox sweeper (GET /api/cron/outbox). A row stays `queued` when its after() delivery step never ran or died (a
// frozen function, a deploy). The number was never stored (masked + HMAC only), so it is recovered from the patient or
// caregiver phone in the same org whose HMAC matches `to_hmac`, decrypted in memory and never logged. No match →
// `failed` / `stale_no_recipient`. Delivery itself is the normal step (outbox.ts deliver(): re-checks `queued`,
// one retry on a 5xx), run after the lookup transaction so a slow provider never holds a pooled connection.
// ponytail: a row whose first attempt reached Twilio but died before recording `sent` is sent twice; accepted for a daily sweep.
import { and, eq, lt } from 'drizzle-orm'
import { withOrg } from '@/db'
import { caregivers, outbox, patients } from '@/db/schema'
import { decryptField } from '../crypto'
import { log } from '../log'
import { deliver } from '../outbox'
import { smsProvider, type SmsChannel, type SmsProvider } from './provider'

export const STALE_QUEUED_MS = 5 * 60_000
const BATCH = 100

export async function sweepOutbox(orgIds: string[], providerFor: (c: SmsChannel) => SmsProvider | null = smsProvider) {
  let attempted = 0, failed = 0
  for (const orgId of orgIds) {
    const due = await withOrg(orgId, async (tx) => {
      const rows = await tx.select({ id: outbox.id, channel: outbox.channel, toHmac: outbox.toHmac, body: outbox.body }).from(outbox)
        .where(and(eq(outbox.delivery, 'queued'), lt(outbox.createdAt, new Date(Date.now() - STALE_QUEUED_MS)))).limit(BATCH)
      const out = []
      for (const r of rows) {
        const [p] = await tx.select({ enc: patients.phoneEnc }).from(patients).where(eq(patients.phoneHmac, r.toHmac)).limit(1)
        const enc = p?.enc ?? (await tx.select({ enc: caregivers.phoneEnc }).from(caregivers).where(eq(caregivers.phoneHmac, r.toHmac)).limit(1))[0]?.enc
        const provider = providerFor(r.channel)
        if (!enc || !provider) {
          await tx.update(outbox).set({ delivery: 'failed', deliveryError: enc ? 'no_provider' : 'stale_no_recipient', deliveryUpdatedAt: new Date() })
            .where(eq(outbox.id, r.id))
          failed++
          continue
        }
        out.push({ id: r.id, orgId, channel: r.channel, to: decryptField(enc), body: r.body, provider })
      }
      return out
    })
    for (const d of due) await deliver(d)
    attempted += due.length
    if (due.length) log.info('outbox.swept', { orgId, attempted: due.length })
  }
  return { attempted, failed }
}
