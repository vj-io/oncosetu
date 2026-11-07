import { NextResponse } from 'next/server'
import { z } from 'zod'
import { assertDeviceActive } from '@/server/devices/check'
import { HttpError, route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { scheduleProcessing, type IntakeRoute } from '@/server/pipeline/ingest'
import { ingestUpload } from '@/server/pipeline/upload'
import { listDocuments } from '@/server/pipeline/queries'
import { patientIdParam } from '@/server/registration/http'

const meta = z.object({
  clientFileId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  intakeRoute: z.enum(['desk', 'bulk', 'patient_link', 'offline_sync']).default('bulk'),
  encounterId: z.uuid().optional(),
  clientCapturedAt: z.iso.datetime({ offset: true }).optional(),
})

/** Staff upload (FR-ING-02): multipart `file`, `clientFileId?`, `intakeRoute?`, `encounterId?`, `clientCapturedAt?` (ISO). Processing starts after the response. */
export const POST = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'], form: true }, async (ctx) => {
  // Capture-app uploads carry x-device-id; a revoked or unknown device gets 410 device_revoked (no header passes).
  await assertDeviceActive(ctx.db, ctx.session.orgId, ctx.req.headers.get('x-device-id'))
  const patientId = patientIdParam(ctx)
  await assertPatientAccess(ctx, patientId)
  const file = ctx.form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, 'file_required', 'Attach a file')
  const m = meta.parse({
    clientFileId: ctx.form.get('clientFileId') || undefined, intakeRoute: ctx.form.get('intakeRoute') || undefined,
    encounterId: ctx.form.get('encounterId') || undefined, clientCapturedAt: ctx.form.get('clientCapturedAt') || undefined,
  })
  const up = await ingestUpload(ctx.db, {
    orgId: ctx.session.orgId, patientId, uploadedBy: { kind: 'staff', id: ctx.session.staffId }, intakeRoute: m.intakeRoute as IntakeRoute,
    clientFileId: m.clientFileId, encounterId: m.encounterId, clientCapturedAt: m.clientCapturedAt ? new Date(m.clientCapturedAt) : null, fileName: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()),
    audit: ctx.audit,
  })
  if (up.rejected) return NextResponse.json({ error: { code: up.rejected.code, message: up.rejected.message } }, { status: up.rejected.status })
  for (const r of up.documents) if (r.status === 'queued' && !r.duplicateOf && !r.idempotent) scheduleProcessing(r.documentId, ctx.session.orgId)
  // a single file keeps the old response shape; a ZIP also lists what was skipped
  return up.expandedZip ? { documents: up.documents, skipped: up.skipped } : { ...up.documents[0], skipped: up.skipped }
})

/** Document index + onboarding progress (polled by the documents screen). */
export const GET = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'] }, async (ctx) => {
  const patientId = patientIdParam(ctx)
  await assertPatientAccess(ctx, patientId)
  const out = await listDocuments(ctx.db, patientId)
  for (const r of out.rows) if (r.needsRunner) scheduleProcessing(r.id, ctx.session.orgId)
  return out
})
