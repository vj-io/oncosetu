// The single policy point for route handlers (docs/ARCHITECTURE.md "Request pipeline").
import { randomUUID } from 'node:crypto'
import { unstable_rethrow } from 'next/navigation'
import { NextResponse, type NextRequest } from 'next/server'
import { ZodError, type ZodType } from 'zod'
import { withOrg, type Tx } from '@/db'
import { writeAudit, type AuditDetails } from './audit'
import { logger, type Logger } from './log'
import type { Role } from './rbac'
import { getSession, sessionRole, type PatientSession, type Session, type StaffSession } from './session'

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export type Auth = 'staff' | 'patient' | 'any' | 'public'
type SessionFor<A extends Auth> =
  A extends 'staff' ? StaffSession : A extends 'patient' ? PatientSession : A extends 'any' ? Session : null

export type RouteCtx<A extends Auth, B, Q> = {
  req: NextRequest
  requestId: string
  log: Logger
  /** null on public routes */
  session: SessionFor<A>
  body: B
  query: Q
  /** set when opts.form is true (multipart uploads) */
  form: FormData
  params: Record<string, string | string[]>
  /** transaction with RLS app.org_id = session.orgId. Throws on public routes: use withOrg() there. */
  db: Tx
  /** ids/enums only, never PHI. Throws on public routes: use writeAudit() there. */
  audit: (action: string, targetType: string | null, targetId: string | null, details?: AuditDetails) => Promise<void>
}

export type RouteOpts<A extends Auth, B, Q> = {
  auth: A
  roles?: readonly Role[]
  body?: ZodType<B>
  query?: ZodType<Q>
  form?: boolean
  /** max request body bytes (default 4.5 MB, the Vercel limit) */
  maxBytes?: number
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function unavailable<T extends object>(what: string): T {
  return new Proxy({} as T, { get() { throw new Error(`${what} is unavailable on public routes`) } })
}

function checkRequest(req: NextRequest, opts: RouteOpts<Auth, unknown, unknown>) {
  if (SAFE_METHODS.has(req.method)) return
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  let originHost: string | null = null
  try { originHost = origin ? new URL(origin).host : null } catch { /* invalid origin */ }
  if (!originHost || originHost !== host) throw new HttpError(403, 'bad_origin', 'Cross-site request blocked')
  const len = Number(req.headers.get('content-length') ?? 0)
  if (len > (opts.maxBytes ?? 4.5 * 1024 * 1024)) throw new HttpError(413, 'too_large', 'Request is too large')
  const ct = req.headers.get('content-type') ?? ''
  const json = ct.startsWith('application/json'), multipart = ct.startsWith('multipart/form-data')
  if ((opts.form && !multipart) || (opts.body && !json) || (ct && !json && !multipart)) {
    throw new HttpError(415, 'unsupported_media_type', 'Send JSON or multipart form data')
  }
}

function errorResponse(err: unknown, log: Logger): NextResponse {
  if (err instanceof HttpError) return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status })
  if (err instanceof ZodError) {
    return NextResponse.json({
      error: { code: 'invalid_request', message: 'Invalid request', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    }, { status: 400 })
  }
  const pgCode = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code
  if (pgCode === '42501') { // RLS / grant violation: the DB said no
    log.warn('db.denied', { errCode: pgCode })
    return NextResponse.json({ error: { code: 'forbidden', message: 'Not allowed' } }, { status: 403 })
  }
  log.error('unhandled', { err })
  return NextResponse.json({ error: { code: 'internal', message: 'Something went wrong' } }, { status: 500 })
}

export function route<A extends Auth, B = undefined, Q = undefined>(
  opts: RouteOpts<A, B, Q>,
  handler: (ctx: RouteCtx<A, B, Q>) => Promise<unknown> | unknown,
) {
  return async (req: NextRequest, rc: { params: Promise<Record<string, string | string[]>> }): Promise<Response> => {
    const requestId = randomUUID()
    const log = logger(requestId).child({ path: req.nextUrl.pathname, method: req.method })
    const started = Date.now()
    let res: Response
    try {
      checkRequest(req, opts as RouteOpts<Auth, unknown, unknown>)
      let session: Session | null = null
      if (opts.auth !== 'public') {
        session = await getSession()
        if (!session) throw new HttpError(401, 'unauthenticated', 'Sign in required')
        if ((opts.auth === 'staff' && session.kind !== 'staff') || (opts.auth === 'patient' && session.kind === 'staff')
          || (opts.roles && !opts.roles.includes(sessionRole(session)))) {
          throw new HttpError(403, 'forbidden', 'Not allowed')
        }
      }
      const query = opts.query ? opts.query.parse(Object.fromEntries(req.nextUrl.searchParams)) : undefined
      let body: unknown, form: FormData | undefined
      if (opts.form) form = await req.formData()
      else if (opts.body) {
        const raw = await req.json().catch(() => { throw new HttpError(400, 'invalid_json', 'Invalid JSON body') })
        body = opts.body.parse(raw)
      }
      const params = rc?.params ? await rc.params : {}
      const base = { req, requestId, log, session, body, query, form: form ?? unavailable<FormData>('ctx.form'), params }

      const result = session
        ? await withOrg(session.orgId, async (tx) => handler({
          ...base, db: tx,
          audit: async (action, targetType, targetId, details) => {
            await writeAudit(tx, {
              orgId: session.orgId, actorId: session.kind === 'staff' ? session.staffId : (session.caregiverId ?? session.patientId),
              actorRole: sessionRole(session), action, targetType, targetId, requestId, details,
            })
          },
        } as RouteCtx<A, B, Q>))
        : await handler({
          ...base, db: unavailable<Tx>('ctx.db'), audit: () => { throw new Error('ctx.audit is unavailable on public routes') },
        } as unknown as RouteCtx<A, B, Q>)
      res = result instanceof Response ? result : NextResponse.json(result ?? { ok: true })
    } catch (err) {
      unstable_rethrow(err) // let redirect()/notFound()/forbidden() through
      res = errorResponse(err, log)
    }
    try {
      res.headers.set('x-request-id', requestId)
      if (!res.headers.has('cache-control')) res.headers.set('cache-control', 'no-store')
    } catch { /* immutable headers (Response.redirect) */ }
    log.info('request', { status: res.status, ms: Date.now() - started })
    return res
  }
}
