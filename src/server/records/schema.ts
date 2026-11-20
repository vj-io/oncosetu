// The document_links table (drizzle/0023). Defined here, beside the code that uses it.
import { index, pgTable, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core'

export const documentLinks = pgTable('document_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  kind: text('kind').notNull().default('scan_report'),
  /** For 'scan_report': the scan. */
  aId: uuid('a_id').notNull(),
  /** For 'scan_report': its written report. */
  bId: uuid('b_id').notNull(),
  state: text('state').$type<'proposed' | 'confirmed' | 'rejected'>().notNull().default('proposed'),
  reason: text('reason'),
  proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull().defaultNow(),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
}, (t) => [uniqueIndex('document_links_pair_uq').on(t.aId, t.bId, t.kind), index('document_links_patient_idx').on(t.patientId)])
