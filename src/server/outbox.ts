// Simulated SMS/WhatsApp gateway: messages are stored (masked number + HMAC) and nothing leaves the server.
// Bodies must come from src/i18n/* (FR-CON-07: neutral copy unless disclosure is cleared).
import type { Tx } from '@/db'
import { outbox } from '@/db/schema'
import { maskPhone, normalizePhone, phoneHmac } from './crypto'
import { log } from './log'

export type OutboxMessage = {
  orgId: string; patientId?: string | null; toPhone: string; channel: 'sms' | 'whatsapp'
  templateKey: string; body: string; lang: 'en' | 'hi'
}

/** Must run inside withOrg(orgId). */
export async function sendMessage(tx: Tx, m: OutboxMessage): Promise<{ id: string; toMasked: string }> {
  const toHmac = phoneHmac(m.toPhone)
  if (!toHmac) throw new Error('sendMessage: invalid phone number')
  const toMasked = maskPhone(normalizePhone(m.toPhone)!)
  const [row] = await tx.insert(outbox).values({
    orgId: m.orgId, patientId: m.patientId ?? null, channel: m.channel, toMasked, toHmac,
    templateKey: m.templateKey, body: m.body, lang: m.lang,
  }).returning({ id: outbox.id })
  log.info('outbox.queued', { outboxId: row.id, channel: m.channel, templateKey: m.templateKey })
  return { id: row.id, toMasked }
}
