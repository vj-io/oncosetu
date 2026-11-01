// Request schemas shared by the admin and measure routes.
import { z } from 'zod'
import { DOC_TYPES } from '@/core/types'
import { STAFF_ROLES } from '../rbac'
import { IMPACTS, PHASES, REPEAT_REASONS } from './measurement-core'

export const zUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid id')
export const zRole = z.enum(STAFF_ROLES as [string, ...string[]]) as z.ZodType<(typeof STAFF_ROLES)[number]>

export const measureForm = z.object({
  encounterId: zUuid.nullable(),
  consultationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phase: z.enum(PHASES),
  firstVisit: z.boolean(),
  missingRecordPresent: z.boolean(),
  missingRecordCount: z.number().int().min(0).max(50),
  missingTypes: z.array(z.enum(DOC_TYPES)).max(DOC_TYPES.length),
  impact: z.enum(IMPACTS),
  repeatTestOrdered: z.boolean(),
  repeatTestReason: z.enum(REPEAT_REASONS).nullable(),
  prepMinutes: z.number().int().min(0).max(600).nullable(),
})
