// Tables created by drizzle/0002_admin_qa_measurement.sql (the Admin agent does not own src/db/schema.ts).
// Foundation: fold these into src/db/schema.ts (+ RLS_TABLES) when convenient; names/columns match the migration.
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { v7 as uuidv7 } from 'uuid'

const pk = () => uuid('id').primaryKey().$defaultFn(() => uuidv7()).defaultRandom()

/** FR-VER-04: one second review per sampled `verifications` row. Append-only (no UPDATE/DELETE grant). */
export const verificationQaReviews = pgTable('verification_qa_reviews', {
  id: pk(),
  orgId: uuid('org_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  verificationId: uuid('verification_id').notNull().unique(),
  eventId: uuid('event_id').notNull(),
  reviewerId: uuid('reviewer_id').notNull(),
  outcome: text('outcome').$type<'agree' | 'disagree'>().notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
})

/** §16.4 "which document types were referenced but absent" for a measurement form. */
export const measurementFormDocTypes = pgTable('measurement_form_doc_types', {
  id: pk(),
  orgId: uuid('org_id').notNull(),
  formId: uuid('form_id').notNull(),
  docType: text('doc_type').notNull(),
})
