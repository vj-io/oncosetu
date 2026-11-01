// Small helpers shared by the registration route handlers.
import { NextResponse } from 'next/server'
import { HttpError, type RouteCtx } from '../http'

export type StaffCtx<B = undefined, Q = undefined> = RouteCtx<'staff', B, Q>
export type AuditFn = RouteCtx<'staff', undefined, undefined>['audit']

/**
 * An error RESPONSE (not a thrown HttpError): the request's transaction still commits, so audit rows written
 * before the failure (failed OTP attempts, denied lookups) survive. Use it when the audit row is the point.
 */
export const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: { code, message }, ...extra }, { status })

/** Short, non-identifying accession code for a patient id (same form as the workspace header). */
export const accession = (id: string) => `OS·${id.replace(/-/g, '').slice(-6).toUpperCase()}`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `[id]` route segment as a uuid; anything else is a uniform 404 (no enumeration hints). */
export function patientIdParam(ctx: { params: Record<string, string | string[]> }, key = 'id'): string {
  const v = ctx.params[key]
  if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(404, 'not_found', 'Not found')
  return v
}
